import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import {
  assembleScreenshots,
  assessCount,
  stitchScreenshot,
  stitchScreenshots,
  suffixPrefixOverlap,
} from './stitch';

// Distinct gem keyed by `req` (just an id for equality here — value ranges don't matter to the
// stitcher, which only calls isSameArkGridGem). Same n => isSameArkGridGem true.
const G = (n: number): ArkGridGem => ({
  gemAttr: 'Order',
  req: n,
  point: 1,
  option1: { optionType: 'AtkPower', value: 1 },
  option2: { optionType: 'AddDamage', value: 1 },
});
const seq = (...ns: number[]) => ns.map(G);

describe('suffixPrefixOverlap', () => {
  it('finds the largest suffix/prefix run', () => {
    expect(suffixPrefixOverlap(seq(1, 2, 6, 7, 8, 9), seq(6, 7, 8, 9, 10, 11))).toBe(4);
    expect(suffixPrefixOverlap(seq(1, 2, 3, 7, 8, 9), seq(7, 8, 9, 20))).toBe(3);
    expect(suffixPrefixOverlap(seq(1, 2, 3), seq(4, 5, 6))).toBe(0);
  });
});

describe('stitchScreenshot', () => {
  it('seeds from empty', () => {
    const r = stitchScreenshot([], seq(1, 2, 3));
    expect(r.mode).toBe('seed');
    expect(r.gems.map((g) => g.req)).toEqual([1, 2, 3]);
  });

  it('appends on a scroll-down overlap (>= minOverlap)', () => {
    const r = stitchScreenshot(seq(1, 2, 3, 4, 5, 6), seq(3, 4, 5, 6, 7, 8));
    expect(r.mode).toBe('append');
    expect(r.overlap).toBe(4);
    expect(r.gems.map((g) => g.req)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('prepends on a scroll-up overlap', () => {
    const r = stitchScreenshot(seq(5, 6, 7, 8, 9), seq(2, 5, 6, 7, 8));
    expect(r.mode).toBe('prepend');
    expect(r.overlap).toBe(4);
    expect(r.gems.map((g) => g.req)).toEqual([2, 5, 6, 7, 8, 9]);
  });

  it('reports contained when the screenshot adds nothing new', () => {
    expect(stitchScreenshot(seq(1, 2, 3, 4, 5), seq(1, 2, 3, 4, 5)).mode).toBe('contained');
    expect(stitchScreenshot(seq(1, 2, 3, 4, 5), seq(1, 2, 3, 4)).mode).toBe('contained'); // prefix subset
  });

  it('does NOT merge below minOverlap (the gap the count checksum catches)', () => {
    // A 3-gem overlap (like the real Order 2 / Order 3 fixtures) is rejected at the default 4...
    const below = stitchScreenshot(seq(1, 2, 3, 7, 8, 9), seq(7, 8, 9, 20, 21, 22));
    expect(below.mode).toBe('nomatch');
    expect(below.overlap).toBe(3);
    // ...but a relaxed threshold merges it (count-driven relaxation is the planned next step).
    const relaxed = stitchScreenshot(seq(1, 2, 3, 7, 8, 9), seq(7, 8, 9, 20, 21, 22), 3);
    expect(relaxed.mode).toBe('append');
    expect(relaxed.gems.map((g) => g.req)).toEqual([1, 2, 3, 7, 8, 9, 20, 21, 22]);
  });
});

describe('stitchScreenshots (fold)', () => {
  it('de-dupes a 4-gem overlap (Chaos 2 + Chaos 3 -> 14, not 18)', () => {
    const chaos2 = seq(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const chaos3 = seq(6, 7, 8, 9, 10, 11, 12, 13, 14); // rows 1-4 == chaos2 rows 6-9
    const out = stitchScreenshots([chaos2, chaos3]);
    expect(out).toHaveLength(14);
    expect(out.map((g) => g.req)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('leaves a sub-threshold (3-overlap) screenshot UNPLACED by default', () => {
    // Order 2 / Order 3 only share 3 gems -> default fold drops Order 3 (gap, not duplication).
    const order2 = seq(1, 2, 3, 4, 5, 6, 7, 8, 9);
    const order3 = seq(7, 8, 9, 20, 21, 22, 23, 24, 25);
    expect(stitchScreenshots([order2, order3])).toHaveLength(9); // order3 unplaced
    expect(stitchScreenshots([order2, order3], 3)).toHaveLength(15); // relaxed: 9 + 6
  });
});

describe('assembleScreenshots (count-driven, B-with-A-fallback)', () => {
  const reqs = (gems: ArkGridGem[]) => gems.map((g) => g.req);

  it('B: clean >=4 overlap, confirmed by the count', () => {
    const r = assembleScreenshots([seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(6, 7, 8, 9, 10, 11, 12, 13, 14)], 14);
    expect(r.method).toBe('count-confirmed');
    expect(r.fragments).toBe(1);
    expect(reqs(r.gems)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(r.status.complete).toBe(true);
  });

  it('B: a 3-gem overlap is accepted when the count confirms it (Order 2 + Order 3)', () => {
    const r = assembleScreenshots([seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(7, 8, 9, 20, 21, 22, 23, 24, 25)], 15);
    expect(r.method).toBe('count-confirmed');
    expect(r.gems).toHaveLength(15);
    expect(r.status.complete).toBe(true);
  });

  it('B: order-tolerant — assembles regardless of upload order', () => {
    const r = assembleScreenshots([seq(6, 7, 8, 9, 10, 11, 12, 13, 14), seq(1, 2, 3, 4, 5, 6, 7, 8, 9)], 14);
    expect(r.method).toBe('count-confirmed');
    expect(reqs(r.gems)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('B: ignores duplicate / contained re-uploads', () => {
    const r = assembleScreenshots(
      [seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(6, 7, 8, 9, 10, 11, 12, 13, 14)],
      14
    );
    expect(r.method).toBe('count-confirmed');
    expect(r.gems).toHaveLength(14);
  });

  it('A fallback: 3-gem overlap with NO target -> conservative, gap flagged, longest only', () => {
    const r = assembleScreenshots([seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(7, 8, 9, 20, 21, 22, 23, 24, 25)], null);
    expect(r.method).toBe('conservative');
    expect(r.fragments).toBe(2); // unbridged gap
    expect(r.gems).toHaveLength(9); // longest fragment only — never double-count an unproven overlap
    expect(r.status.complete).toBeNull();
  });

  it('A fallback: target the relaxed pass cannot confirm -> conservative + undercount', () => {
    const r = assembleScreenshots([seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(7, 8, 9, 20, 21, 22, 23, 24, 25)], 20);
    expect(r.method).toBe('conservative');
    expect(r.gems).toHaveLength(9);
    expect(r.status).toMatchObject({ complete: false, overcount: false, remaining: 11 });
  });

  it('overcount: a wrong-low target is flagged, not silently trusted', () => {
    const r = assembleScreenshots([seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(6, 7, 8, 9, 10, 11, 12, 13, 14)], 12);
    expect(r.method).toBe('conservative'); // relaxed (14) != target (12)
    expect(r.gems).toHaveLength(14);
    expect(r.status.overcount).toBe(true);
  });

  it('empty input', () => {
    const r = assembleScreenshots([], 23);
    expect(r.gems).toHaveLength(0);
    expect(r.fragments).toBe(0);
  });

  it('a gap whose longest fragment coincidentally equals the target stays fragments>1 (UI must not call it complete)', () => {
    // Two disjoint 9-gem shots, target 9: longest fragment length == target, but fragments=2.
    // status.complete is true (length match) — which is exactly why the footer ANDs it with fragments===1.
    const r = assembleScreenshots([seq(1, 2, 3, 4, 5, 6, 7, 8, 9), seq(20, 21, 22, 23, 24, 25, 26, 27, 28)], 9);
    expect(r.method).toBe('conservative');
    expect(r.fragments).toBe(2);
    expect(r.status.complete).toBe(true); // per longest fragment only — not a true "complete"
  });
});

describe('assessCount (the footer checksum)', () => {
  it('flags complete / incomplete / overcount against the per-attr target', () => {
    expect(assessCount(14, 23)).toMatchObject({ complete: false, overcount: false, remaining: 9 });
    expect(assessCount(23, 23)).toMatchObject({ complete: true, overcount: false, remaining: 0 });
    expect(assessCount(18, 15)).toMatchObject({ complete: false, overcount: true, remaining: 0 });
  });

  it('is inert with no target (OCR not available)', () => {
    expect(assessCount(9, null)).toMatchObject({ complete: null, overcount: false, remaining: null });
  });
});
