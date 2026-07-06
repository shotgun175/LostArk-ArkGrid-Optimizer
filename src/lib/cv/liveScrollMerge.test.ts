import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { mergeScrolledGems } from './liveScrollMerge';

// isSameArkGridGem compares gemAttr / req / point / options (name only when both are set), so gems
// with equal req are "same" and different req are distinct. Vary req to build controlled fixtures.
const mk = (req: number): ArkGridGem => ({
  gemAttr: 'Order',
  req,
  point: 5,
  option1: { optionType: 'AtkPower', value: 1 },
  option2: { optionType: 'AddDamage', value: 1 },
});
const reqs = (gems: ArkGridGem[]) => gems.map((g) => g.req);

describe('mergeScrolledGems', () => {
  it('seeds an empty list with whatever is on screen (need not be a full nine)', () => {
    const r = mergeScrolledGems([], [mk(1), mk(2), mk(3)]);
    expect(r.changed).toBe(true);
    expect(reqs(r.gems)).toEqual([1, 2, 3]);
    expect(r.scroll).toBe('bottom');
  });

  it('ignores a partial (non-nine) screen once the list is non-empty', () => {
    const total = [mk(1), mk(2), mk(3)];
    const r = mergeScrolledGems(total, [mk(4), mk(5)]);
    expect(r.changed).toBe(false);
    expect(r.gems).toBe(total); // untouched, same reference
  });

  it('appends the non-overlapping tail on a downward scroll', () => {
    const total = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mk);
    const current = [6, 7, 8, 9, 10, 11, 12, 13, 14].map(mk); // last 4 known + 5 new
    const r = mergeScrolledGems(total, current);
    expect(r.changed).toBe(true);
    expect(reqs(r.gems)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(r.scroll).toBe('bottom');
  });

  it('prepends the non-overlapping head on an upward scroll', () => {
    const total = [6, 7, 8, 9, 10, 11, 12, 13, 14].map(mk);
    const current = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mk); // first gem unknown -> upward
    const r = mergeScrolledGems(total, current);
    expect(r.changed).toBe(true);
    expect(reqs(r.gems)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(r.scroll).toBe('top');
  });

  it('adds nothing when the whole screen is already known (overlap of nine)', () => {
    const total = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mk);
    const r = mergeScrolledGems(total, [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mk));
    expect(r.changed).toBe(false);
  });

  it('adds nothing when the overlap is below the threshold (too-fast scroll)', () => {
    const total = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mk);
    const current = [7, 8, 9, 10, 11, 12, 13, 14, 15].map(mk); // only 3 known
    const r = mergeScrolledGems(total, current);
    expect(r.changed).toBe(false);
  });

  it('appends the tail EXACTLY once when duplicate gems match the anchor at several positions', () => {
    // Regression for the double-count: the anchor (req 1) matches all eight known positions, and the
    // six-long run of duplicates means more than one position clears the threshold. The old code
    // looped over every match and appended [2,3,4] once per qualifying index; this must add it once.
    const total = Array.from({ length: 8 }, () => mk(1));
    const current = [1, 1, 1, 1, 1, 1, 2, 3, 4].map(mk); // six known duplicates + three new
    const r = mergeScrolledGems(total, current);
    expect(r.changed).toBe(true);
    expect(r.gems.length).toBe(11); // 8 + 3, appended once (a double-count would be 14+)
    expect(reqs(r.gems)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4]);
  });

  it('does not fall back to an upward merge when the first gem is present but the downward overlap is below threshold', () => {
    // req 1 is present (downward anchor matches) but the downward run is only 1, below threshold, so
    // no downward merge. The last gem (req 9) DOES anchor a qualifying upward run (9,8,7,6) — the
    // `downIndices.length === 0` guard must suppress that upward merge because the first gem was found.
    const total = [1, 6, 7, 8, 9].map(mk);
    const current = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(mk);
    const r = mergeScrolledGems(total, current);
    expect(r.changed).toBe(false); // dropping the guard would wrongly prepend [1,2,3,4,5]
  });
});
