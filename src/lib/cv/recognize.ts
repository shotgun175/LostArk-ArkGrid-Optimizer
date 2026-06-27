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
import { determineGemGradeByGem } from '../models/arkGridGemSpecs';
import type { MatchingAtlas } from './atlas';
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
 * Read the 9 gem rows below a located anchor on an already-FHD-normalized frame. Shared by the
 * live `processFrame` path and the fresh-scale {@link recognizeGems}; pass `debugCtx` to draw the
 * per-match overlay (live only).
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
  debugCtx?: DebugCtx
): ArkGridGem[] {
  const gems: ArkGridGem[] = [];
  for (let i = 0; i < 9; i++) {
    // Compute the gem row position (height 61px, gap 2px)
    const rowX = anchorX - 287;
    const rowY = anchorY + 213 + 63 * i;

    // 1) Gem type (name)
    const gemName = findBest(
      cv,
      {
        roi: { x: rowX + 9, y: rowY + 14, width: 30, height: 30 },
        atlas: asset.atlasGemImage[locale],
        threshold: thresholds.gemImage - detectionMargin,
      },
      frame,
      debugCtx
    );

    // 2) Willpower
    const willPower = findBest(
      cv,
      {
        roi: { x: rowX + 65, y: rowY, width: 18, height: 30 },
        atlas: asset.atlasWillPower[locale],
        threshold: thresholds.willPower - detectionMargin,
      },
      frame,
      debugCtx
    );

    // 3) Order/Chaos point
    const corePoint = findBest(
      cv,
      {
        roi: { x: rowX + 65, y: rowY + 30, width: 18, height: 30 },
        atlas: asset.atlasCorePoint[locale],
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
      yOffset: 30, // the bottom option sits 30px below
    };

    for (const targetOption of [optionTop, optionBottom]) {
      // Option name
      const optionNameRoi = {
        x: rowX + 125,
        y: rowY + targetOption.yOffset,
        width: 200,
        height: 30,
      };
      let optionName = findBest(
        cv,
        {
          roi: optionNameRoi,
          atlas: asset.atlasOptionName[locale],
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
            atlas: asset.atlasOptionName[locale],
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
      // The level sits 16px past the position found above
      const optionLevelXOffset = optionName
        ? optionName.loc.x - optionNameRoi.x + optionName.template.cols + 16
        : 60;

      const optionLevel = findBest(
        cv,
        {
          roi: {
            x: rowX + 125 + optionLevelXOffset,
            y: rowY + targetOption.yOffset,
            width: 48,
            height: 30,
          },
          atlas: asset.atlasOptionLevel[locale],
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
        gemAttr,
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
  return gems;
}

// Per-locale anchor-relative band over the footer count line(s). en_us: the "(Order N, Chaos N
// owned)" line, x-start AFTER the "(Order " prefix so the capital "O" can't be mistaken for a 0.
// ru_ru: the 2nd footer line "(В наличии: рунитов Порядка – N, рунитов Хаоса – N.)" (Order first,
// Chaos last, lower than EN's line); the band spans both numbers and the Cyrillic between them
// scores below the digit threshold. ko_kr is pending its templates + geometry → no entry, so
// readOwnedCount no-ops for it. See the footer-OCR NEEDS note.
const FOOTER_COUNT_BAND: Partial<
  Record<GemRecognitionLocale, { x: number; y: number; width: number; height: number }>
> = {
  en_us: { x: -132, y: 819, width: 150, height: 20 },
  ru_ru: { x: -74, y: 857, width: 170, height: 14 },
};
const OWNED_DIGIT_THRESHOLD = 0.85; // real footer digits score ≥0.89; spurious letter/bracket strokes ≤0.81
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
        if (data[i] > OWNED_DIGIT_THRESHOLD) cands.push({ d, x: i % cols, score: data[i] });
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

    // Normalize the frame to FHD scale so the existing offsets/templates line up.
    resizedFrame = new cv.Mat();
    cv.resize(
      gray,
      resizedFrame,
      new cv.Size(Math.round(gray.cols * resolutionScale), Math.round(gray.rows * resolutionScale)),
      0,
      0,
      cv.INTER_AREA
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
