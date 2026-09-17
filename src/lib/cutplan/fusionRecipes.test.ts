// Finished-gem fusion recipes: all 10 three-gem mixes of Legendary / Relic / Ancient, priced from the
// baked per-cost tier EVs. The odds rule is a TS port of the vendored model's fusionOutputDist; the
// drift guard below fails if a re-sync changes it.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { type FusionRecipe, bestFusePerGem, fusionOutputDist, fusionRecipes } from './cutPlan';
import realPipeline from './pipeline.json';
import type { PipelineData } from './types';

const require = createRequire(import.meta.url);
const Astrogem = require('../advisor/vendor/model/astrogem.js');

const data = realPipeline as unknown as PipelineData;

// shizukaziye's METHODOLOGY section 4 table (2026-09-16): nA, nR, nL, then % Legendary / Relic / Ancient.
const TABLE: [number, number, number, number, number, number][] = [
  [0, 0, 3, 99, 1, 0],
  [0, 1, 2, 73, 25, 2],
  [0, 2, 1, 46, 50, 4],
  [0, 3, 0, 19, 75, 6],
  [1, 0, 2, 35, 40, 25],
  [1, 1, 1, 8, 65, 27],
  [1, 2, 0, 0, 71, 29],
  [2, 0, 1, 0, 50, 50],
  [2, 1, 0, 0, 48, 52],
  [3, 0, 0, 0, 25, 75],
];

describe('fusionOutputDist', () => {
  it('reproduces the published odds for all 10 three-gem recipes', () => {
    for (const [nA, nR, nL, L, R, A] of TABLE) {
      const mix = fusionOutputDist(nA, nR, nL);
      const pct = [Math.round(mix.legendary * 100), Math.round(mix.relic * 100), Math.round(mix.ancient * 100)];
      expect(pct, `${nA}A ${nR}R ${nL}L`).toEqual([L, R, A]);
      expect(mix.legendary + mix.relic + mix.ancient).toBeCloseTo(1, 12);
    }
  });

  it('matches the vendored model exactly (drift guard for a re-sync)', () => {
    for (const [nA, nR, nL] of TABLE) {
      const inputs = [
        ...Array<string>(nA).fill('ancient'),
        ...Array<string>(nR).fill('relic'),
        ...Array<string>(nL).fill('legendary'),
      ];
      expect(fusionOutputDist(nA, nR, nL), `${nA}A ${nR}R ${nL}L`).toEqual(Astrogem.fusionOutputDist(inputs));
    }
  });
});

describe('fusionRecipes (real pipeline)', () => {
  const gpd = 2_500_000;
  const bl = data.meta.baselines.dps[6];
  const rows = fusionRecipes(data, 'dps', gpd, bl)!;

  it('returns the 10 recipes from all-Legendary to all-Ancient, the three standard ones marked', () => {
    expect(rows.map((r) => r.key)).toEqual([
      '0a0r3l',
      '0a1r2l',
      '0a2r1l',
      '0a3r0l',
      '1a0r2l',
      '1a1r1l',
      '1a2r0l',
      '2a0r1l',
      '2a1r0l',
      '3a0r0l',
    ]);
    expect(rows.filter((r) => r.std).map((r) => r.label)).toEqual([
      '3x Legendary',
      '1 Relic + 2 Legendary',
      '1 Ancient + 2 Legendary',
    ]);
    expect(rows.find((r) => r.key === '1a1r1l')!.label).toBe('1 Ancient + 1 Relic + 1 Legendary');
  });

  it('prices each recipe as the mix-weighted tier EV of the one output gem at each cost', () => {
    const idx = data.meta.baselines.dps.indexOf(bl);
    for (const cost of [8, 9, 10]) {
      const tev = data.axes.dps.fusion[String(gpd)][String(cost)][idx].tierEV;
      for (const r of rows) {
        const want = r.mix.legendary * tev.leg + r.mix.relic * tev.relic + r.mix.ancient * tev.anc;
        expect(r.evByCost[cost], `${r.key} c${cost}`).toBeCloseTo(want, 6);
      }
    }
  });

  it('gives each Ancient / Relic in a recipe its marginal over a Legendary in its place', () => {
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['0a0r3l'].perGem).toEqual({});
    expect(by['1a0r2l'].perGem.relic).toBeUndefined();
    expect(by['1a0r2l'].perGem.ancient![8]).toBeCloseTo(by['1a0r2l'].evByCost[8] - by['0a0r3l'].evByCost[8], 6);
    expect(by['1a1r1l'].perGem.relic![9]).toBeCloseTo(by['1a1r1l'].evByCost[9] - by['1a0r2l'].evByCost[9], 6);
    expect(by['1a1r1l'].perGem.ancient![9]).toBeCloseTo(by['1a1r1l'].evByCost[9] - by['0a1r2l'].evByCost[9], 6);
    // Richer inputs never make the one output gem worth less.
    for (const cost of [8, 9, 10]) {
      expect(by['3a0r0l'].evByCost[cost]).toBeGreaterThan(by['0a0r3l'].evByCost[cost]);
    }
  });

  it('works on the support axis too', () => {
    const sup = fusionRecipes(data, 'support', gpd, data.meta.baselines.support[3])!;
    expect(sup.length).toBe(10);
    expect(sup[9].evByCost[10]).toBeGreaterThan(0);
  });

  it('returns null when the axis has no fusion rows at that budget', () => {
    expect(fusionRecipes(data, 'dps', 123, bl)).toBeNull();
  });
});

describe('bestFusePerGem', () => {
  const row = (key: string, anc: number | null, rel: number | null): FusionRecipe => ({
    key,
    label: key,
    counts: { ancient: 0, relic: 0, legendary: 3 },
    std: false,
    mix: { legendary: 1, relic: 0, ancient: 0 },
    evByCost: { 8: 0, 9: 0, 10: 0 },
    perGem: {
      ...(anc == null ? {} : { ancient: { 8: anc, 9: anc, 10: anc } }),
      ...(rel == null ? {} : { relic: { 8: rel, 9: rel, 10: rel } }),
    },
  });

  it('picks, per cost and tier, the recipe where one gem of that tier adds the most', () => {
    const best = bestFusePerGem([row('a', 100, 10), row('b', 150, 30), row('c', 120, null)]);
    expect(best.ancient[8]?.key).toBe('b');
    expect(best.relic[10]?.key).toBe('b');
  });

  it('treats a lead under 2% as a tie and keeps the earlier (plainer) recipe', () => {
    const best = bestFusePerGem([row('plain', 100, null), row('rich', 101.5, null), row('richer', 103, null)]);
    expect(best.ancient[9]?.key).toBe('richer');
    const tied = bestFusePerGem([row('plain', 100, null), row('rich', 101.9, null)]);
    expect(tied.ancient[9]?.key).toBe('plain');
  });

  it('still picks the largest marginal when they are all negative', () => {
    expect(bestFusePerGem([row('a', -100, null), row('b', -101, null)]).ancient[8]?.key).toBe('a');
  });

  it('has no pick for a tier no recipe carries', () => {
    expect(bestFusePerGem([row('a', null, null)]).relic[8]).toBeNull();
  });
});
