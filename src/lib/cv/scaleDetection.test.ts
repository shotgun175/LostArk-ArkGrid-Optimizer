import { describe, expect, it } from 'vitest';

import {
  buildNarrowScaleLadder,
  buildScaleLadder,
  chooseBestScale,
  computeSearchDownscale,
  rawScaleToResolutionScale,
  seedGeomScaleFromHeight,
  snapResolutionScale,
} from './scaleDetection';

describe('buildScaleLadder', () => {
  it('produces inclusive, rounded steps', () => {
    expect(buildScaleLadder(0.5, 2.5, 0.5)).toEqual([0.5, 1, 1.5, 2, 2.5]);
  });
  it('includes the max even with float drift', () => {
    const ladder = buildScaleLadder(1, 2, 0.1);
    expect(ladder[0]).toBe(1);
    expect(ladder[ladder.length - 1]).toBe(2);
    expect(ladder).toContain(1.5);
  });
});

describe('rawScaleToResolutionScale', () => {
  it('inverts the measured scale', () => {
    expect(rawScaleToResolutionScale(2)).toBe(0.5);
    expect(rawScaleToResolutionScale(1)).toBe(1);
    expect(rawScaleToResolutionScale(0.5)).toBe(2);
  });
});

describe('computeSearchDownscale', () => {
  it('downscales only when wider than the cap', () => {
    expect(computeSearchDownscale(3840, 1600)).toBeCloseTo(1600 / 3840, 6);
    expect(computeSearchDownscale(1280, 1600)).toBe(1);
    expect(computeSearchDownscale(1600, 1600)).toBe(1);
  });
});

describe('snapResolutionScale', () => {
  it('snaps near-canonical values to the canonical tier', () => {
    expect(snapResolutionScale(0.763)).toBe(0.75); // measured QHD → 0.75
    expect(snapResolutionScale(0.49)).toBe(0.5);
    expect(snapResolutionScale(1.0)).toBe(1.0);
    expect(snapResolutionScale(0.98)).toBe(1.0);
  });
  it('keeps genuinely non-canonical values (between tiers)', () => {
    expect(snapResolutionScale(0.83)).toBe(0.83);
    expect(snapResolutionScale(0.62)).toBe(0.62);
  });
});

describe('chooseBestScale', () => {
  const r = (scale: number, score: number) => ({ scale, score, loc: { x: 0, y: 0 }, key: 'en_us' });
  it('returns the highest-scoring candidate', () => {
    expect(chooseBestScale([r(1, 0.4), r(1.5, 0.92), r(2, 0.7)])?.scale).toBe(1.5);
  });
  it('returns null for an empty list', () => {
    expect(chooseBestScale([])).toBeNull();
  });
  it('keeps the first on a tie', () => {
    expect(chooseBestScale([r(1, 0.9), r(2, 0.9)])?.scale).toBe(1);
  });
});

describe('seedGeomScaleFromHeight', () => {
  it('maps the canonical resolution tiers to their on-screen UI scale', () => {
    expect(seedGeomScaleFromHeight(1080)).toBe(1.0); // FHD → g 1.0
    expect(seedGeomScaleFromHeight(2160)).toBe(2.0); // UHD → g 2.0
    expect(seedGeomScaleFromHeight(1440)).toBeCloseTo(1.3333, 3); // QHD → g 1.333
  });
  it('keeps a genuinely between-tier windowed height un-snapped', () => {
    // usable 1323 → 1323/1080 = 1.225, no canonical resample tier within tolerance.
    expect(seedGeomScaleFromHeight(1350)).toBeCloseTo(1.225, 2);
  });
  it('clamps a degenerate tiny height to a finite positive scale', () => {
    const g = seedGeomScaleFromHeight(20);
    expect(Number.isFinite(g)).toBe(true);
    expect(g).toBeGreaterThan(0);
  });
});

describe('buildNarrowScaleLadder', () => {
  it('brackets the seed by ±15% and stays far smaller than the full ladder', () => {
    const narrow = buildNarrowScaleLadder(1.0);
    expect(narrow[0]).toBe(0.85);
    expect(narrow[narrow.length - 1]).toBe(1.15);
    expect(narrow).toContain(1.0);
    expect(narrow.length).toBeLessThan(buildScaleLadder(0.5, 2.5, 0.05).length); // 41
  });
  it('centres on higher seeds too', () => {
    const narrow = buildNarrowScaleLadder(2.0);
    expect(narrow[0]).toBe(1.7);
    expect(narrow[narrow.length - 1]).toBe(2.3);
  });
});
