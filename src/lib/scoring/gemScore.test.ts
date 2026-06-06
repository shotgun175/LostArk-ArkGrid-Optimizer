import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { computeGemScore, explainGemScore, tierForScore } from './gemScore';

// Minimal gem builder — only the fields the scorer reads.
function gem(
  req: number,
  point: number,
  o1: ArkGridGem['option1'],
  o2: ArkGridGem['option2']
): ArkGridGem {
  return { gemAttr: 'Chaos', req, point, option1: o1, option2: o2 };
}

describe('computeGemScore (DPS)', () => {
  it("matches the guide's worked example (=> 13.14)", () => {
    const g = gem(
      5,
      5,
      { optionType: 'AddDamage', value: 4 },
      { optionType: 'AtkPower', value: 3 }
    );
    const r = computeGemScore(g, 'dps');
    expect(r.score).toBeCloseTo(13.14, 2);
    expect(r.tier).toBe('Very Good');
    expect(r.contributions.willpower).toBeCloseTo(-2.4, 2);
    expect(r.contributions.point).toBeCloseTo(5.14, 2);
    expect(r.contributions.option1).toBeCloseTo(7.4, 2);
    expect(r.contributions.option2).toBeCloseTo(3.0, 2);
  });

  it('is neutral (0) for req 4 / point 4 with no DPS-relevant options', () => {
    const g = gem(
      4,
      4,
      { optionType: 'BrandPower', value: 5 },
      { optionType: 'AllyDamageEnh', value: 5 }
    );
    const r = computeGemScore(g, 'dps');
    expect(r.score).toBeCloseTo(0, 6);
    expect(r.tier).toBe('Priority to Replace');
  });

  it('rewards low willpower and high point', () => {
    const g = gem(
      3,
      5,
      { optionType: 'BossDamage', value: 5 },
      { optionType: 'AddDamage', value: 5 }
    );
    // (4-3)*2.40 + (5-4)*5.14 + 2.55*5 + 1.85*5 = 2.40 + 5.14 + 12.75 + 9.25 = 29.54
    expect(computeGemScore(g, 'dps').score).toBeCloseTo(29.54, 2);
  });
});

describe('computeGemScore (Support)', () => {
  it('uses support coeffs and ignores DPS damage options', () => {
    const support = gem(
      4,
      4,
      { optionType: 'AllyAttackEnh', value: 5 },
      { optionType: 'BrandPower', value: 5 }
    );
    // 1.95*5 + 1.36*5 = 9.75 + 6.80 = 16.55
    expect(computeGemScore(support, 'support').score).toBeCloseTo(16.55, 2);
    expect(computeGemScore(support, 'support').tier).toBe('Excellent');

    // Same gem under DPS role: both options count 0 -> only neutral terms -> 0
    expect(computeGemScore(support, 'dps').score).toBeCloseTo(0, 6);
  });
});

describe('explainGemScore', () => {
  it('breaks the score into four factors that sum to the total', () => {
    const g = gem(
      5,
      5,
      { optionType: 'AddDamage', value: 4 },
      { optionType: 'AtkPower', value: 3 }
    );
    const factors = explainGemScore(g, 'dps');
    expect(factors).toHaveLength(4);
    const sum = factors.reduce((acc, f) => acc + f.value, 0);
    expect(sum).toBeCloseTo(computeGemScore(g, 'dps').score, 6);
    expect(factors[0].label).toBe('Willpower');
    expect(factors[2].label).toBe('Additional Damage');
  });

  it('uses role-specific coefficients for the option factors', () => {
    const support = gem(
      4,
      4,
      { optionType: 'AllyAttackEnh', value: 5 },
      { optionType: 'BrandPower', value: 5 }
    );
    const dpsOpts = explainGemScore(support, 'dps').slice(2);
    const supOpts = explainGemScore(support, 'support').slice(2);
    expect(dpsOpts[0].value + dpsOpts[1].value).toBe(0);
    expect(supOpts[0].value + supOpts[1].value).toBeGreaterThan(0);
  });
});

describe('tierForScore', () => {
  it('applies inclusive >= boundaries, falling through to Priority to Replace', () => {
    expect(tierForScore(15.01)).toBe('Excellent');
    expect(tierForScore(15)).toBe('Excellent');
    expect(tierForScore(14.99)).toBe('Very Good');
    expect(tierForScore(10)).toBe('Very Good');
    expect(tierForScore(9.99)).toBe('Good for now');
    expect(tierForScore(5)).toBe('Good for now');
    expect(tierForScore(4.99)).toBe('Priority to Replace');
    expect(tierForScore(-3)).toBe('Priority to Replace');
  });
});
