import { describe, expect, it } from 'vitest';

import { overallPercent } from './progress';

describe('overallPercent', () => {
  it('maps a single pass straight through (0→100 fills the whole bar)', () => {
    expect(overallPercent(0, 1, 0)).toBe(0);
    expect(overallPercent(0, 1, 50)).toBe(50);
    expect(overallPercent(0, 1, 100)).toBe(100);
  });

  it('confines each pass to its own slice of an N-pass run', () => {
    // 2 passes: pass 0 owns 0–50%, pass 1 owns 50–100%.
    expect(overallPercent(0, 2, 0)).toBe(0);
    expect(overallPercent(0, 2, 100)).toBe(50);
    expect(overallPercent(1, 2, 0)).toBe(50);
    expect(overallPercent(1, 2, 100)).toBe(100);
  });

  it('is monotonic across a pass boundary (no reset to 0)', () => {
    const endOfPass0 = overallPercent(0, 4, 100);
    const startOfPass1 = overallPercent(1, 4, 0);
    // The last reading of one pass equals the first reading of the next — the bar never drops.
    expect(startOfPass1).toBe(endOfPass0);
    expect(startOfPass1).toBeGreaterThanOrEqual(endOfPass0);
  });

  it('clamps out-of-range per-pass percentages', () => {
    expect(overallPercent(0, 2, -10)).toBe(0);
    expect(overallPercent(1, 2, 150)).toBe(100);
  });

  it('falls back to the raw percent when there are no passes', () => {
    expect(overallPercent(0, 0, 42)).toBe(42);
  });
});
