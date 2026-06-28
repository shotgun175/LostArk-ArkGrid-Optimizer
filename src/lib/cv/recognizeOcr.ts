/**
 * Client-AGNOSTIC single-image gem recognition via OCR (the upload/paste path).
 *
 * Template-matching the gem TEXT only works on the client the templates were cut from (text rendering
 * varies by patch/font/AA/DPI/UI-scale). The gem ICONS are fixed game assets and match on any client,
 * so this path anchors on the icons (reliable scale + per-row position + gem identity) and reads the
 * TEXT with OCR (rendering-invariant). See docs/superpowers/specs/2026-06-27-ocr-recognition-design.md.
 *
 * Platform-agnostic like recognize.ts: the caller injects an {@link OcrRunner} (tesseract.js wrapped
 * for Node or the browser worker) plus the loaded atlas; all image work is OpenCV. v1 = en_us.
 */
import type { CV } from '@techstark/opencv-js';

import type { GemRecognitionLocale } from '../constants/enums';
import { type ArkGridGem } from '../models/arkGridGems';
import { ArkGridGemSpecs, determineGemGradeByGem } from '../models/arkGridGemSpecs';
import { multiScaleAnchorMatch } from './matcher';
import type { LoadedGemAsset, RecognizeResult } from './recognize';
import type { CvMat, OwnedCount } from './types';
import { parseBoundedDigit, snapEffect } from './ocr/vocab';

/** One OCR'd text line with its vertical centre in the supplied Mat's pixel coords. */
export interface OcrLine {
  text: string;
  cy: number;
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
}
/** tesseract.js wrapped for the current platform (Node harness / browser worker). The runner owns the
 *  Mat -> tesseract-input rendering (pngjs in Node, canvas in the worker) plus the OCR call. */
export interface OcrRunner {
  recognizeMat(mat: CvMat, opts: { psm: number; whitelist?: string }): Promise<OcrResult>;
}

// tesseract PSM constants we use (avoids importing the enum into this cv-only module).
const PSM_SINGLE_BLOCK = 6;
const PSM_SINGLE_CHAR = 10;

export interface RecognizeOcrOptions {
  anchorScaleLadder: number[];
  /** Locale for the effect-name vocabulary + OCR language. v1 supports en_us. */
  locale?: GemRecognitionLocale;
  /** Min icon-match score to accept a row (default 0.82). */
  iconThreshold?: number;
  /** Dev-only per-row failure logging (harness use). */
  debug?: (msg: string) => void;
}

/** Up-scale factors before OCR (small game text needs enlarging for tesseract). */
const UP_EFFECT = 3;
const UP_DIGIT = 6;

/**
 * Digit self-similarity repair parameters. tesseract's single-char OCR (PSM 10) intermittently
 * ABSTAINS (returns "") on perfectly-clean digit glyphs — most often "4" — which would otherwise drop
 * an entire row even though the global-Otsu binarization is flawless. But within one screenshot every
 * instance of a digit is the SAME rendered glyph, so an abstained glyph is pixel-near-identical to
 * another instance that DID read. We normalize each glyph to a fixed grid and, for any abstention,
 * adopt the digit of its nearest confident neighbour. Separation is wide and consistent across clients/
 * scales (measured: same-digit glyphs sit <0.09 apart, different digits >0.23), so the threshold below
 * never crosses digit classes — a genuinely unique abstained glyph stays null and the row drops, as
 * before. This is what actually fixes willpower drops on scene-bleed backgrounds (the binarize was never
 * the problem; the OCR engine was). */
const GLYPH_NORM_W = 20;
const GLYPH_NORM_H = 30;
const GLYPH_SAME_MAX_DIST = 0.15;

