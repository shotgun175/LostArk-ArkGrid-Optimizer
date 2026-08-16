import { describe, expect, it } from 'vitest';

import type { ArkGridGem, ArkGridGemOption } from '../models/arkGridGems';
import {
  BASELINE_MIN_GRADE,
  D_ADD,
  D_ATTACK,
  D_BOSS,
  D_ORDER,
  D_WILLPOWER,
  baselineMaxGrade,
  bumpedBaselineGrade,
  computeGemScore,
  explainGemScore,
  gradeRowIndex,
  gradeRows,
  rankFromGrade,
  sPlusCut,
  willpowerScore,
} from './gemScore';

// Independently-derived reference constants (shizukaziye's current model/astrogem.js `_perLevelD`:
// the MARGINAL D of one more level on a full lvl-30 grid, 100·ln((base + gridAdd/levels)/base) with
// base = 1 + other + gridAdd). Computed here from the documented baselines so the test does not just
// echo the implementation.
const margD = (other: number, gridAdd: number, levels: number) => {
  const base = 1 + other + gridAdd;
  return 100 * Math.log((base + gridAdd / levels) / base);
};
const refAtk = margD(0.121, 0.011, 30); // attack: other 12.1%, +1.1% / 30
const refAdd = margD(0.336, 0.0242, 30); // add dmg: other 33.6%, +2.42% / 30
const refBoss = margD(0.0, 0.025, 30); // boss: other 0%, +2.5% / 30
const refOrder = 100 * Math.log(1.0016); // order: flat ×1.0016 per point
const refWp = 2.4 * refAtk; // willpower keeps the 2.4:1 willpower:attack ratio

function gem(
  req: number,
  point: number,
  o1: ArkGridGemOption,
  o2: ArkGridGemOption
): ArkGridGem {
  return { gemAttr: 'Chaos', req, point, option1: o1, option2: o2 };
}

describe('per-line D constants (real % damage, log space)', () => {
  it('match the documented closed-form baselines', () => {
    expect(D_ATTACK).toBeCloseTo(refAtk, 10);
    expect(D_ATTACK).toBeCloseTo(0.0323858, 6);
    expect(D_ADD).toBeCloseTo(refAdd, 10);
    expect(D_ADD).toBeCloseTo(0.0592874, 6);
    expect(D_BOSS).toBeCloseTo(refBoss, 10);
    expect(D_BOSS).toBeCloseTo(0.0812678, 6);
    expect(D_ORDER).toBeCloseTo(refOrder, 10);
    expect(D_ORDER).toBeCloseTo(0.159872, 5);
    expect(D_WILLPOWER).toBeCloseTo(refWp, 10);
    expect(D_WILLPOWER).toBeCloseTo(0.0777259, 6);
  });

  it('preserves the DPS weight RATIOS (boss≈2.51, add≈1.83, willpower≈2.4 vs attack=1)', () => {
    expect(D_BOSS / D_ATTACK).toBeCloseTo(2.51, 2);
    expect(D_ADD / D_ATTACK).toBeCloseTo(1.83, 2);
    expect(D_WILLPOWER / D_ATTACK).toBeCloseTo(2.4, 6);
  });
});

describe('willpowerScore (req IS the willpower cost; neutral at 4)', () => {
  it('is 0 at cost 4, positive below, negative above', () => {
    expect(willpowerScore(4)).toBe(0);
    expect(willpowerScore(3)).toBeCloseTo(refWp, 10); // (4-3)*D
    expect(willpowerScore(5)).toBeCloseTo(-refWp, 10); // (5-4)*-D
    expect(willpowerScore(7)).toBeCloseTo(-3 * refWp, 10);
  });

  it('scales support willpower by 2/3', () => {
    expect(willpowerScore(3, 'support')).toBeCloseTo((2 / 3) * refWp, 10);
    expect(willpowerScore(4, 'support')).toBe(0);
  });
});

