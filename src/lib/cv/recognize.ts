/**
 * Single-image gem recognition core, factored out of the live capture worker so it can run
 * BOTH in the worker (static-image uploads) and in plain Node (the accuracy harness).
 *
 * Deliberately free of browser-only runtime APIs (`self`, `OffscreenCanvas`, `createImageBitmap`):
 * the caller hands in an already-decoded grayscale `cv.Mat` plus the loaded atlas, and gets back
 * the recognized gems. The optional `debugCtx` is a TYPE-only reference (erased at runtime) that
 * the live worker uses to draw its match overlay; Node callers never pass one.
 *
 * The live `processFrame` path keeps its own scale-cache / hint machinery; this module only owns
 * the FRESH-scale path (every call re-measures the UI scale via a full multi-scale anchor sweep),
 * which is exactly what an independent screenshot needs and what `processFrame` does on its first
 * frame. `extractNineGems` is shared with the live path so the gem-row loop exists in one place.
 */
import type { CV } from '@techstark/opencv-js';

import type { ArkGridAttr, GemRecognitionLocale } from '../constants/enums';
import { type ArkGridGem } from '../models/arkGridGems';
import { ArkGridGemSpecs, determineGemGradeByGem } from '../models/arkGridGemSpecs';
import type { AtlasEntry, MatchingAtlas } from './atlas';
import { showMatch } from './debug';
import type { KeyOptionLevel, KeyOptionString, loadGemAsset } from './matStore';
import { type MatchingResult, getBestMatch, multiScaleAnchorMatch } from './matcher';
import { rawScaleToResolutionScale, snapResolutionScale } from './scaleDetection';
import type { CvMat, OwnedCount } from './types';

export type { OwnedCount };

/** The atlas bundle produced by {@link loadGemAsset} (in either the browser or Node). */
export type LoadedGemAsset = Awaited<ReturnType<typeof loadGemAsset>>;

/** Per-target match-score cutoffs (structurally the worker's `thresholdSet`). */
export interface RecognitionThresholds {
  anchor: number;
  gemAttr: number;
  gemImage: number;
  willPower: number;
  corePoint: number;
  optionName: number;
  optionLevel: number;
}

export interface RecognizeResult {
  locale: GemRecognitionLocale;
  gemAttr: ArkGridAttr;
  gems: ArkGridGem[];
  /** Footer "Astrogems Owned" per-attr counts, or null if unread (locale not calibrated). */
  owned: OwnedCount | null;
}

// Erased at runtime; only the live worker ever supplies a real drawing context.
type DebugCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;

interface RecognitionTarget<K extends string> {
  roi: { x: number; y: number; width: number; height: number };
  atlas: MatchingAtlas<K>;
  threshold: number;
}

/**
 * Best atlas match within `t.roi`, or null if its score is below `t.threshold`. When a debug
 * context is supplied, the candidate is drawn even when rejected (so the overlay shows misses).
 */
export function findBest<K extends string>(
  cv: CV,
  t: RecognitionTarget<K>,
  frame: CvMat,
  debugCtx?: DebugCtx,
  option?: { method?: number; excludeKey?: K }
): MatchingResult<K> | null {
  const roi = new cv.Rect(t.roi.x, t.roi.y, t.roi.width, t.roi.height);
  const match = getBestMatch(frame, t.atlas, roi, option);
  if (!match) return null;
  if (debugCtx) {
    showMatch(debugCtx, roi, match, { scoreThreshold: t.threshold });
  }
  if (match.score > t.threshold) return match;
  return null;
}

/**
 * Build a copy of `atlas` whose every template is resized by `s` (INTER_AREA shrinking, INTER_LINEAR
 * enlarging). Entries keep their `x` but carry the scaled width/height. The caller MUST dispose it
 * via {@link disposeScaledAtlas} — the resized templates are fresh WASM-heap Mats. Lets the gem-row
 * loop match at the detected on-screen UI scale without resampling the (large) frame.
 */
