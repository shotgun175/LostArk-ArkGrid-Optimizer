import { describe, expect, it } from 'vitest';

import type { LostArkGrade } from '../constants/enums';
import type { ArkGridCore, ArkGridCoreType } from '../models/arkGridCores';
import type { ArkGridGem } from '../models/arkGridGems';
import { GRADE_ROWS, bumpedBaselineGrade, computeGemScore } from './gemScore';
import {
  type TriageAction,
  type TriageResult,
  attrHasUpgradeHeadroom,
  autoBaselineFromLoadout,
  effectiveBaseline,
  equippedFlags,
  reconcileDualBuild,
  triageGem,
} from './triage';

// Minimal gem builder — only the fields the scorer reads (gemAttr is not used by scoring).
function gem(
  req: number,
  point: number,
  o1: ArkGridGem['option1'],
  o2: ArkGridGem['option2']
): ArkGridGem {
  return { gemAttr: 'Chaos', req, point, option1: o1, option2: o2 };
}

// Known DPS scores in % damage (cross-checked in gemScore.test.ts):
//  A: req5/point5 AddDamage4 + AtkPower3 ≈ 1.06
//  C: req3/point5 BossDamage5 + AddDamage5 ≈ 1.59
const gemA = gem(5, 5, { optionType: 'AddDamage', value: 4 }, { optionType: 'AtkPower', value: 3 });
const gemB = gem(
  8,
  2,
  { optionType: 'AtkPower', value: 1 },
  { optionType: 'BrandPower', value: 1 }
);
const gemC = gem(
  3,
  5,
  { optionType: 'BossDamage', value: 5 },
  { optionType: 'AddDamage', value: 5 }
);
// A junk DPS gem: high willpower cost + dead effects + low order → negative % damage.
const junk = gem(
  9,
  1,
  { optionType: 'BrandPower', value: 1 },
  { optionType: 'AllyDamageEnh', value: 1 }
);
// Support: AllyAttackEnh5 + BrandPower5 ≈ 0.27 (support, per-DPS ÷3) / 0.64 (dps; only its order points count).
const support = gem(
  4,
  4,
  { optionType: 'AllyAttackEnh', value: 5 },
  { optionType: 'BrandPower', value: 5 }
);

describe('autoBaselineFromLoadout', () => {
  const dpsGrade = (g: ArkGridGem) => computeGemScore(g, 'dps').grade;

  it('returns null for an empty loadout', () => {
    expect(autoBaselineFromLoadout([], 'dps')).toBeNull();
  });
  it('returns a grade on the rank ladder (GRADE_ROWS)', () => {
    expect(GRADE_ROWS).toContain(autoBaselineFromLoadout([gemA, gemC], 'dps'));
  });
  it('is one rank above the lowest equipped grade when an attribute has < 3 gems', () => {
    const equipped = [gemA, gemC]; // both Chaos, only 2 gems
    const lowest = Math.min(...equipped.map(dpsGrade));
    expect(autoBaselineFromLoadout(equipped, 'dps')).toBe(bumpedBaselineGrade(lowest));
  });
  it('uses the 3rd-lowest grade of an attribute when it has >= 3 gems', () => {
    const chaos = [gemA, gemB, gemC]; // 3 Chaos gems
    const thirdLowest = chaos.map(dpsGrade).sort((a, b) => a - b)[2];
    expect(autoBaselineFromLoadout(chaos, 'dps')).toBe(bumpedBaselineGrade(thirdLowest));
  });
  it('drives the baseline off the stronger attribute’s source gem', () => {
    const strongOrder = { ...gemC, gemAttr: 'Order' as const }; // high grade
    const weakChaos = { ...junk, gemAttr: 'Chaos' as const }; // low grade
    expect(dpsGrade(strongOrder)).toBeGreaterThan(dpsGrade(weakChaos));
    expect(autoBaselineFromLoadout([strongOrder, weakChaos], 'dps')).toBe(
      bumpedBaselineGrade(dpsGrade(strongOrder))
    );
  });
  it('is role-aware (each role grades the same gem on its own axis)', () => {
    expect(GRADE_ROWS).toContain(autoBaselineFromLoadout([support], 'dps'));
    expect(GRADE_ROWS).toContain(autoBaselineFromLoadout([support], 'support'));
  });
});

describe('effectiveBaseline', () => {
  it('prefers an in-range manual override (a ladder grade) over the auto value', () => {
    expect(effectiveBaseline(70, 85)).toBe(85);
    expect(effectiveBaseline(70, GRADE_ROWS[0])).toBe(GRADE_ROWS[0]); // floor grade is in range
  });
  it('uses the auto value when there is no override', () => {
    expect(effectiveBaseline(70, undefined)).toBe(70);
  });
  it('ignores an out-of-range (pre-migration %) override and uses auto', () => {
    expect(effectiveBaseline(70, 0.85)).toBe(70); // stale % value, below the grade range
    expect(effectiveBaseline(70, 200)).toBe(70); // above the grade range
  });
  it('falls back to the floor grade when there is neither auto nor a valid override', () => {
    expect(effectiveBaseline(null, undefined)).toBe(GRADE_ROWS[0]);
    expect(effectiveBaseline(null, 0.5)).toBe(GRADE_ROWS[0]); // stale override ignored
    expect(effectiveBaseline(null, 75)).toBe(75); // valid override used
  });
});

