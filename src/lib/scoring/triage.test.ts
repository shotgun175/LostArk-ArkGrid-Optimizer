import { describe, expect, it } from 'vitest';

import type { LostArkGrade } from '../constants/enums';
import type { ArkGridCore, ArkGridCoreType } from '../models/arkGridCores';
import type { ArkGridGem } from '../models/arkGridGems';
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

// Known DPS scores (cross-checked in gemScore.test.ts):
//  A: req5/point5 AddDamage4 + AtkPower3 = 13.14
//  B: req8/point2 AtkPower1 + BrandPower1 = -18.88
//  C: req3/point5 BossDamage5 + AddDamage5 = 29.54
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
// Support: AllyAttackEnh5 + BrandPower5 = 16.55 (support) / 0 (dps).
const support = gem(
  4,
  4,
  { optionType: 'AllyAttackEnh', value: 5 },
  { optionType: 'BrandPower', value: 5 }
);

describe('autoBaselineFromLoadout', () => {
  it('returns null for an empty loadout', () => {
    expect(autoBaselineFromLoadout([], 'dps')).toBeNull();
  });
  it('returns the rounded score of the weakest equipped gem', () => {
    // weakest of {13.14, 29.54} = 13.14 -> round 13
    expect(autoBaselineFromLoadout([gemA, gemC], 'dps')).toBe(13);
  });
  it('clamps negatives up to 0 and high scores down to 20', () => {
    // weakest of {13.14, -18.88} = -18.88 -> round -19 -> clamp 0
    expect(autoBaselineFromLoadout([gemA, gemB], 'dps')).toBe(0);
    // only gemC (29.54) -> round 30 -> clamp 20
    expect(autoBaselineFromLoadout([gemC], 'dps')).toBe(20);
  });
  it('respects role (DPS damage options count 0 under support)', () => {
    expect(autoBaselineFromLoadout([support], 'support')).toBe(17); // 16.55 -> 17
    expect(autoBaselineFromLoadout([support], 'dps')).toBe(0); // 0 under dps
  });
});

describe('effectiveBaseline', () => {
  it('prefers a manual override over the auto value', () => {
    expect(effectiveBaseline(13, 9)).toBe(9);
    expect(effectiveBaseline(13, 0)).toBe(0); // explicit 0 wins
  });
  it('uses the auto value when there is no override', () => {
    expect(effectiveBaseline(13, undefined)).toBe(13);
  });
  it('falls back to 0 when there is neither auto nor override', () => {
    expect(effectiveBaseline(null, undefined)).toBe(0);
    expect(effectiveBaseline(null, 5)).toBe(5);
  });
});

describe('triageGem', () => {
  const spare = { isEquipped: false, hasHeadroom: false };
  it('marks an equipped gem as equipped regardless of score or headroom', () => {
    expect(triageGem({ score: 2, baseline: 9, isEquipped: true, hasHeadroom: true }).action).toBe(
      'equipped'
    );
    // Manual baseline pushed above an equipped gem: still equipped, never remove.
    expect(triageGem({ score: 2, baseline: 9, isEquipped: true, hasHeadroom: false }).action).toBe(
      'equipped'
    );
  });
  it('marks at-or-above-baseline spares as upgrades', () => {
    const r = triageGem({ score: 13.14, baseline: 9, ...spare });
    expect(r.action).toBe('upgrade');
    expect(triageGem({ score: 9, baseline: 9, ...spare }).action).toBe('upgrade'); // equal counts
    expect(r.rationale.toLowerCase()).toContain('upgrade');
  });
  it('keeps a below-baseline spare while its cores still have headroom', () => {
    const r = triageGem({ score: 3, baseline: 9, isEquipped: false, hasHeadroom: true });
    expect(r.action).toBe('keep');
    expect(r.rationale.toLowerCase()).toContain('core upgrade');
  });
  it('removes a below-baseline spare only when cores are maxed (no headroom)', () => {
    const r = triageGem({ score: 7, baseline: 9, isEquipped: false, hasHeadroom: false });
    expect(r.action).toBe('remove');
    expect(r.rationale.toLowerCase()).toContain('maxed');
    expect(triageGem({ score: -5, baseline: 0, ...spare }).action).toBe('remove');
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