function scaleAtlas<K extends string>(cv: CV, atlas: MatchingAtlas<K>, s: number): MatchingAtlas<K> {
  const entries = {} as Record<K, AtlasEntry>;
  for (const key of Object.keys(atlas.entries) as K[]) {
    const e = atlas.entries[key];
    const w = Math.max(1, Math.round(e.template.cols * s));
    const h = Math.max(1, Math.round(e.template.rows * s));
    const template = new cv.Mat();
    cv.resize(e.template, template, new cv.Size(w, h), 0, 0, s < 1 ? cv.INTER_AREA : cv.INTER_LINEAR);
    entries[key] = { x: e.x, width: Math.round(e.width * s), height: Math.round(e.height * s), template };
  }
  // `atlas.atlas` (the packed sprite Mat) is never used by getBestMatch — only `entries[].template`
  // is — so we reference the original here and never delete it from a scaled copy.
  return { atlas: atlas.atlas, entries };
}

/** Delete every (scaled) template Mat in an atlas built by {@link scaleAtlas}. */
function disposeScaledAtlas<K extends string>(scaled: MatchingAtlas<K>): void {
  for (const key of Object.keys(scaled.entries) as K[]) scaled.entries[key].template.delete();
}

/**
 * The five per-locale field atlases the gem-row loop matches against, each pre-scaled to a session's
 * measured on-screen UI scale ONCE (via {@link buildScaledFieldAtlases}). Passing this to
 * {@link extractNineGems} (with the matching `geomScale`) lets the live fast path read non-standard
 * resolutions without rescaling templates per frame — the per-frame cost that made the icon-seed
 * approach slow.
 */
export interface ScaledFieldAtlases {
  gemImage: LoadedGemAsset['atlasGemImage'][GemRecognitionLocale];
  willPower: LoadedGemAsset['atlasWillPower'][GemRecognitionLocale];
  corePoint: LoadedGemAsset['atlasCorePoint'][GemRecognitionLocale];
  optionName: LoadedGemAsset['atlasOptionName'][GemRecognitionLocale];
  optionLevel: LoadedGemAsset['atlasOptionLevel'][GemRecognitionLocale];
}

/**
 * Pre-scale the five gem-row field atlases for `locale` by the on-screen UI scale `g`. Build once per
 * screen-share session (the scale can't change mid-session); the caller MUST dispose the result via
 * {@link disposeScaledFieldAtlases} when the session ends or the scale is re-measured.
 */
export function buildScaledFieldAtlases(
  cv: CV,
  asset: LoadedGemAsset,
  locale: GemRecognitionLocale,
  g: number
): ScaledFieldAtlases {
  return {
    gemImage: scaleAtlas(cv, asset.atlasGemImage[locale], g),
    willPower: scaleAtlas(cv, asset.atlasWillPower[locale], g),
    corePoint: scaleAtlas(cv, asset.atlasCorePoint[locale], g),
    optionName: scaleAtlas(cv, asset.atlasOptionName[locale], g),
    optionLevel: scaleAtlas(cv, asset.atlasOptionLevel[locale], g),
  };
}

/** Delete every scaled template Mat in a {@link ScaledFieldAtlases} bundle. */
export function disposeScaledFieldAtlases(s: ScaledFieldAtlases): void {
  disposeScaledAtlas(s.gemImage);
  disposeScaledAtlas(s.willPower);
  disposeScaledAtlas(s.corePoint);
  disposeScaledAtlas(s.optionName);
  disposeScaledAtlas(s.optionLevel);
}

/** Page attribute from the per-gem icons: Order when at least half the gems are Order, else Chaos. */
export function deriveAttr(gems: ArkGridGem[]): ArkGridAttr {
  const orderCount = gems.filter((g) => g.gemAttr === 'Order').length;
  return orderCount * 2 >= gems.length ? 'Order' : 'Chaos';
}

// Canonical gem-row pitch in FHD pixels (icon top to icon top of the next row).
const ROW_PITCH = 63;

/**
 * Precise on-screen UI scale from the icon-row pitch: (last row y − first row y) / (63 × gaps). The
 * long baseline (~8 rows) makes this far more accurate than a single tiny-icon seed match, whose
 * correlation peak wobbles a few percent. Falls back to `seedScale` when fewer than 2 rows are known.
 */
export function scaleFromPitch(rows: { y: number }[], seedScale: number): number {
  if (rows.length < 2) return seedScale;
  return (rows[rows.length - 1].y - rows[0].y) / (ROW_PITCH * (rows.length - 1));
}

