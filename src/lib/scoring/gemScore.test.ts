import { describe, expect, it } from 'vitest';

import type { ArkGridGem, ArkGridGemOption } from '../models/arkGridGems';
import {
  D_ADD,
  D_ATTACK,
  D_BOSS,
  D_ORDER,
  D_WILLPOWER,
  computeGemScore,
  explainGemScore,
  grade,
  rankFromGrade,
  willpowerScore,
} from './gemScore';

// Independently-derived reference constants (shizukaziye METHODOLOGY §1 closed form:
// per-level D = 100·ln((1 + other + gridAdd)/(1 + other)) / levels). Computed here from
// the documented baselines so the test does not just echo the implementation.
const refAtk = (100 * Math.log(1.132 / 1.121)) / 30; // attack: other 12.1%, +1.1% / 30
const refAdd = (100 * Math.log(1.3602 / 1.336)) / 30; // add dmg: other 33.6%, +2.42% / 30
const refBoss = (100 * Math.log(1.025 / 1.0)) / 30; // boss: other 0%, +2.5% / 30
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
    expect(D_ATTACK).toBeCloseTo(0.0325495, 6);
    expect(D_ADD).toBeCloseTo(refAdd, 10);
    expect(D_ADD).toBeCloseTo(0.0598389, 6);
    expect(D_BOSS).toBeCloseTo(refBoss, 10);
    expect(D_BOSS).toBeCloseTo(0.0823087, 6);
    expect(D_ORDER).toBeCloseTo(refOrder, 10);
    expect(D_ORDER).toBeCloseTo(0.159872, 5);
    expect(D_WILLPOWER).toBeCloseTo(refWp, 10);
    expect(D_WILLPOWER).toBeCloseTo(0.0781187, 6);
  });

  it('preserves the old DPS weight RATIOS (boss≈2.53, add≈1.84, willpower≈2.4 vs attack=1)', () => {
    expect(D_BOSS / D_ATTACK).toBeCloseTo(2.53, 2);
    expect(D_ADD / D_ATTACK).toBeCloseTo(1.84, 2);
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

describe('grade (0–100, min-max over the gem space) + letter rank', () => {
  it('grades the perfect gem of EVERY base cost at 100 / S+ (cost-fair willpower multiplier)', () => {
    // pool 10 top-2 DPS = Boss + AddDamage; pool 8 top-2 = AddDamage + AtkPower.
    const perfectC10 = gem(5, 5, { optionType: 'BossDamage', value: 5 }, { optionType: 'AddDamage', value: 5 });
    const perfectC8 = gem(3, 5, { optionType: 'AddDamage', value: 5 }, { optionType: 'AtkPower', value: 5 });
    expect(computeGemScore(perfectC10, 'dps').grade).toBe(100);
    expect(computeGemScore(perfectC10, 'dps').rank).toBe('S+');
    expect(computeGemScore(perfectC8, 'dps').grade).toBe(100);
    expect(computeGemScore(perfectC8, 'dps').rank).toBe('S+');
  });

  it('grades a worthless DPS gem (dead effects, high willpower cost) near 0 / F', () => {
    const junk = gem(9, 1, { optionType: 'BrandPower', value: 1 }, { optionType: 'AllyAttackEnh', value: 1 });
    const r = computeGemScore(junk, 'dps');
    expect(r.grade).toBeLessThan(10);
    expect(r.rank.startsWith('F')).toBe(true);
  });

  it('rankFromGrade applies the S85/A75/B65/C50/D25/F0 cuts with +/- thirds', () => {
    expect(rankFromGrade(100)).toBe('S+');
    expect(rankFromGrade(85)).toBe('S-');
    expect(rankFromGrade(83)).toBe('A+'); // band A [75,85): top third
    expect(rankFromGrade(80)).toBe('A'); // middle third
    expect(rankFromGrade(76)).toBe('A-'); // bottom third
    expect(rankFromGrade(65)).toBe('B-');
    expect(rankFromGrade(0)).toBe('F-');
    expect(grade(gem(5, 5, { optionType: 'BossDamage', value: 5 }, { optionType: 'AddDamage', value: 5 }), 'dps')).toBe(100);
  });
});

describe('computeGemScore (Support axis)', () => {
  it('uses support coefficients and ignores DPS damage options', () => {
    const support = gem(4, 4, { optionType: 'AllyAttackEnh', value: 5 }, { optionType: 'BrandPower', value: 5 });
    // willpower 0, support: AllyAttackEnh 0.0596 + Brand 0.0434 per level + 0.0747 order.
    const expected = 0 + 4 * 0.0747 + 5 * 0.0596 + 5 * 0.0434;
    expect(computeGemScore(support, 'support').score).toBeCloseTo(expected, 9);
    // Same gem under DPS: both options are non-DPS -> only the flat order term.
    expect(computeGemScore(support, 'dps').score).toBeCloseTo(4 * refOrder, 9);
  });

  it('refreshed support ratios (AllyAttackEnh:Brand:AllyDamageEnh ≈ 3.06:2.23:1)', () => {
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
    expect(allyAttackEnh / allyDamageEnh).toBeCloseTo(0.0596 / 0.0195, 3);
    expect(brand / allyDamageEnh).toBeCloseTo(0.0434 / 0.0195, 3);
  });

  it('grades the perfect support gem at 100 / S+', () => {
    const perfectSupportC10 = gem(5, 5, { optionType: 'AllyAttackEnh', value: 5 }, { optionType: 'BrandPower', value: 5 });
    const sup = computeGemScore(perfectSupportC10, 'support');
    expect(sup.grade).toBe(100);
    expect(sup.rank).toBe('S+');
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
