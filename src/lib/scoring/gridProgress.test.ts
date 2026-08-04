import { describe, expect, it } from 'vitest';

import { computeGridProgress, sumOptionLevels } from './gridProgress';

/** The owner's real numbers from the retired panel: current +43.86%, ceiling +55.95%. */
const REAL = { score: 43.86, bestScore: 55.95, perfectScore: 72.0 };

describe('computeGridProgress', () => {
  it('reports how close the grid is to its own ceiling, not to perfection', () => {
    const p = computeGridProgress(REAL)!;
    expect(p.pctOfCeiling).toBeCloseTo(78.4, 1); // the headline "how far along" number
    expect(p.current).toBe(43.86);
    expect(p.ceiling).toBe(55.95);
  });

  it('places the fill and the ceiling divider on one scale so their ratio is the progress', () => {
    const p = computeGridProgress(REAL)!;
    // both are percentages of the full track, which runs to `perfect`
    expect(p.fillPos).toBeCloseTo((43.86 / 72) * 100, 4);
    expect(p.ceilingPos).toBeCloseTo((55.95 / 72) * 100, 4);
    expect((p.fillPos / p.ceilingPos) * 100).toBeCloseTo(p.pctOfCeiling, 4);
  });

  it('treats a degenerate solve as no data rather than dividing by zero', () => {
    // solverWorker emits this for an assignment-only solve
    expect(computeGridProgress({ score: 0, bestScore: 0, perfectScore: 0 })).toBeNull();
    expect(computeGridProgress(undefined)).toBeNull();
  });

  it('never lets the bar overflow when the grid meets or beats its ceiling', () => {
    const p = computeGridProgress({ score: 60, bestScore: 55.95, perfectScore: 72 })!;
    expect(p.pctOfCeiling).toBe(100);
    expect(p.fillPos).toBeLessThanOrEqual(100);
  });

  it('falls back to the ceiling as the full track when perfect is not above it', () => {
    // guards a malformed scoreSet; the ceiling must still be reachable at the track end
    const p = computeGridProgress({ score: 25, bestScore: 50, perfectScore: 10 })!;
    expect(p.ceilingPos).toBe(100);
    expect(p.fillPos).toBeCloseTo(50, 4);
  });
});

describe('sumOptionLevels', () => {
  const gem = (t1: string, v1: number, t2: string, v2: number) =>
    ({ option1: { optionType: t1, value: v1 }, option2: { optionType: t2, value: v2 } }) as never;

  it('sums every option level across all assigned gems', () => {
    const rows = sumOptionLevels({
      assignedGems: [
        [gem('AtkPower', 3, 'BossDamage', 4)],
        [gem('AtkPower', 2, 'BrandPower', 5)],
      ],
    } as never);
    expect(rows).toEqual([
      { name: 'Atk. Power', level: 5 },
      { name: 'Boss Damage', level: 4 },
      { name: 'Brand Power', level: 5 },
    ]);
  });

  it('omits options no assigned gem carries', () => {
    const rows = sumOptionLevels({ assignedGems: [[gem('AtkPower', 1, 'AtkPower', 2)]] } as never);
    expect(rows).toEqual([{ name: 'Atk. Power', level: 3 }]);
  });

  it('returns nothing when there is no solve answer', () => {
    expect(sumOptionLevels(undefined)).toEqual([]);
  });
});