describe('triageGem', () => {
  const spare = { isEquipped: false, hasHeadroom: false };
  it('marks an equipped gem as equipped regardless of grade or headroom', () => {
    expect(triageGem({ grade: 20, baseline: 70, isEquipped: true, hasHeadroom: true }).action).toBe(
      'equipped'
    );
    // Manual baseline pushed above an equipped gem's tier: still equipped, never remove.
    expect(triageGem({ grade: 20, baseline: 70, isEquipped: true, hasHeadroom: false }).action).toBe(
      'equipped'
    );
  });
  it('marks at-or-above-baseline-tier spares as upgrades', () => {
    const r = triageGem({ grade: 88, baseline: 70, ...spare });
    expect(r.action).toBe('upgrade');
    expect(triageGem({ grade: 70, baseline: 70, ...spare }).action).toBe('upgrade'); // equal counts
    expect(r.rationale.toLowerCase()).toContain('upgrade');
  });
  it('keeps a below-baseline spare while its cores still have headroom', () => {
    const r = triageGem({ grade: 50, baseline: 70, isEquipped: false, hasHeadroom: true });
    expect(r.action).toBe('keep');
    expect(r.rationale.toLowerCase()).toContain('core upgrade');
  });
  it('removes a below-baseline spare only when cores are maxed (no headroom)', () => {
    const r = triageGem({ grade: 55, baseline: 70, isEquipped: false, hasHeadroom: false });
    expect(r.action).toBe('remove');
    expect(r.rationale.toLowerCase()).toContain('maxed');
  });
});

describe('equippedFlags', () => {
  it('flags owned gems present in the loadout, matched by value', () => {
    const owned = [gemA, gemB, gemC];
    const equipped = [{ ...gemA }, { ...gemC }]; // value-equal copies, as the solver stores them
    expect(equippedFlags(owned, equipped)).toEqual([true, false, true]);
  });
  it('consumes duplicates by count — only as many flagged as are equipped', () => {
    const owned = [gemA, gemA, gemA];
    const equipped = [{ ...gemA }, { ...gemA }]; // 2 of the 3 identical gems are slotted
    expect(equippedFlags(owned, equipped)).toEqual([true, true, false]);
  });
  it('distinguishes by attribute even with identical stats', () => {
    const orderTwin = { ...gemA, gemAttr: 'Order' as const };
    const chaosTwin = { ...gemA, gemAttr: 'Chaos' as const };
    expect(equippedFlags([orderTwin, chaosTwin], [{ ...chaosTwin }])).toEqual([false, true]);
  });
});

describe('attrHasUpgradeHeadroom', () => {
  const mk = (
    ...grades: Array<LostArkGrade | null>
  ): Record<ArkGridCoreType, ArkGridCore | null> => {
    const [sun, moon, star] = grades;
    const core = (g: LostArkGrade | null) => (g ? ({ grade: g } as unknown as ArkGridCore) : null);
    return { Sun: core(sun), Moon: core(moon), Star: core(star) };
  };
  it('has headroom when any core is below Ancient', () => {
    expect(attrHasUpgradeHeadroom(mk('Ancient', 'Ancient', 'Relic'))).toBe(true);
  });
  it('has headroom when a core is missing', () => {
    expect(attrHasUpgradeHeadroom(mk('Ancient', 'Ancient', null))).toBe(true);
  });
  it('has no headroom only when every core is Ancient', () => {
    expect(attrHasUpgradeHeadroom(mk('Ancient', 'Ancient', 'Ancient'))).toBe(false);
  });
});

describe('reconcileDualBuild', () => {
  const r = (action: TriageAction): TriageResult => ({ action, rationale: 'x' });

  it('leaves a non-remove active verdict untouched (the active build drives display)', () => {
    expect(reconcileDualBuild(r('upgrade'), r('remove'), 'support').action).toBe('upgrade');
    expect(reconcileDualBuild(r('keep'), r('remove'), 'support').action).toBe('keep');
    expect(reconcileDualBuild(r('equipped'), r('remove'), 'support').action).toBe('equipped');
  });

  it('keeps remove only when the other build also removes', () => {
    expect(reconcileDualBuild(r('remove'), r('remove'), 'support').action).toBe('remove');
  });

  it('downgrades remove to keep when the other build still uses the gem', () => {
    for (const otherAction of ['equipped', 'upgrade', 'keep'] as TriageAction[]) {
      const out = reconcileDualBuild(r('remove'), r(otherAction), 'support');
      expect(out.action).toBe('keep');
      expect(out.rationale).toContain('Support');
    }
  });

  it('leaves the active remove verdict for single-role (other is null)', () => {
    expect(reconcileDualBuild(r('remove'), null, 'dps').action).toBe('remove');
  });
});
