import { describe, expect, it } from 'vitest';

import {
  actionFor,
  actionLabel,
  bracketLabel,
  effectPair,
  getCutCell,
  getThru,
  headerCut,
  verdictFor,
  weeksBand,
} from './cutPlan';
import type { PipelineData, PipelineMeta } from './types';

const verdict: PipelineMeta['verdict'] = {
  green: 18000,
  yellowHi: 10000,
  yellowMid: 5000,
  yellowLo: 1000,
  red: 0,
};

// Minimal fake pipeline: one epic/c8 archetype with two buckets and two baseline anchors
// (b=1 and b=2), gpd anchor 500000, plus a throughput row, so interpolation is testable.
const meta: PipelineMeta = {
  scoreUnit: 'percent_damage',
  costs: [8],
  rarities: ['epic'],
  buckets: ['2_damage', 'no_damage'],
  bucketLabels: { '2_damage': '2D', optimal_damage: 'Op', suboptimal_damage: 'Sub', no_damage: 'No' },
  effectBuckets: {
    dps: {
      '8': {
        '2_damage': { effect1: 'Additional Damage', effect2: 'Attack Power' },
        optimal_damage: { effect1: 'Additional Damage', effect2: 'Brand Power' },
        suboptimal_damage: { effect1: 'Attack Power', effect2: 'Brand Power' },
        no_damage: { effect1: 'Brand Power', effect2: 'Ally Damage Enh.' },
      },
    },
    support: {
      '8': {
        '2_damage': { effect1: 'Ally Attack Enh.', effect2: 'Brand Power' },
        optimal_damage: { effect1: 'Ally Attack Enh.', effect2: 'Ally Damage Enh.' },
        suboptimal_damage: { effect1: 'Brand Power', effect2: 'Ally Damage Enh.' },
        no_damage: { effect1: 'Ally Damage Enh.', effect2: 'Attack Power' },
      },
    },
  },
  verdict,
  slots: 24,
  cutsPerWeek: { uncommon: 70, rare: 26, epic: 9 },
  boxSchedule: [],
  freshBucketMix: { '2_damage': 0.17, optimal_damage: 0.33, suboptimal_damage: 0.33, no_damage: 0.17 },
  anchorGpd: [500000],
  baselines: [1, 2],
};
const data: PipelineData = {
  _provenance: {},
  meta,
  axes: {
    dps: {
      cells: {
        epic: {
          '8': {
            '2_damage': {
              '500000': [
                { b: 1, nrb: { cut: 10000, pAbove: 0.5, expScore: 1.0, fLeg: 0.3, fRelic: 0.1, fAnc: 0.1 }, rb: { cut: 12000, pAbove: 0.6, expScore: 1.1 } },
                { b: 2, nrb: { cut: 20000, pAbove: 0.2, expScore: 1.5, fLeg: 0.5, fRelic: 0.2, fAnc: 0.1 }, rb: { cut: 22000, pAbove: 0.3, expScore: 1.6 } },
              ],
            },
            no_damage: {
              '500000': [
                { b: 1, nrb: { cut: -500, pAbove: 0.01, expScore: 0.4, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 0, pAbove: 0.01, expScore: 0.4 } },
                { b: 2, nrb: { cut: -500, pAbove: 0.0, expScore: 0.4, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 0, pAbove: 0.0, expScore: 0.4 } },
              ],
            },
          },
        },
      } as unknown as PipelineData['axes']['dps']['cells'],
      thru: {
        epic: {
          '8': {
            '500000': [
              { b: 1, directPerWk: 4, fusePerWk: 1, totalPerWk: 5, weeks: 4.8, goldPerWk: 800000, boxEV: 400000, avgScore: 1.0, cpGain: 0.2 },
              { b: 2, directPerWk: 2, fusePerWk: 1, totalPerWk: 3, weeks: 8.0, goldPerWk: 900000, boxEV: 420000, avgScore: 1.4, cpGain: 0.5 },
              // High baseline: nothing clears -> total 0, weeks baked as null (24/0 = ∞).
              { b: 3, directPerWk: 0, fusePerWk: 0, totalPerWk: 0, weeks: null, goldPerWk: 100000, boxEV: 420000, avgScore: 1.6, cpGain: 0.6 },
            ],
          },
        },
      } as unknown as PipelineData['axes']['dps']['thru'],
    },
    support: { cells: {} as unknown as PipelineData['axes']['dps']['cells'], thru: {} as unknown as PipelineData['axes']['dps']['thru'] },
  },
};