/**
 * Read the 9 gem rows below a located anchor. Shared by the live `processFrame` path and the
 * fresh-scale {@link recognizeGems}; pass `debugCtx` to draw the per-match overlay (live only).
 *
 * `geomScale` (g) is the on-screen UI scale: 1 = templates match the frame at native FHD size (the
 * header-anchored standard path, used by {@link recognizeGems} and the live 16:9 loop). When g ≠ 1
 * the row geometry is scaled by g and every field is matched against templates scaled by g — either
 * `scaledAtlases` when the caller pre-built them once (the live non-standard fast path) or copies
 * built and disposed here — so recognition runs directly on the NATIVE frame with no resample. At
 * g === 1 with no `scaledAtlases`, every `* g` collapses to the original integer literal and the
 * asset's templates are used directly, i.e. behaviour is unchanged from the FHD-only path.
 */
export function extractNineGems(
  cv: CV,
  frame: CvMat,
  asset: LoadedGemAsset,
  locale: GemRecognitionLocale,
  gemAttr: ArkGridAttr,
  anchorX: number,
  anchorY: number,
  thresholds: RecognitionThresholds,
  detectionMargin: number,
  debugCtx?: DebugCtx,
  geomScale = 1,
  scaledAtlases?: ScaledFieldAtlases
): ArkGridGem[] {
  const g = geomScale;
  const scaling = g !== 1;
  // Match against caller-provided pre-scaled atlases (live fast path) when supplied; else build scaled
  // copies here when g ≠ 1 (disposed in the finally below); else (g === 1) match the asset templates
  // directly. `ownScaled` = "we built them", so only those get disposed — never the caller's bundle.
  const ownScaled = scaling && !scaledAtlases;
  const gemImageAtlas = scaledAtlases?.gemImage ?? (scaling ? scaleAtlas(cv, asset.atlasGemImage[locale], g) : asset.atlasGemImage[locale]);
  const willPowerAtlas = scaledAtlases?.willPower ?? (scaling ? scaleAtlas(cv, asset.atlasWillPower[locale], g) : asset.atlasWillPower[locale]);
  const corePointAtlas = scaledAtlases?.corePoint ?? (scaling ? scaleAtlas(cv, asset.atlasCorePoint[locale], g) : asset.atlasCorePoint[locale]);
  const optionNameAtlas = scaledAtlases?.optionName ?? (scaling ? scaleAtlas(cv, asset.atlasOptionName[locale], g) : asset.atlasOptionName[locale]);
  const optionLevelAtlas = scaledAtlases?.optionLevel ?? (scaling ? scaleAtlas(cv, asset.atlasOptionLevel[locale], g) : asset.atlasOptionLevel[locale]);

  const gems: ArkGridGem[] = [];
  try {
    for (let i = 0; i < 9; i++) {
      // Compute the gem row position (height 61px, gap 2px), scaled to the on-screen UI.
      const rowX = anchorX - 287 * g;
      const rowY = anchorY + (213 + 63 * i) * g;

      // 1) Gem type (name)
      const gemName = findBest(
        cv,
        {
          roi: { x: rowX + 9 * g, y: rowY + 14 * g, width: 30 * g, height: 30 * g },
          atlas: gemImageAtlas,
          threshold: thresholds.gemImage - detectionMargin,
        },
        frame,
        debugCtx
      );

      // 2) Willpower
      const willPower = findBest(
        cv,
        {
          roi: { x: rowX + 65 * g, y: rowY, width: 18 * g, height: 30 * g },
          atlas: willPowerAtlas,
          threshold: thresholds.willPower - detectionMargin,
        },
        frame,
        debugCtx
      );

      // 3) Order/Chaos point
      const corePoint = findBest(
        cv,
        {
          roi: { x: rowX + 65 * g, y: rowY + 30 * g, width: 18 * g, height: 30 * g },
          atlas: corePointAtlas,
          threshold: thresholds.corePoint - detectionMargin,
        },
        frame,
        debugCtx
      );

      // 4) Extract gem options
      type GemOptionResult = {
        optionName: MatchingResult<KeyOptionString> | null;
        optionLevel: MatchingResult<KeyOptionLevel> | null;
        yOffset: number;
      };
      const optionTop: GemOptionResult = {
        optionName: null,
        optionLevel: null,
        yOffset: 0,
      };
      const optionBottom: GemOptionResult = {
        optionName: null,
        optionLevel: null,
        yOffset: 30 * g, // the bottom option sits 30px below
      };

      for (const targetOption of [optionTop, optionBottom]) {
        // Option name
        const optionNameRoi = {
          x: rowX + 125 * g,
          y: rowY + targetOption.yOffset,
          width: 200 * g,
          height: 30 * g,
        };
        let optionName = findBest(
          cv,
          {
            roi: optionNameRoi,
            atlas: optionNameAtlas,
            threshold: thresholds.optionName - detectionMargin,
          },
          frame,
          locale === 'ru_ru' ? null : debugCtx
        );

        // For ru_ru, "AtkPower" gets captured from the "AllyAttackEnh" string
        if (optionName !== null && locale === 'ru_ru' && optionName.key === 'AtkPower') {
          // So check again against an atlas that excludes "AtkPower"
          const tempOptionName = findBest(
            cv,
            {
              roi: optionNameRoi,
              atlas: optionNameAtlas,
              threshold: thresholds.optionName - detectionMargin,
            },
            frame,
            null,
            {
              excludeKey: 'AtkPower',
            }
          );
          if (tempOptionName) {
            // If it's still found, this is actually "AllyAttackEnh"
            optionName = tempOptionName;
          } else {
            // "AllyAttackEnh" wasn't found, so it's "AtkPower"
          }
        }

        if (locale === 'ru_ru') {
          // Draw the debug that findBest didn't draw
          // XXX When not found we'd want to show that it wasn't found, but we can't here
          if (debugCtx && optionName) {
            showMatch(debugCtx, optionNameRoi, optionName, {
              scoreThreshold: thresholds.optionName - detectionMargin,
            });
          }
        }

        // Option level
        // The level sits 16px past the position found above (template.cols is already at scale g)
        const optionLevelXOffset = optionName
          ? optionName.loc.x - optionNameRoi.x + optionName.template.cols + 16 * g
          : 60 * g;

        const optionLevel = findBest(
          cv,
          {
            roi: {
              x: rowX + 125 * g + optionLevelXOffset,
              y: rowY + targetOption.yOffset,
              width: 48 * g,
              height: 30 * g,
            },
            atlas: optionLevelAtlas,
            threshold: thresholds.optionLevel - detectionMargin,
          },
          frame,
          debugCtx
        );

        targetOption.optionName = optionName;
        targetOption.optionLevel = optionLevel;
      }

      if (
        gemName !== null &&
        willPower !== null &&
        corePoint !== null &&
        optionTop.optionName !== null &&
        optionTop.optionLevel !== null &&
        optionBottom.optionName !== null &&
        optionBottom.optionLevel !== null
      ) {
        const gem: ArkGridGem = {
          // Each gem's attribute is intrinsic to its icon; the page `gemAttr` is only a fallback for
          // the impossible case of a name absent from the specs. Grade is attr-independent, so this is
          // result-identical to passing the page attr on a homogeneous page (the accuracy harness).
          gemAttr: ArkGridGemSpecs[gemName.key]?.attr ?? gemAttr,
          name: gemName.key,
          req: Number(willPower.key),
          point: Number(corePoint.key),
          option1: {
            optionType: optionTop.optionName.key,
            value: Number(optionTop.optionLevel.key),
          },
          option2: {
            optionType: optionBottom.optionName.key,
            value: Number(optionBottom.optionLevel.key),
          },
        };
        gem.grade = determineGemGradeByGem(gem);
        gems.push(gem);
      }
    }
  } finally {
    if (ownScaled) {
      disposeScaledAtlas(gemImageAtlas);
      disposeScaledAtlas(willPowerAtlas);
      disposeScaledAtlas(corePointAtlas);
      disposeScaledAtlas(optionNameAtlas);
      disposeScaledAtlas(optionLevelAtlas);
    }
  }
  return gems;
}