describe('computeGemScore (DPS, real % damage)', () => {
  it('scores additively in % damage (willpower + order + two effects)', () => {
    // req 5, order 5, AddDamage 4, AtkPower 3 — expected computed from the local refs.
    const g = gem(5, 5, { optionType: 'AddDamage', value: 4 }, { optionType: 'AtkPower', value: 3 });
    const expected = -refWp + 5 * refOrder + 4 * refAdd + 3 * refAtk;
    const r = computeGemScore(g, 'dps');
    expect(r.score).toBeCloseTo(expected, 9);
    expect(r.contributions.willpower).toBeCloseTo(-refWp, 9);
    expect(r.contributions.point).toBeCloseTo(5 * refOrder, 9);
    expect(r.contributions.option1).toBeCloseTo(4 * refAdd, 9);
    expect(r.contributions.option2).toBeCloseTo(3 * refAtk, 9);
  });

  it('order is FLAT per point (not relative to 4)', () => {
    const g = gem(4, 4, { optionType: 'BrandPower', value: 5 }, { optionType: 'AllyDamageEnh', value: 5 });
    // willpower 0, two dead DPS effects -> only the flat order term remains.
    expect(computeGemScore(g, 'dps').score).toBeCloseTo(4 * refOrder, 9);
  });

  it('exposes damagePercent = (e^(gemDamage/100) − 1)·100 (effects + order, no willpower)', () => {
    const g = gem(5, 5, { optionType: 'AddDamage', value: 4 }, { optionType: 'AtkPower', value: 3 });
    const gemDamage = 5 * refOrder + 4 * refAdd + 3 * refAtk;
    const expectedPct = (Math.exp(gemDamage / 100) - 1) * 100;
    expect(computeGemScore(g, 'dps').damagePercent).toBeCloseTo(expectedPct, 9);
  });

  it('a perfect gem scores ≈ 1.34–1.44 % damage (the additive score, incl. willpower)', () => {
    const perfectC10 = gem(5, 5, { optionType: 'BossDamage', value: 5 }, { optionType: 'AddDamage', value: 5 });
    const score = computeGemScore(perfectC10, 'dps').score;
    expect(score).toBeGreaterThan(1.34);
    expect(score).toBeLessThan(1.44);
  });
});

describe('grade (perfect-grid anchor over the gem space) + letter rank', () => {
  it('grades the perfect gems around the perfect-grid mean (c8 96.1 / c9 99.7 / c10 102.1), all S+', () => {
    // pool 10 top-2 DPS = Boss + AddDamage; pool 9 = Boss + AtkPower; pool 8 = AddDamage + AtkPower.
    // Perfects no longer tie: grade 100 is the MEAN of the perfect 3/3/6 layout, so a perfect c10 sits
    // above it and a perfect c8 below; every perfect is still S+ (the S+ cut IS the perfect c8).
    const perfectC10 = gem(5, 5, { optionType: 'BossDamage', value: 5 }, { optionType: 'AddDamage', value: 5 });
    const perfectC9 = gem(4, 5, { optionType: 'BossDamage', value: 5 }, { optionType: 'AtkPower', value: 5 });
    const perfectC8 = gem(3, 5, { optionType: 'AddDamage', value: 5 }, { optionType: 'AtkPower', value: 5 });
    expect(computeGemScore(perfectC10, 'dps').grade).toBe(102.1);
    expect(computeGemScore(perfectC9, 'dps').grade).toBe(99.7);
    expect(computeGemScore(perfectC8, 'dps').grade).toBe(96.1);
    expect(sPlusCut('dps')).toBe(96.1);
    for (const g of [perfectC10, perfectC9, perfectC8]) expect(computeGemScore(g, 'dps').rank).toBe('S+');
    // the perfect-grid mean: (3·96.1 + 3·99.7 + 6·102.1) / 12 = 100 (to grade rounding)
    expect((3 * 96.1 + 3 * 99.7 + 6 * 102.1) / 12).toBeCloseTo(100, 0);
  });

  it('grades a worthless DPS gem (dead effects, high willpower cost) near 0 / F', () => {
    const junk = gem(9, 1, { optionType: 'BrandPower', value: 1 }, { optionType: 'AllyAttackEnh', value: 1 });
    const r = computeGemScore(junk, 'dps');
    expect(r.grade).toBeLessThan(10);
    expect(r.rank.startsWith('F')).toBe(true);
  });

  it('rankFromGrade applies even thirds of 10-point bands, S+ at the axis perfect c8', () => {
    expect(rankFromGrade(100)).toBe('S+');
    expect(rankFromGrade(96.1)).toBe('S+'); // DPS perfect c8
    expect(rankFromGrade(96.0)).toBe('S');
    expect(rankFromGrade(93.3)).toBe('S');
    expect(rankFromGrade(90)).toBe('S-');
    expect(rankFromGrade(86.7)).toBe('A+');
    expect(rankFromGrade(83.3)).toBe('A');
    expect(rankFromGrade(80)).toBe('A-');
    expect(rankFromGrade(73.3)).toBe('B'); // a displayed 73.3 IS a B (grade() rounds to 0.1)
    expect(rankFromGrade(70)).toBe('B-');
    expect(rankFromGrade(60)).toBe('C-');
    expect(rankFromGrade(50)).toBe('D-');
    expect(rankFromGrade(49.9)).toBe('F+'); // F takes thirds of 0-50
    expect(rankFromGrade(33.3)).toBe('F+');
    expect(rankFromGrade(16.7)).toBe('F');
    expect(rankFromGrade(0)).toBe('F-');
    // support pins S+ at ITS perfect c8 (94.6), everything else shared
    expect(sPlusCut('support')).toBe(94.6);
    expect(rankFromGrade(95, 'support')).toBe('S+');
    expect(rankFromGrade(95, 'dps')).toBe('S');
  });

  it('exposes the per-axis baseline ladder: 12 rows, one distinct rank each, C- to S+', () => {
    for (const role of ['dps', 'support'] as const) {
      const rows = gradeRows(role);
      expect(rows).toHaveLength(12);
      expect(rows[0]).toBe(BASELINE_MIN_GRADE);
      expect(rows[11]).toBe(baselineMaxGrade(role));
      expect(rows.map((g) => rankFromGrade(g, role))).toEqual([
        'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+',
      ]);
      // bumped baseline = one rank up the ladder, clamped at S+; off-ladder grades snap first
      expect(bumpedBaselineGrade(rows[0], role)).toBe(rows[1]);
      expect(bumpedBaselineGrade(rows[11], role)).toBe(rows[11]);
      expect(bumpedBaselineGrade(20, role)).toBe(rows[1]); // F snaps to C- (nearest) then bumps to C
      expect(gradeRowIndex(rows[5] + 0.1, role)).toBe(5);
    }
  });
});