describe('verdictFor / actionFor', () => {
  it('bands a cut value by the baked gold thresholds', () => {
    expect(verdictFor(20000, verdict)).toBe('green');
    expect(verdictFor(18000, verdict)).toBe('green');
    expect(verdictFor(12000, verdict)).toBe('yellow-hi');
    expect(verdictFor(7000, verdict)).toBe('yellow-mid');
    expect(verdictFor(2000, verdict)).toBe('yellow-lo');
    expect(verdictFor(500, verdict)).toBe('yellow-dim');
    expect(verdictFor(0, verdict)).toBe('red');
    expect(verdictFor(-100, verdict)).toBe('red');
  });
  it('maps verdicts to actions (green=reset, yellow=cut, red=dont-cut)', () => {
    expect(actionFor('green')).toBe('cut-reset');
    expect(actionFor('yellow-hi')).toBe('cut');
    expect(actionFor('yellow-dim')).toBe('cut');
    expect(actionFor('red')).toBe('dont-cut');
  });
});

describe('getCutCell (baseline interpolation)', () => {
  it('linearly interpolates fields between baseline anchors', () => {
    const c = getCutCell(data, 'dps', 'epic', 8, '2_damage', 'nrb', 500000, 1.5)!;
    expect(c.cut).toBeCloseTo(15000, 6); // midpoint of 10000..20000
    expect(c.pAbove).toBeCloseTo(0.35, 6);
    expect(c.expScore).toBeCloseTo(1.25, 6);
    expect(c.fLeg).toBeCloseTo(0.4, 6);
    expect(c.verdict).toBe('yellow-hi'); // 15000 is in [10000, 18000)
    expect(c.action).toBe('cut');
    expect(c.resetWorthy).toBe(false);
  });
  it('clamps a baseline below/above the baked range to the nearest anchor', () => {
    expect(getCutCell(data, 'dps', 'epic', 8, '2_damage', 'nrb', 500000, 0.2)!.cut).toBe(10000);
    expect(getCutCell(data, 'dps', 'epic', 8, '2_damage', 'nrb', 500000, 5)!.cut).toBe(20000);
  });
  it('flags the green (reset-worthy) band at high baseline', () => {
    const c = getCutCell(data, 'dps', 'epic', 8, '2_damage', 'nrb', 500000, 2)!;
    expect(c.cut).toBe(20000);
    expect(c.verdict).toBe('green');
    expect(c.action).toBe('cut-reset');
    expect(c.resetWorthy).toBe(true);
  });
  it('uses the rb fields and zeroes the fodder split for roster-bound gems', () => {
    const c = getCutCell(data, 'dps', 'epic', 8, '2_damage', 'rb', 500000, 1.5)!;
    expect(c.cut).toBeCloseTo(17000, 6); // 12000..22000 midpoint
    expect(c.fLeg).toBe(0);
  });
  it('marks a worthless archetype as dont-cut (negative cut)', () => {
    const c = getCutCell(data, 'dps', 'epic', 8, 'no_damage', 'nrb', 500000, 1.5)!;
    expect(c.cut).toBeLessThan(0);
    expect(c.action).toBe('dont-cut');
  });
  it('returns null for a missing cell', () => {
    expect(getCutCell(data, 'dps', 'rare', 8, '2_damage', 'nrb', 500000, 1.5)).toBeNull();
  });
});

describe('headerCut', () => {
  it('returns the best (max) cut across an archetype’s buckets', () => {
    expect(headerCut(data, 'dps', 'epic', 8, 'nrb', 500000, 1.5)).toBeCloseTo(15000, 6);
  });
});

describe('getThru', () => {
  it('interpolates throughput and DERIVES weeks from total (slots / total, not the baked value)', () => {
    const t = getThru(data, 'dps', 'epic', 8, 500000, 1.5)!;
    expect(t.totalPerWk).toBeCloseTo(4, 6); // 5..3 midpoint
    expect(t.weeks).toBeCloseTo(24 / 4, 6); // 6.0, computed from total — NOT the 6.4 a linear weeks interp gives
    expect(t.goldPerWk).toBeCloseTo(850000, 6);
  });
  it('returns weeks = null when nothing clears (total ≈ 0) instead of crashing on the baked null', () => {
    const t = getThru(data, 'dps', 'epic', 8, 500000, 5)!; // clamps to the b=3 anchor (total 0)
    expect(t.totalPerWk).toBe(0);
    expect(t.weeks).toBeNull();
  });
});

describe('labels / bands', () => {
  it('effectPair reads the per-axis bucket effects', () => {
    expect(effectPair(meta, 'dps', 8, '2_damage')).toBe('Additional Damage + Attack Power');
    // Regression: a support build must show the SUPPORT effect pairing, not the DPS one.
    expect(effectPair(meta, 'support', 8, '2_damage')).toBe('Ally Attack Enh. + Brand Power');
  });
  it('actionLabel / bracketLabel / weeksBand', () => {
    expect(actionLabel('cut-reset')).toBe('Cut + reset');
    expect(actionLabel('dont-cut')).toBe("Don't cut");
    expect(bracketLabel('1_5M')).toBe('1.5M');
    expect(weeksBand(6.8)).toBe('fast');
    expect(weeksBand(20)).toBe('med');
    expect(weeksBand(40)).toBe('slow');
  });
});