// Per-locale anchor-relative band over the footer count line(s). en_us: the "(Order N, Chaos N
// owned)" line, x-start AFTER the "(Order " prefix so the capital "O" can't be mistaken for a 0.
// ru_ru: the 2nd footer line "(В наличии: рунитов Порядка – N, рунитов Хаоса – N.)" (Order first,
// Chaos last, lower than EN's line); the band spans both numbers and the Cyrillic between them
// scores below the digit threshold. ko_kr: the 2nd line "(질서 N개, 혼돈 N개 보유 중)" (질서=Order,
// 혼돈=Chaos); band spans both counts, the Hangul between/after scores below threshold. The Hangul
// is digit-height so the band is kept tight (starts after "질서 ", ends before "개 보유 중").
const FOOTER_COUNT_BAND: Partial<
  Record<GemRecognitionLocale, { x: number; y: number; width: number; height: number }>
> = {
  en_us: { x: -132, y: 819, width: 150, height: 20 },
  ru_ru: { x: -74, y: 857, width: 170, height: 14 },
  ko_kr: { x: -145, y: 823, width: 105, height: 14 },
};
// Per-locale digit-match cutoff. EN/RU: real digits score ≥0.89, spurious letter/bracket strokes
// ≤0.81 → 0.85. KO: Hangul has vertical strokes that hit "1" up to ~0.87 and its clean digits score
// ≥0.93, so it needs a higher bar; soft/stream KO frames whose digits fall below it read partial
// (by design — a clean screenshot reads fully).
const OWNED_DIGIT_THRESHOLD: Record<GemRecognitionLocale, number> = {
  en_us: 0.85,
  ru_ru: 0.85,
  ko_kr: 0.9,
};
const OWNED_DIGIT_NMS_X = 4; // suppress overlapping matches within this many px (one digit per spot)
const OWNED_DIGIT_MAX_PITCH = 18; // adjacent digits ≤this px apart = same number; a wider gap (the
//   ", Chaos " / " owned" words between the two counts) starts the next number

