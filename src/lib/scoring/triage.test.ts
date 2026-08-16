import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { BASELINE_MIN_GRADE, bumpedBaselineGrade, computeGemScore, gradeRows } from './gemScore';
import {
  type OwnedTriageInput,
  autoBaselineFromLoadout,
  effectiveBaseline,
  retainedCounts,
  solveKeyCounts,
  triageOwnedGems,
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
  it('returns a grade on the rank ladder (gradeRows)', () => {
    expect(gradeRows('dps')).toContain(autoBaselineFromLoadout([gemA, gemC], 'dps'));
  });
  it('is one rank above the lowest equipped grade when an attribute has < 3 gems', () => {
    const equipped = [gemA, gemC]; // both Chaos, only 2 gems
    const lowest = Math.min(...equipped.map(dpsGrade));
    expect(autoBaselineFromLoadout(equipped, 'dps')).toBe(bumpedBaselineGrade(lowest, 'dps'));
  });
  it('uses the 3rd-lowest grade of an attribute when it has >= 3 gems', () => {
    const chaos = [gemA, gemB, gemC]; // 3 Chaos gems
    const thirdLowest = chaos.map(dpsGrade).sort((a, b) => a - b)[2];
    expect(autoBaselineFromLoadout(chaos, 'dps')).toBe(bumpedBaselineGrade(thirdLowest, 'dps'));
  });
  it('drives the baseline off the stronger attribute’s source gem', () => {
    const strongOrder = { ...gemC, gemAttr: 'Order' as const }; // high grade
    const weakChaos = { ...junk, gemAttr: 'Chaos' as const }; // low grade
    expect(dpsGrade(strongOrder)).toBeGreaterThan(dpsGrade(weakChaos));
    expect(autoBaselineFromLoadout([strongOrder, weakChaos], 'dps')).toBe(
      bumpedBaselineGrade(dpsGrade(strongOrder), 'dps')
    );
  });
  it('is role-aware (each role grades the same gem on its own axis and its own ladder)', () => {
    expect(gradeRows('dps')).toContain(autoBaselineFromLoadout([support], 'dps'));
    expect(gradeRows('support')).toContain(autoBaselineFromLoadout([support], 'support'));
  });
});

describe('effectiveBaseline', () => {
  it('prefers an in-range manual override (a ladder grade) over the auto value', () => {
    expect(effectiveBaseline(70, 83.3)).toBe(83.3);
    expect(effectiveBaseline(70, BASELINE_MIN_GRADE)).toBe(BASELINE_MIN_GRADE); // floor grade is in range
    // the top of the ladder differs per axis (S+ = perfect c8: 96.1 DPS, 94.6 support)
    expect(effectiveBaseline(70, 96.1, 'dps')).toBe(96.1);
    expect(effectiveBaseline(70, 96.1, 'support')).toBe(70); // above the support ladder
    expect(effectiveBaseline(70, 94.6, 'support')).toBe(94.6);
  });
  it('uses the auto value when there is no override', () => {
    expect(effectiveBaseline(70, undefined)).toBe(70);
  });
  it('ignores an out-of-range (pre-migration %) override and uses auto', () => {
    expect(effectiveBaseline(70, 0.85)).toBe(70); // stale % value, below the grade range
    expect(effectiveBaseline(70, 200)).toBe(70); // above the grade range
  });
  it('falls back to the floor grade when there is neither auto nor a valid override', () => {
    expect(effectiveBaseline(null, undefined)).toBe(BASELINE_MIN_GRADE);
    expect(effectiveBaseline(null, 0.5)).toBe(BASELINE_MIN_GRADE); // stale override ignored
    expect(effectiveBaseline(null, 75)).toBe(75); // valid override used
  });
});

