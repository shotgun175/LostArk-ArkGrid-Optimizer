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