/** Normalized binary-glyph signature (1 = foreground) of a component, for self-similarity matching. */
function glyphSignature(cv: CV, binCol: CvMat, x: number, y: number, w: number, h: number): Uint8Array {
  const roi = binCol.roi(new cv.Rect(x, y, w, h));
  const small = new cv.Mat();
  cv.resize(roi, small, new cv.Size(GLYPH_NORM_W, GLYPH_NORM_H), 0, 0, cv.INTER_AREA);
  roi.delete();
  const px = small as unknown as { ucharAt(r: number, c: number): number };
  const sig = new Uint8Array(GLYPH_NORM_W * GLYPH_NORM_H);
  for (let yy = 0; yy < GLYPH_NORM_H; yy++)
    for (let xx = 0; xx < GLYPH_NORM_W; xx++) sig[yy * GLYPH_NORM_W + xx] = px.ucharAt(yy, xx) > 127 ? 1 : 0;
  small.delete();
  return sig;
}
/** Fraction of differing cells between two glyph signatures (normalized Hamming distance). */
function glyphDistance(a: Uint8Array, b: Uint8Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff / a.length;
}

/**
 * Find every gem-icon row by anchoring on a reliable seed icon and walking the row grid (pitch 63 in
 * FHD units, scaled by the detected UI scale). At each expected row centre, match all gem templates in
 * a small window at the icon column; keep the best above threshold. Returns rows top->bottom with the
 * matched gem identity. Cheaper + far more robust than the fuzzy "Astrogem" text anchor for scale.
 */
function findIconRows(
  cv: CV,
  frame: CvMat,
  atlas: LoadedGemAsset['atlasGemImage'][GemRecognitionLocale],
  scale: number,
  seedX: number,
  seedY: number,
  threshold: number
): { colX: number; rows: { y: number; key: string }[] } {
  const pitch = 63 * scale;
  const scaled: { key: string; tpl: CvMat; w: number; h: number }[] = [];
  let maxW = 0;
  let maxH = 0;
  const entries = atlas.entries as Record<string, { template: CvMat }>;
  for (const key of Object.keys(entries)) {
    const tpl = entries[key].template;
    const w = Math.max(2, Math.round(tpl.cols * scale));
    const h = Math.max(2, Math.round(tpl.rows * scale));
    const st = new cv.Mat();
    cv.resize(tpl, st, new cv.Size(w, h), 0, 0, scale < 1 ? cv.INTER_AREA : cv.INTER_LINEAR);
    scaled.push({ key, tpl: st, w, h });
    maxW = Math.max(maxW, w);
    maxH = Math.max(maxH, h);
  }
  // Probe a window around (gx,gy) for the best gem-icon match; returns its PRECISE top-left + key so
  // the walk can re-anchor each step (self-correcting against pitch error from a slightly-off scale).
  type Hit = { key: string; score: number; x: number; y: number };
  const probe = (gx: number, gy: number, winPad: number): Hit | null => {
    const rx = Math.round(gx - winPad);
    const ry = Math.round(gy - winPad);
    const rw = maxW + 2 * winPad;
    const rh = maxH + 2 * winPad;
    if (rx < 0 || ry < 0 || rx + rw > frame.cols || ry + rh > frame.rows) return null;
    const roi = frame.roi(new cv.Rect(rx, ry, rw, rh));
    let best: Hit | null = null;
    try {
      for (const s of scaled) {
        const res = new cv.Mat();
        cv.matchTemplate(roi, s.tpl, res, cv.TM_CCOEFF_NORMED);
        const mm = (cv.minMaxLoc as unknown as (m: CvMat) => { maxVal: number; maxLoc: { x: number; y: number } })(res);
        if (!best || mm.maxVal > best.score) best = { key: s.key, score: mm.maxVal, x: rx + mm.maxLoc.x, y: ry + mm.maxLoc.y };
        res.delete();
      }
    } finally {
      roi.delete();
    }
    return best;
  };
  const tight = Math.max(5, Math.round(8 * scale));
  const wide = Math.round(pitch * 0.4); // window per step tolerates drift but stays within the row gap
  const rows: Hit[] = [];
  const seed = probe(seedX, seedY, tight);
  if (seed && seed.score > threshold) {
    rows.push(seed);
    // Walk DOWN then UP from the seed, re-anchoring on each found icon's actual position.
    for (const dir of [1, -1]) {
      let last = seed;
      for (let step = 0; step < 12; step++) {
        const p = probe(last.x, last.y + dir * pitch, wide);
        if (!p || p.score <= threshold) break;
        rows.push(p);
        last = p;
      }
    }
  }
  for (const s of scaled) s.tpl.delete();
  rows.sort((a, b) => a.y - b.y);
  // Crop offsets key off the icon column x: the median of the per-row matched x is robust to any
  // single row that locked a hair off (more stable than the lone seed match).
  const colX = rows.length ? Math.round(rows[Math.floor(rows.length / 2)].x) : Math.round(seedX);
  return { colX, rows: rows.map((r) => ({ y: r.y, key: r.key })) };
}