describe('computeGemScore (Support axis)', () => {
  it('uses support coefficients and ignores DPS damage options', () => {
    const support = gem(4, 4, { optionType: 'AllyAttackEnh', value: 5 }, { optionType: 'BrandPower', value: 5 });
    // willpower 0, support (per-DPS, coeffs ÷3): AllyAttackEnh 0.0586/3 + Brand 0.0437/3 + 0.0769/3 order.
    const expected = 0 + (4 * 0.0769) / 3 + (5 * 0.0586) / 3 + (5 * 0.0437) / 3;
    expect(computeGemScore(support, 'support').score).toBeCloseTo(expected, 9);
    // Same gem under DPS: both options are non-DPS -> only the flat order term.
    expect(computeGemScore(support, 'dps').score).toBeCloseTo(4 * refOrder, 9);
  });

  it('refreshed support ratios (AllyAttackEnh:Brand:AllyDamageEnh ≈ 2.74:2.04:1)', () => {
    // Pull each per-effect contribution straight from the factor breakdown (level 1).
    const f = explainGemScore(
      gem(4, 4, { optionType: 'AllyAttackEnh', value: 1 }, { optionType: 'AllyDamageEnh', value: 1 }),
      'support'
    );
    const allyAttackEnh = f[2].value;
    const allyDamageEnh = f[3].value;
    const brand = explainGemScore(
      gem(4, 4, { optionType: 'BrandPower', value: 1 }, { optionType: 'AllyDamageEnh', value: 1 }),
      'support'
    )[2].value;
    expect(allyAttackEnh / allyDamageEnh).toBeCloseTo(0.0586 / 0.0214, 3);
    expect(brand / allyDamageEnh).toBeCloseTo(0.0437 / 0.0214, 3);
  });

  it('grades the perfect support c10 at 103.6 / S+ (its perfect c8 at 94.6 = the support S+ cut)', () => {
    const perfectSupportC10 = gem(5, 5, { optionType: 'AllyAttackEnh', value: 5 }, { optionType: 'BrandPower', value: 5 });
    const sup = computeGemScore(perfectSupportC10, 'support');
    expect(sup.grade).toBe(103.6);
    expect(sup.rank).toBe('S+');
    const perfectSupportC8 = gem(3, 5, { optionType: 'BrandPower', value: 5 }, { optionType: 'AllyDamageEnh', value: 5 });
    expect(computeGemScore(perfectSupportC8, 'support').grade).toBe(94.6);
    expect(computeGemScore(perfectSupportC8, 'support').rank).toBe('S+');
    // The same gem grades worse on the DPS axis (its effects are dead for DPS; only its
    // order points count there).
    expect(computeGemScore(perfectSupportC10, 'dps').grade).toBeLessThan(sup.grade);
  });
});

describe('explainGemScore', () => {
  it('breaks the score into four factors that sum to the total', () => {
    const g = gem(5, 5, { optionType: 'AddDamage', value: 4 }, { optionType: 'AtkPower', value: 3 });
    const factors = explainGemScore(g, 'dps');
    expect(factors).toHaveLength(4);
    const sum = factors.reduce((acc, f) => acc + f.value, 0);
    expect(sum).toBeCloseTo(computeGemScore(g, 'dps').score, 9);
    expect(factors[0].label).toBe('Willpower');
    expect(factors[2].label).toBe('Additional Damage');
  });

  it('uses role-specific coefficients for the option factors', () => {
    const support = gem(4, 4, { optionType: 'AllyAttackEnh', value: 5 }, { optionType: 'BrandPower', value: 5 });
    const dpsOpts = explainGemScore(support, 'dps').slice(2);
    const supOpts = explainGemScore(support, 'support').slice(2);
    expect(dpsOpts[0].value + dpsOpts[1].value).toBe(0);
    expect(supOpts[0].value + supOpts[1].value).toBeGreaterThan(0);
  });
});