/**
 * Read the per-attribute owned counts from the in-game footer ("Astrogems Owned … (Order N, Chaos N
 * owned)") — the count-checksum source. Approach: slide the footer-digit templates over the count
 * line, keep peaks above threshold (letters/brackets score lower and drop out), non-max-suppress to
 * one digit per spot, then group the surviving digits left-to-right by x-pitch — digits close
 * together form one number, the wide gaps over ", Chaos " / " owned" split them. The first number is
 * Order, the last is Chaos. Returns null when the locale has no footer-digit atlas / geometry.
 *
 * NOTE: a count containing a digit with no template (ko_kr/ru_ru have none yet) mis-reads — the
 * checksum is best-effort until a locale's templates are complete. (en_us ships the full 0–9 set.)
 */
export function readOwnedCount(
  cv: CV,
  frame: CvMat,
  asset: LoadedGemAsset,
  anchorX: number,
  anchorY: number,
  locale: GemRecognitionLocale
): OwnedCount | null {
  const band = FOOTER_COUNT_BAND[locale];
  const atlas = asset.atlasOwnedDigit[locale];
  if (!band || !atlas) return null;
  const rx = anchorX + band.x;
  const ry = anchorY + band.y;
  if (rx < 0 || ry < 0 || rx + band.width > frame.cols || ry + band.height > frame.rows) return null;

  const roi = frame.roi(new cv.Rect(rx, ry, band.width, band.height));
  try {
    // 1. Digit candidates: slide each template, keep peaks above threshold.
    const cands: { d: string; x: number; score: number }[] = [];
    for (const d of Object.keys(atlas.entries)) {
      const tpl = atlas.entries[d].template;
      if (tpl.cols > roi.cols || tpl.rows > roi.rows) continue;
      const res = new cv.Mat();
      cv.matchTemplate(roi, tpl, res, cv.TM_CCOEFF_NORMED);
      const data = res.data32F;
      const cols = res.cols;
      for (let i = 0; i < data.length; i++) {
        if (data[i] > OWNED_DIGIT_THRESHOLD[locale]) cands.push({ d, x: i % cols, score: data[i] });
      }
      res.delete();
    }
    // 2. Non-max suppression by x-proximity (keep the highest-scoring digit per location).
    cands.sort((a, b) => b.score - a.score);
    const kept: { d: string; x: number }[] = [];
    for (const c of cands) if (kept.every((k) => Math.abs(k.x - c.x) >= OWNED_DIGIT_NMS_X)) kept.push(c);

    // 3. Order the kept digits left-to-right and group them into numbers by x-pitch: digits within
    //    OWNED_DIGIT_MAX_PITCH px are one number; the wide gaps over ", Chaos " / " owned" split
    //    them. The first number is Order, the last is Chaos. (Pitch-grouping the matched digits is
    //    robust to the narrow "1", whose inter-digit gap rivals a word space — a column-gap
    //    tokenizer can't tell those apart and would split e.g. "18" into "1" and "8".)
    kept.sort((a, b) => a.x - b.x);
    const numbers: string[] = [];
    let cur = '';
    let prevX = -Infinity;
    for (const k of kept) {
      if (k.x - prevX > OWNED_DIGIT_MAX_PITCH && cur) {
        numbers.push(cur);
        cur = '';
      }
      cur += k.d;
      prevX = k.x;
    }
    if (cur) numbers.push(cur);

    const toNum = (str: string | undefined) => (str && str.length > 0 ? parseInt(str, 10) : null);
    return {
      order: toNum(numbers[0]),
      chaos: numbers.length >= 2 ? toNum(numbers[numbers.length - 1]) : null,
    };
  } finally {
    roi.delete();
  }
}

