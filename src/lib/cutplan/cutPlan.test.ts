import { describe, expect, it } from 'vitest';

import { GRADE_ROWS } from '../scoring/gemScore';
import {
  actionFor,
  actionLabel,
  bracketLabel,
  cellBreakdown,
  effectPair,
  getCutCell,
  getThru,
  headerCut,
  isBlockFuse,
  pipelineBaselineForGrade,
  unopenedFusion,
  verdictFor,
  weeksBand,
} from './cutPlan';
import realPipeline from './pipeline.json';
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
  // Per-axis anchors: support sits on a smaller % scale than DPS (support cells below are baked at
  // b=0.1/0.2, mimicking the real ~0.12–0.28 support range vs DPS's ~0.66–1.43).
  baselines: { dps: [1, 2], support: [0.1, 0.2] },
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
                { b: 1, nrb: { cut: 10000, pAbove: 0.5, expScore: 1.0, expSpend: 7000, fLeg: 0.3, fRelic: 0.1, fAnc: 0.1 }, rb: { cut: 12000, pAbove: 0.6, expScore: 1.1, expSpend: 0 } },
                { b: 2, nrb: { cut: 20000, pAbove: 0.2, expScore: 1.5, expSpend: 8000, fLeg: 0.5, fRelic: 0.2, fAnc: 0.1 }, rb: { cut: 22000, pAbove: 0.3, expScore: 1.6, expSpend: 0 } },
              ],
            },
            no_damage: {
              '500000': [
                { b: 1, nrb: { cut: -500, pAbove: 0.01, expScore: 0.4, expSpend: 6000, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 0, pAbove: 0.01, expScore: 0.4, expSpend: 0 } },
                { b: 2, nrb: { cut: -500, pAbove: 0.0, expScore: 0.4, expSpend: 6000, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 0, pAbove: 0.0, expScore: 0.4, expSpend: 0 } },
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
      fusion: {},
      economy: {},
    },
    // Support cells baked on the support % scale (b=0.1/0.2). The top anchor (0.2) has cut=0,
    // like the real data — so reading it at a DPS-scale baseline (>0.2) clamps to zero (the bug),
    // while reading it at an in-range support baseline yields a real, cuttable value (the fix).
    support: {
      cells: {
        epic: {
          '8': {
            '2_damage': {
              '500000': [
                { b: 0.1, nrb: { cut: 8000, pAbove: 0.4, expScore: 0.13, expSpend: 7850, fLeg: 0.3, fRelic: 0.1, fAnc: 0.05 }, rb: { cut: 9000, pAbove: 0.45, expScore: 0.14, expSpend: 0 } },
                { b: 0.2, nrb: { cut: 0, pAbove: 0.0, expScore: 0.03, expSpend: 7850, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 200, pAbove: 0.01, expScore: 0.03, expSpend: 0 } },
              ],
            },
            no_damage: {
              '500000': [
                { b: 0.1, nrb: { cut: 1500, pAbove: 0.1, expScore: 0.09, expSpend: 6500, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 1800, pAbove: 0.12, expScore: 0.09, expSpend: 0 } },
                { b: 0.2, nrb: { cut: 0, pAbove: 0.0, expScore: 0.02, expSpend: 6500, fLeg: 0.9, fRelic: 0, fAnc: 0 }, rb: { cut: 0, pAbove: 0.0, expScore: 0.02, expSpend: 0 } },
              ],
            },
          },
        },
      } as unknown as PipelineData['axes']['dps']['cells'],
      thru: {} as unknown as PipelineData['axes']['dps']['thru'],
      fusion: {},
      economy: {},
    },
  },
};