/** Crop a frame region, up-scale, optionally Otsu-binarize (digit=255 fg). Caller deletes the result. */
function cropMat(
  cv: CV,
  frame: CvMat,
  x: number,
  y: number,
  w: number,
  h: number,
  up: number,
  binarize: boolean
): CvMat | null {
  const ix = Math.max(0, Math.round(x));
  const iy = Math.max(0, Math.round(y));
  const iw = Math.round(w);
  const ih = Math.round(h);
  if (iw < 2 || ih < 2 || ix + iw > frame.cols || iy + ih > frame.rows) return null;
  const roi = frame.roi(new cv.Rect(ix, iy, iw, ih));
  const out = new cv.Mat();
  cv.resize(roi, out, new cv.Size(iw * up, ih * up), 0, 0, cv.INTER_CUBIC);
  roi.delete();
  if (binarize) cv.threshold(out, out, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  return out;
}

/** Read the willpower (top) and points (bottom) digit per row from the icon-adjacent digit column. */
async function readDigits(
  cv: CV,
  frame: CvMat,
  ocr: OcrRunner,
  colX: number,
  rows: { y: number }[],
  scale: number
): Promise<{ willpower: (number | null)[]; points: (number | null)[] }> {
  const r0 = rows[0].y;
  const r8 = rows[rows.length - 1].y;
  const colY0 = Math.max(0, Math.round(r0 - 28 * scale));
  // Column is wide enough not to clip a digit but stops before the atom/"P" icon (~colX+64); the CC
  // width filter below drops the round "P" blob if a sliver sneaks in.
  const col = cropMat(cv, frame, colX + 42 * scale, colY0, 21 * scale, (r8 - r0) + 68 * scale, UP_DIGIT, true);
  const willpower: (number | null)[] = rows.map(() => null);
  const points: (number | null)[] = rows.map(() => null);
  if (!col) return { willpower, points };
  try {
    // Connected components = the actual digit positions (robust to small offset error). OCR each, then
    // map to willpower (y ~ r.y-7) / points (y ~ r.y+14) slots by nearest centroid.
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const cents = new cv.Mat();
    const n = cv.connectedComponentsWithStats(col, labels, stats, cents, 8, cv.CV_32S);
    const minH = 10 * scale * UP_DIGIT;
    const maxH = 30 * scale * UP_DIGIT;
    const minA = 12 * scale * scale * UP_DIGIT * UP_DIGIT;
    const comps: { cy: number; digit: number | null; sig: Uint8Array }[] = [];
    for (let i = 1; i < n; i++) {
      const x = stats.intAt(i, 0);
      const y = stats.intAt(i, 1);
      const w = stats.intAt(i, 2);
      const h = stats.intAt(i, 3);
      const a = stats.intAt(i, 4);
      if (h < minH || h > maxH || a < minA || w > 24 * scale * UP_DIGIT) continue;
      const sig = glyphSignature(cv, col, x, y, w, h);
      const pad = 12;
      const cx0 = Math.max(0, x - pad);
      const cy0 = Math.max(0, y - pad);
      const cw = Math.min(col.cols - cx0, w + 2 * pad);
      const ch = Math.min(col.rows - cy0, h + 2 * pad);
      const sub = col.roi(new cv.Rect(cx0, cy0, cw, ch));
      const inv = new cv.Mat();
      cv.bitwise_not(sub, inv); // black digit on white for OCR
      sub.delete();
      const res = await ocr.recognizeMat(inv, { psm: PSM_SINGLE_CHAR, whitelist: '0123456789' });
      inv.delete();
      comps.push({ cy: y + h / 2, digit: parseBoundedDigit(res.text, 0, 99), sig });
    }
    labels.delete();
    stats.delete();
    cents.delete();
    // Repair tesseract's single-char abstentions: any glyph it failed to read adopts the digit of its
    // nearest confident, visually-identical neighbour (see GLYPH_SAME_MAX_DIST). No-op when every glyph
    // already read (e.g. the clean client-1 fixtures), so this only recovers otherwise-dropped rows.
    const confident = comps.filter((c) => c.digit != null);
    for (const c of comps) {
      if (c.digit != null) continue;
      let bestDigit: number | null = null;
      let bestDist = GLYPH_SAME_MAX_DIST;
      for (const ref of confident) {
        const d = glyphDistance(c.sig, ref.sig);
        if (d < bestDist) {
          bestDist = d;
          bestDigit = ref.digit;
        }
      }
      c.digit = bestDigit;
    }
    const nearest = (targetScreenY: number): number | null => {
      const tImg = (targetScreenY - colY0) * UP_DIGIT;
      let best: { cy: number; digit: number | null } | null = null;
      let bd = Infinity;
      for (const c of comps) {
        const d = Math.abs(c.cy - tImg);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best && bd < 18 * scale * UP_DIGIT ? best.digit : null;
    };
    rows.forEach((r, i) => {
      willpower[i] = nearest((r as { y: number }).y - 7 * scale);
      points[i] = nearest((r as { y: number }).y + 14 * scale);
    });
  } finally {
    col.delete();
  }
  return { willpower, points };
}

/** FHD anchor-relative band over the whole footer block ("Astrogems Owned: X / 100 (Order N, Chaos M
 *  owned)"), deliberately wide + tall so per-client text-position drift can't push the counts out of
 *  frame. tesseract reads the block; the two counts are parsed by keyword (Order / Chaos). */
const FOOTER_BAND = { x: -272, y: 785, width: 510, height: 68 };
const UP_FOOTER = 4;

/**
 * Read the in-game owned-count footer for the count checksum. en_us only in v1 — the Order/Chaos words
 * are English; other locales return null and the stitch degrades to overlap-only (which the relaxed
 * recovery now handles). The footer sits at a fixed spot relative to the "Astrogem" tab, so we locate
 * that tab AT THE ICON SCALE (the gem icons fix the scale client-agnostically; the tab text itself
 * correlates poorly across clients, but its location at the right scale is enough to frame the band).
 * Returns null off the calibrated scales (the band misses), which the checksum tolerates.
 */
async function readFooterCount(
  cv: CV,
  frame: CvMat,
  asset: LoadedGemAsset,
  scale: number,
  locale: GemRecognitionLocale,
  ocr: OcrRunner
): Promise<OwnedCount | null> {
  if (locale !== 'en_us') return null;
  const anchor = multiScaleAnchorMatch(cv, frame, asset.atlasAnchor, [scale]);
  if (!anchor) return null;
  const band = cropMat(
    cv,
    frame,
    anchor.loc.x + FOOTER_BAND.x * scale,
    anchor.loc.y + FOOTER_BAND.y * scale,
    FOOTER_BAND.width * scale,
    FOOTER_BAND.height * scale,
    UP_FOOTER,
    false
  );
  if (!band) return null;
  try {
    const { text } = await ocr.recognizeMat(band, { psm: PSM_SINGLE_BLOCK });
    const order = parseBoundedDigit(text.match(/Order\D{0,4}(\d+)/i)?.[1] ?? '', 0, 100);
    const chaos = parseBoundedDigit(text.match(/Chaos\D{0,4}(\d+)/i)?.[1] ?? '', 0, 100);
    return order == null && chaos == null ? null : { order, chaos };
  } finally {
    band.delete();
  }
}

/**
 * Recognize all gems in a single decoded grayscale frame via OCR. Returns the same {@link
 * RecognizeResult} shape as the template path (so the stitcher / Panel are unchanged), or null when no
 * gem icons are found. Borrows `gray` (does not delete it). `owned` carries the footer count-checksum
 * when the en_us footer reads (see {@link readFooterCount}); null otherwise, which the stitch tolerates.
 */
export async function recognizeGemsOcr(
  cv: CV,
  gray: CvMat,
  asset: LoadedGemAsset,
  ocr: OcrRunner,
  opts: RecognizeOcrOptions
): Promise<RecognizeResult | null> {
  const locale: GemRecognitionLocale = opts.locale ?? 'en_us';
  const iconThreshold = opts.iconThreshold ?? 0.82;
  const gemAtlas = asset.atlasGemImage[locale];

  // 1. Find the UI scale + a seed icon (icons are language-independent fixed assets).
  const seed = multiScaleAnchorMatch(cv, gray, gemAtlas, opts.anchorScaleLadder);
  if (!seed) return null;
  const scale = seed.scale;

  // 2. Enumerate the gem rows from the seed; each row yields gem identity (name + Order/Chaos).
  const { colX, rows } = findIconRows(cv, gray, gemAtlas, scale, seed.loc.x, seed.loc.y, iconThreshold);
  if (rows.length === 0) return null;
  opts.debug?.(`scale=${scale.toFixed(3)} colX=${colX} rows=${rows.length}`);

  // 3. Effect-name column OCR (both option lines per row, all rows in one block); map lines to rows.
  const r0 = rows[0].y;
  const r8 = rows[rows.length - 1].y;
  const effCropY0 = r0 - 20 * scale;
  const effCol = cropMat(cv, gray, colX + 102 * scale, effCropY0, 272 * scale, (r8 - r0) + 66 * scale, UP_EFFECT, false);
  const effLines: OcrLine[] = [];
  if (effCol) {
    const res = await ocr.recognizeMat(effCol, { psm: PSM_SINGLE_BLOCK });
    effCol.delete();
    // Convert each line's centre back to screen y.
    for (const ln of res.lines) effLines.push({ text: ln.text, cy: effCropY0 + ln.cy / UP_EFFECT });
  }
  const nearestLine = (targetScreenY: number): string | null => {
    let best: OcrLine | null = null;
    let bd = Infinity;
    for (const ln of effLines) {
      const d = Math.abs(ln.cy - targetScreenY);
      if (d < bd) {
        bd = d;
        best = ln;
      }
    }
    return best && bd < 16 * scale ? best.text : null;
  };

  // 4. Digits (willpower + points) via connected components.
  const digits = await readDigits(cv, gray, ocr, colX, rows, scale);

  // 4b. Footer owned-count (the stitch checksum) — best-effort; null degrades to overlap-only.
  const owned = await readFooterCount(cv, gray, asset, scale, locale, ocr);

  // 5. Assemble + validate per row.
  const gems: ArkGridGem[] = [];
  let orderCount = 0;
  let chaosCount = 0;
  rows.forEach((row, i) => {
    const spec = ArkGridGemSpecs[row.key as keyof typeof ArkGridGemSpecs];
    if (!spec) return;
    if (spec.attr === 'Order') orderCount++;
    else chaosCount++;
    const opt1 = snapEffect(nearestLine(row.y - 3 * scale) ?? '', locale, spec.availableOptions);
    const opt2 = snapEffect(nearestLine(row.y + 27 * scale) ?? '', locale, spec.availableOptions);
    const req = digits.willpower[i];
    const point = digits.points[i];
    // A row needs both options + a plausible willpower + point to be a usable gem.
    if (!opt1 || !opt2 || req == null || req < 1 || req > 10 || point == null || point < 1 || point > 5) {
      opts.debug?.(
        `  row ${i} DROP: opt1=${opt1 ? opt1.optionType : `null<${nearestLine(row.y - 3 * scale) ?? ''}>`} ` +
          `opt2=${opt2 ? opt2.optionType : `null<${nearestLine(row.y + 27 * scale) ?? ''}>`} req=${req} point=${point}`
      );
      return;
    }
    const gem: ArkGridGem = {
      name: row.key as ArkGridGem['name'],
      gemAttr: spec.attr,
      req,
      point,
      option1: opt1,
      option2: opt2,
    };
    gem.grade = determineGemGradeByGem(gem);
    gems.push(gem);
  });

  const gemAttr = chaosCount >= orderCount ? 'Chaos' : 'Order';
  return { locale, gemAttr, gems, owned };
}