/**
 * Recognize all gems in a single decoded grayscale frame. Measures the UI scale fresh every call
 * (no caching), normalizes the frame to FHD scale, locates the anchor over the full frame, then
 * reads the gem rows. Returns null when no anchor is found. Borrows `gray` (does NOT delete it);
 * deletes everything it allocates.
 */
export function recognizeGems(
  cv: CV,
  gray: CvMat,
  asset: LoadedGemAsset,
  opts: {
    thresholds: RecognitionThresholds;
    anchorScaleLadder: number[];
    detectionMargin?: number;
  }
): RecognizeResult | null {
  let detectionMargin = opts.detectionMargin ?? 0;
  let resizedFrame: CvMat | null = null;
  try {
    // Measure the UI scale once by multi-scale matching the anchor over the full raw frame.
    const measured = multiScaleAnchorMatch(cv, gray, asset.atlasAnchor, opts.anchorScaleLadder);
    if (!measured || measured.score < opts.thresholds.anchor - detectionMargin) {
      return null;
    }
    // Snap to a canonical resolution tier when close (font rendering biases the peak ~1-2%).
    const resolutionScale = snapResolutionScale(rawScaleToResolutionScale(measured.scale));

    // Normalize the frame to FHD scale so the existing offsets/templates line up. INTER_AREA is
    // ideal when SHRINKING (resolutionScale < 1, i.e. a UI larger than FHD such as native QHD/4K),
    // but on a sub-FHD UI (resolutionScale > 1 — e.g. a windowed or forced-21:9 client) we ENLARGE,
    // and INTER_AREA degrades to nearest-neighbour there, blurring the tiny digit/level templates
    // below threshold. Pick the interpolation by direction so recognition holds at ANY UI scale.
    resizedFrame = new cv.Mat();
    cv.resize(
      gray,
      resizedFrame,
      new cv.Size(Math.round(gray.cols * resolutionScale), Math.round(gray.rows * resolutionScale)),
      0,
      0,
      resolutionScale > 1 ? cv.INTER_CUBIC : cv.INTER_AREA
    );

    if (resolutionScale !== 1) {
      // Add extra margin when we resample on our own
      detectionMargin += 0.1;
    }

    // 1. Find the anchor in the normalized (FHD-scale) frame — full-frame search.
    const anchor = findBest(
      cv,
      {
        roi: { x: 0, y: 0, width: resizedFrame.cols, height: resizedFrame.rows },
        atlas: asset.atlasAnchor,
        threshold: opts.thresholds.anchor - detectionMargin,
      },
      resizedFrame
    );
    if (!anchor) return null;
    const locale = anchor.key;
    const anchorX = anchor.loc.x;
    const anchorY = anchor.loc.y;

    // 2. Search for the Order or Chaos label
    const gemAttr = findBest(
      cv,
      {
        roi: { x: anchorX - 186, y: anchorY + 91, width: 224, height: 32 },
        atlas: asset.atlasGemAttr[locale],
        threshold: opts.thresholds.gemAttr - detectionMargin,
      },
      resizedFrame
    );
    if (!gemAttr) return null;

    // 3. Read the 9 gem rows.
    const gems = extractNineGems(
      cv,
      resizedFrame,
      asset,
      locale,
      gemAttr.key,
      anchorX,
      anchorY,
      opts.thresholds,
      detectionMargin
    );
    const owned = readOwnedCount(cv, resizedFrame, asset, anchorX, anchorY, locale);
    return { locale, gemAttr: gemAttr.key, gems, owned };
  } finally {
    if (resizedFrame) resizedFrame.delete();
  }
}
