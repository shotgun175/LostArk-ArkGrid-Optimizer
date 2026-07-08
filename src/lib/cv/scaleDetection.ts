/** A single multi-scale match candidate. `loc` is in the original (un-downscaled) frame's pixels. */
export interface ScaleCandidate<K extends string = string> {
  key: K;
  scale: number;
  score: number;
  loc: { x: number; y: number };
}

/** Inclusive ladder of candidate scale factors, rounded to kill float drift. */
export function buildScaleLadder(min: number, max: number, step: number): number[] {
  const ladder: number[] = [];
  const decimals = (step.toString().split('.')[1] ?? '').length;
  for (let v = min; v <= max + 1e-9; v += step) {
    ladder.push(Number(v.toFixed(decimals)));
  }
  if (ladder[ladder.length - 1] !== max) ladder.push(max);
  return ladder;
}

/** On-screen UI scale `f` (anchor width / FHD template width) → frame resample factor. */
export function rawScaleToResolutionScale(f: number): number {
  return 1 / f;
}

/** Factor to shrink a wide frame to at most `maxWidth` before the scale search (1 = no shrink). */
export function computeSearchDownscale(frameWidth: number, maxWidth: number): number {
  return frameWidth > maxWidth ? maxWidth / frameWidth : 1;
}

/**
 * The game UI scales in discrete tiers tied to resolution (1080/1440/2160 → resample
 * factor 1.0/0.75/0.5). Anchor correlation lands in the right tier but is ~1-2% biased
 * by font/anti-aliasing rendering, which drifts distant ROIs off-target. Snap the measured
 * resample factor to the nearest canonical tier when within tolerance; otherwise keep the
 * measured value (for genuinely non-standard window sizes that fall between tiers).
 */
export function snapResolutionScale(
  scale: number,
  canonicals: number[] = [0.5, 0.75, 1.0],
  tolerance = 0.03
): number {
  let best = scale;
  let bestDiff = tolerance;
  for (const c of canonicals) {
    const diff = Math.abs(scale - c);
    if (diff <= bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best;
}

/** Highest-scoring candidate; first wins on a tie; null if empty. */
export function chooseBestScale<K extends string>(
  candidates: ScaleCandidate<K>[]
): ScaleCandidate<K> | null {
  let best: ScaleCandidate<K> | null = null;
  for (const c of candidates) {
    if (!best || c.score > best.score) best = c;
  }
  return best;
}

/**
 * Seed the non-standard on-screen UI scale `g0` from the captured frame HEIGHT, used to NARROW the
 * calibration sweep (the worker already receives the height each frame). The game UI's discrete tiers
 * are 1080→g 1.0, 1440→g 1.333, 2160→g 2.0. {@link snapResolutionScale} works in RESAMPLE-FACTOR space
 * (canonicals [0.5,0.75,1.0]) — the exact inverses of those g tiers — so invert → snap → invert reuses
 * the tested tier-snap: a near-tier windowed height snaps to its tier, a genuinely between-tier window
 * keeps its measured value. The ~27px Windows title bar is subtracted to match the standard path's
 * sub-FHD formula; the ±band in {@link buildNarrowScaleLadder} absorbs any residual.
 */
export function seedGeomScaleFromHeight(height: number, titlebarPx = 27): number {
  const usable = Math.max(1, height - titlebarPx);
  return 1 / snapResolutionScale(1080 / usable);
}

/**
 * A narrow scale ladder centred on the height seed `g0` (±`frac`, default 15%) for the FAST first
 * non-standard calibration attempt — ~7–13 scales vs the full 41, since the icon-row pitch measurement
 * (`scaleFromPitch`) and `refineScale` (±0.04) supply the final precision, so the seed only has to land
 * in the neighbourhood. Bounds are rounded to 2dp so {@link buildScaleLadder}'s trailing-max append
 * doesn't add a near-duplicate scale.
 */
export function buildNarrowScaleLadder(g0: number, frac = 0.15, step = 0.05): number[] {
  const lo = Math.max(step, Number((g0 * (1 - frac)).toFixed(2)));
  const hi = Number((g0 * (1 + frac)).toFixed(2));
  return buildScaleLadder(lo, hi, step);
}
