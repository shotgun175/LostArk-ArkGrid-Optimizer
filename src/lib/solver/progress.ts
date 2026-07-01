function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

/**
 * Map a single solver pass's 0–100% onto its slice of an N-pass run.
 *
 * A full optimization runs several worker solves back-to-back (live per role, then the perfect-grid
 * pass per role), each of which sweeps its own 0→100%. Feeding those raw per-pass percentages to the
 * progress bar makes it reset to 0 at every pass boundary. Remapping each pass into `[i/N, (i+1)/N]`
 * yields one monotonic bar for the whole operation.
 */
export function overallPercent(passIndex: number, passCount: number, passPercent: number): number {
  const clamped = clampPercent(passPercent);
  if (passCount <= 0) {
    return clamped;
  }
  return ((passIndex + clamped / 100) / passCount) * 100;
}