describe('verdictFor / actionFor', () => {
  it('bands a cut value by the baked gold thresholds', () => {
    // Green is the 20k reset threshold (a code override of the baked legacy meta.verdict.green
    // of 18000). 18k is NO LONGER green; it now falls in the yellow-hi band.
    expect(verdictFor(20000, verdict)).toBe('green');
    expect(verdictFor(19999, verdict)).toBe('yellow-hi');
    expect(verdictFor(18000, verdict)).toBe('yellow-hi');
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
    expect(c.verdict).toBe('yellow-hi'); // 15000 is in [10000, 20000)
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

describe('cellBreakdown', () => {
  it('assembles the DPS buckets with role-correct labels + weighted average', () => {
    const b = cellBreakdown(data, 'dps', 'epic', 8, 'nrb', 500000, 1.5)!;
    expect(b.buckets.map((x) => x.label)).toEqual(['2D', 'No']); // fixture has only these two buckets
    expect(b.buckets[0].effects).toBe('Additional Damage + Attack Power'); // concrete DPS effect pair
    expect(b.buckets[0].cut).toBeCloseTo(15000, 6); // interpolated 10000..20000
    expect(b.buckets[0].expSpend).toBeCloseTo(7500, 6); // interpolated 7000..8000
    // [1,2,2,1]/6 weights: 2_damage w=1, no_damage w=1 (both present) -> (15000 + no)/2
    const no = b.buckets[1].cut;
    expect(b.averageCut).toBeCloseTo((15000 + no) / 2, 6);
  });
  it('uses the 2S label + support wording on the support axis', () => {
    const b = cellBreakdown(data, 'support', 'epic', 8, 'nrb', 500000, 0.15)!;
    expect(b.buckets[0].label).toBe('2S');
    // Regression: the effect pair must be the SUPPORT pairing, not the DPS one.
    expect(b.buckets[0].effects).toBe('Ally Attack Enh. + Brand Power');
    expect(b.buckets[0].cut).toBeGreaterThan(0);
  });
  it('returns null when no cells exist for the archetype', () => {
    expect(cellBreakdown(data, 'dps', 'rare', 8, 'nrb', 500000, 1.5)).toBeNull();
  });
  it('applies the 1:2:2:1 weights and all four bucket effect pairs', () => {
    // A 4-bucket fixture so the weight-2 (Op/Sub) path and their effect pairs are exercised — the
    // 2-bucket `data` fixture above can't catch a wrong optimal/suboptimal weight.
    const mkCell = (cut: number) => ({
      '500000': [
        {
          b: 1,
          nrb: { cut, pAbove: 0.5, expScore: 0.5, expSpend: 100, fLeg: 0, fRelic: 0, fAnc: 0 },
          rb: { cut, pAbove: 0.5, expScore: 0.5, expSpend: 0 },
        },
      ],
    });
    const meta4: PipelineMeta = {
      ...meta,
      buckets: ['2_damage', 'optimal_damage', 'suboptimal_damage', 'no_damage'],
    };
    const data4: PipelineData = {
      _provenance: {},
      meta: meta4,
      axes: {
        dps: {
          cells: {
            epic: {
              '8': {
                '2_damage': mkCell(1000),
                optimal_damage: mkCell(100),
                suboptimal_damage: mkCell(10),
                no_damage: mkCell(1),
              },
            },
          } as unknown as PipelineData['axes']['dps']['cells'],
          thru: {} as unknown as PipelineData['axes']['dps']['thru'],
          fusion: {},
          economy: {},
        },
        // Support unused here.
        support: {
          cells: {} as unknown as PipelineData['axes']['dps']['cells'],
          thru: {} as unknown as PipelineData['axes']['dps']['thru'],
          fusion: {},
          economy: {},
        },
      },
    };
    const b = cellBreakdown(data4, 'dps', 'epic', 8, 'nrb', 500000, 1)!;
    expect(b.buckets.map((x) => x.label)).toEqual(['2D', 'Op', 'Sub', 'No']);
    // Concrete effect pair per bucket (2D/Op/Sub/No), so the popover lists real stat names.
    expect(b.buckets.map((x) => x.effects)).toEqual([
      'Additional Damage + Attack Power',
      'Additional Damage + Brand Power',
      'Attack Power + Brand Power',
      'Brand Power + Ally Damage Enh.',
    ]);
    // (1·1000 + 2·100 + 2·10 + 1·1) / (1+2+2+1) = 1221/6 — a wrong Op/Sub weight fails this.
    expect(b.averageCut).toBeCloseTo(1221 / 6, 6);
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

describe('pipelineBaselineForGrade', () => {
  // A realistic 12-anchor support-scale array (parallel to GRADE_ROWS).
  const supportBaselines = [
    0.124, 0.138, 0.153, 0.167, 0.181, 0.196, 0.21, 0.224, 0.239, 0.253, 0.267, 0.282,
  ];
  it('maps a grade to the anchor at its GRADE_ROWS index', () => {
    expect(GRADE_ROWS.length).toBe(supportBaselines.length);
    expect(pipelineBaselineForGrade(GRADE_ROWS[0], supportBaselines)).toBe(supportBaselines[0]); // 40
    expect(pipelineBaselineForGrade(GRADE_ROWS[11], supportBaselines)).toBe(supportBaselines[11]); // 95
  });
  it('snaps an off-anchor grade to the nearest anchor', () => {
    expect(pipelineBaselineForGrade(72, supportBaselines)).toBe(supportBaselines[6]); // nearest 70
  });
  it('keeps the whole grade range inside the support anchor span (no clamp)', () => {
    const lo = supportBaselines[0];
    const hi = supportBaselines[supportBaselines.length - 1];
    for (const g of GRADE_ROWS) {
      const pct = pipelineBaselineForGrade(g, supportBaselines);
      expect(pct).toBeGreaterThanOrEqual(lo);
      expect(pct).toBeLessThanOrEqual(hi);
    }
  });
});

describe('support axis (baseline scale-mismatch regression)', () => {
  // The bug: feeding a DPS-scale baseline (>0.2) into support cells clamps every read to the top
  // anchor, where cut=0 -> "Best: 0" / "Don't cut" on every card.
  it('collapses to dont-cut when read at a DPS-scale baseline (reproduces the bug)', () => {
    const c = getCutCell(data, 'support', 'epic', 8, '2_damage', 'nrb', 500000, 1.5)!;
    expect(c.cut).toBe(0);
    expect(c.action).toBe('dont-cut');
    expect(headerCut(data, 'support', 'epic', 8, 'nrb', 500000, 1.5)).toBe(0);
  });
  // The fix: reading support cells at an in-range support baseline yields real, cuttable values.
  it('yields a non-zero, cuttable value at an in-range support baseline (the fix)', () => {
    const c = getCutCell(data, 'support', 'epic', 8, '2_damage', 'nrb', 500000, 0.15)!;
    expect(c.cut).toBeGreaterThan(0);
    expect(c.action).not.toBe('dont-cut');
    expect(headerCut(data, 'support', 'epic', 8, 'nrb', 500000, 0.15)).toBeGreaterThan(0);
  });
  // End-to-end at the panel layer: pipelineBaselineForGrade(grade, meta.baselines[axis]) must pick
  // the support anchors so the read lands in-range. Same grade, same cells — the support array lands
  // in-range (cut>0); the DPS array (the bug) clamps to the zero top anchor.
  it('picks the support anchors via meta.baselines[axis], not the DPS array', () => {
    const supportPct = pipelineBaselineForGrade(40, data.meta.baselines.support);
    const dpsPct = pipelineBaselineForGrade(40, data.meta.baselines.dps);
    expect(supportPct).toBeLessThanOrEqual(0.2); // in the support span
    expect(dpsPct).toBeGreaterThan(0.2); // above the support cells' top anchor
    expect(getCutCell(data, 'support', 'epic', 8, '2_damage', 'nrb', 500000, supportPct)!.cut).toBeGreaterThan(0);
    expect(getCutCell(data, 'support', 'epic', 8, '2_damage', 'nrb', 500000, dpsPct)!.cut).toBe(0);
  });
});

describe('committed pipeline.json shape (locks types <-> data)', () => {
  const meta = (realPipeline as unknown as PipelineData).meta;
  it('carries a per-axis baselines record, each 12 ascending anchors', () => {
    expect(Array.isArray(meta.baselines)).toBe(false);
    for (const axis of ['dps', 'support'] as const) {
      const arr = meta.baselines[axis];
      expect(arr).toHaveLength(GRADE_ROWS.length);
      for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1]);
    }
  });
  it('keeps DPS on the ~0.66–1.43 scale and support on the smaller ~0.12–0.28 scale', () => {
    expect(meta.baselines.dps[0]).toBeCloseTo(0.659, 2);
    expect(meta.baselines.dps.at(-1)).toBeCloseTo(1.432, 2);
    // Support anchors must all sit below the DPS floor — the whole point of the split.
    expect(meta.baselines.support.at(-1)).toBeLessThan(meta.baselines.dps[0]);
  });
  it('carries a numeric expSpend on each cell (nrb positive, rb zero)', () => {
    const c = (realPipeline as unknown as PipelineData).axes.dps.cells.epic['8']['2_damage']['5000000'][0];
    expect(typeof c.nrb.expSpend).toBe('number');
    expect(c.nrb.expSpend).toBeGreaterThan(0);
    expect(c.rb.expSpend).toBe(0);
  });
});

describe('fuse-first (purple)', () => {
  const real = realPipeline as unknown as PipelineData;
  // grade -> the baked % baseline the DPS cells were solved at (GRADE_ROWS index).
  const at = (grade: number) => pipelineBaselineForGrade(grade, real.meta.baselines.dps);
  const GPD = 1_500_000; // his default Pipeline gpd tier

  it('unopenedFusion returns finite uncommon/rare fuse values and a null epic', () => {
    const ff = unopenedFusion(real, 'dps', GPD, at(40));
    expect(ff).not.toBeNull();
    expect(Number.isFinite(ff!.fuse.uncommon[8]!)).toBe(true);
    expect(Number.isFinite(ff!.fuse.rare[10]!)).toBe(true);
    expect(ff!.fuse.epic[8]).toBeNull();
    expect([8, 9, 10]).toContain(ff!.steer.rare[8]);
  });

  it('isBlockFuse is false for roster-bound, epic, and null fuse data', () => {
    const ff = unopenedFusion(real, 'dps', GPD, at(40));
    // roster-bound gems are free to cut -> never fuse-first
    expect(isBlockFuse(real, 'dps', 'rare', 10, 'rb', GPD, at(40), ff)).toBe(false);
    // epic never fuses
    expect(isBlockFuse(real, 'dps', 'epic', 10, 'nrb', GPD, at(40), ff)).toBe(false);
    // no fuse data -> false
    expect(isBlockFuse(real, 'dps', 'rare', 10, 'nrb', GPD, at(40), null)).toBe(false);
  });

  it('getCutCell honors the blockFuse override', () => {
    const cell = getCutCell(real, 'dps', 'rare', 10, '2_damage', 'nrb', GPD, at(40), true)!;
    expect(cell.verdict).toBe('purple');
    expect(cell.action).toBe('fuse');
    expect(cell.resetWorthy).toBe(false);
  });

  // Golden: verdicts read off his live page (DPS / Global / 1.5M / Non-Roster-Bound) on 2026-07-19.
  // At grade 40 ONLY rare/10 is purple; at grade 80 rare/8 is purple while rare/10 is not. These
  // cross-checks prove the port tracks BOTH the rarity/cost and the baseline dimensions.
  it('matches his live-page purple grid at DPS / 1.5M / NRB', () => {
    const bf = (rarity: 'uncommon' | 'rare' | 'epic', cost: number, grade: number) => {
      const ff = unopenedFusion(real, 'dps', GPD, at(grade));
      return isBlockFuse(real, 'dps', rarity, cost, 'nrb', GPD, at(grade), ff);
    };
    // grade 40: only rare/10 fuses
    expect(bf('rare', 10, 40)).toBe(true);
    expect(bf('rare', 8, 40)).toBe(false);
    expect(bf('epic', 10, 40)).toBe(false);
    expect(bf('uncommon', 8, 40)).toBe(false);
    // grade 80: the pattern shifts to the cheaper rare costs; rare/10 is no longer fuse-first
    expect(bf('rare', 8, 80)).toBe(true);
    expect(bf('rare', 10, 80)).toBe(false);
  });
});