describe('solveKeyCounts', () => {
  it('counts gem copies per attribute+fingerprint across all cores', () => {
    const assignment = [[gemA], [gemA, gemC], [], [], [], []]; // gemA twice, gemC once (all Chaos)
    const counts = solveKeyCounts(assignment);
    expect(counts.size).toBe(2); // two distinct gems: gemA and gemC
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([1, 2]); // gemC once, gemA twice
  });
  it('returns an empty map for an undefined assignment', () => {
    expect(solveKeyCounts(undefined).size).toBe(0);
  });
});

describe('retainedCounts', () => {
  it('takes the MAX count per key across solves, not the sum', () => {
    const current = [[gemA], [], [], [], [], []]; // 1 copy of gemA
    const endgame = [[gemA], [gemA], [], [], [], []]; // 2 copies of gemA
    const counts = retainedCounts([current, endgame]);
    expect([...counts.values()]).toEqual([2]); // max(1, 2) = 2, not 3
  });
  it('ignores undefined solves', () => {
    const current = [[gemC], [], [], [], [], []];
    expect([...retainedCounts([current, undefined]).values()]).toEqual([1]);
  });
});

describe('triageOwnedGems', () => {
  const dpsGrade = (g: ArkGridGem) => computeGemScore(g, 'dps').grade;
  const owned = (gems: ArkGridGem[]): OwnedTriageInput[] =>
    gems.map((gem) => ({ gem, grade: dpsGrade(gem) }));

  it('marks a gem in the current solve as equipped', () => {
    const res = triageOwnedGems(owned([gemA]), {
      activeCurrent: [[gemA], [], [], [], [], []],
      retainAssignments: [],
      baseline: 70,
      hasEndgameEvidence: true,
    });
    expect(res[0].action).toBe('equipped');
  });

  it('keeps a below-baseline spare that the endgame solve slots', () => {
    // gemB is a weak (below-baseline) Chaos gem; endgame uses it, current does not.
    const res = triageOwnedGems(owned([gemB]), {
      activeCurrent: [[], [], [], [], [], []],
      retainAssignments: [[[gemB], [], [], [], [], []]],
      baseline: 90,
      hasEndgameEvidence: true,
    });
    expect(res[0].action).toBe('keep');
  });

  it('removes a spare used by no solve, regardless of tier (pure union)', () => {
    // gemA is high-tier but appears in no solve -> Remove, because a maxed grid still would not slot it.
    const res = triageOwnedGems(owned([gemA]), {
      activeCurrent: [[], [], [], [], [], []],
      retainAssignments: [[[], [], [], [], [], []]],
      baseline: 20,
      hasEndgameEvidence: true,
    });
    expect(res[0].action).toBe('remove');
  });

  it('marks a retained, non-equipped, at/above-baseline spare as an upgrade', () => {
    // gemC is a strong Chaos gem (high grade). It isn't in the current solve, but the endgame solve
    // slots it, and its grade is above the low baseline -> upgrade (a maxed grid gem to grow into).
    const res = triageOwnedGems(owned([gemC]), {
      activeCurrent: [[], [], [], [], [], []],
      retainAssignments: [[[gemC], [], [], [], [], []]],
      baseline: 20,
      hasEndgameEvidence: true,
    });
    expect(res[0].action).toBe('upgrade');
  });

  it('never removes when endgame evidence is missing (safe fallback = keep)', () => {
    const res = triageOwnedGems(owned([gemB]), {
      activeCurrent: [[], [], [], [], [], []],
      retainAssignments: [],
      baseline: 90,
      hasEndgameEvidence: false,
    });
    expect(res[0].action).toBe('keep');
  });

  it('retains only as many duplicates as the busiest solve uses', () => {
    const three = owned([gemB, gemB, gemB]);
    const res = triageOwnedGems(three, {
      activeCurrent: [[], [], [], [], [], []],
      retainAssignments: [[[gemB], [gemB], [], [], [], []]], // endgame uses 2 copies
      baseline: 90,
      hasEndgameEvidence: true,
    });
    expect(res.map((r) => r.action)).toEqual(['keep', 'keep', 'remove']);
  });
});
