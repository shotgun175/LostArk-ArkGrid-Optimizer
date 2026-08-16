import type { ArkGridAttr } from '../constants/enums';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
import {
  BASELINE_MIN_GRADE,
  type GemRole,
  baselineMaxGrade,
  bumpedBaselineGrade,
  computeGemScore,
  rankFromGrade,
} from './gemScore';

export type TriageAction = 'equipped' | 'upgrade' | 'keep' | 'remove';

export interface TriageResult {
  action: TriageAction;
  rationale: string;
}

// The baseline is a 0-100 GRADE on shizukaziye's rank ladder (GRADE_ROWS, ranks C- … S+), shown as a
// letter tier. It is the ONE value both the Gem Triage upgrade/keep/remove split and the Cutting Plan
// target read, so the two panels stay tied together as the user moves the shared control.

/** One attribute's source grade for the baseline: its 3rd-lowest equipped grade (or lowest if <3). */
function attrSourceGrade(equipped: ArkGridGem[], attr: ArkGridAttr, role: GemRole): number | null {
  const grades = equipped
    .filter((gem) => gem.gemAttr === attr)
    .map((gem) => computeGemScore(gem, role).grade)
    .sort((a, b) => a - b);
  if (grades.length === 0) return null;
  return grades.length >= 3 ? grades[2] : grades[0];
}

/**
 * Auto baseline = a GRADE on the rank ladder, one rank ABOVE the stronger of the two attributes'
 * 3rd-lowest equipped gems (shizukaziye's blanketBaseline) — the tier a gem must reach to be a slot-able
 * upgrade, biased to "improve upwards". Returns null when there is no equipped loadout to derive it from.
 */
export function autoBaselineFromLoadout(equipped: ArkGridGem[], role: GemRole): number | null {
  if (equipped.length === 0) return null;
  const order = attrSourceGrade(equipped, 'Order', role);
  const chaos = attrSourceGrade(equipped, 'Chaos', role);
  if (order === null && chaos === null) return null;
  const strongerSource = Math.max(order ?? -Infinity, chaos ?? -Infinity);
  return bumpedBaselineGrade(strongerSource, role);
}

/**
 * Effective baseline GRADE: a manual override (a ladder grade) wins; otherwise the auto value; otherwise
 * the floor. An out-of-range override (e.g. a pre-grade-migration % value ≤ 2) is ignored so a stale
 * setting can't drag the baseline down to F.
 */
export function effectiveBaseline(
  auto: number | null,
  override: number | undefined,
  role: GemRole = 'dps'
): number {
  if (
    override !== undefined &&
    override >= BASELINE_MIN_GRADE &&
    override <= baselineMaxGrade(role)
  ) {
    return override;
  }
  return auto ?? BASELINE_MIN_GRADE;
}

/** A key that distinguishes gems by attribute AND stats (Order vs Chaos are not interchangeable). */
function gemKey(gem: ArkGridGem): string {
  return `${gem.gemAttr}|${gemFingerprint(gem)}`;
}

/** Count gem copies per key across all six cores of one solve assignment. */
export function solveKeyCounts(assignment: ArkGridGem[][] | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  if (!assignment) return counts;
  for (const slot of assignment) {
    for (const gem of slot) {
      const key = gemKey(gem);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Per-key retained count = the MAX copies used in any single solve (see the plan's "retained count"
 * rule). Max, not sum: a build reuses the same physical gems from current→endgame, and a hybrid keeps
 * enough for whichever single loadout (DPS or Support) demands the most of that fingerprint.
 */
export function retainedCounts(assignments: (ArkGridGem[][] | undefined)[]): Map<string, number> {
  const max = new Map<string, number>();
  for (const assignment of assignments) {
    for (const [key, n] of solveKeyCounts(assignment)) {
      if ((max.get(key) ?? 0) < n) max.set(key, n);
    }
  }
  return max;
}

export interface OwnedTriageInput {
  gem: ArkGridGem;
  /** The gem's 0-100 grade under the active role (from computeGemScore). */
  grade: number;
}

/**
 * Triage every owned gem against the current and endgame solves.
 *  - used by the active current solve      -> 'equipped'
 *  - retained by some solve, at/above base -> 'upgrade' (a maxed grid slots it; you'll grow into it)
 *  - retained by some solve, below base    -> 'keep'    (a maxed grid still uses it as filler)
 *  - used by no solve                      -> 'remove'  (surplus; pure union, tier-independent)
 * When `hasEndgameEvidence` is false we lack the perfect-state data, so nothing is removed — an
 * un-retained spare falls back to 'keep' until the user refreshes the analysis.
 *
 * `retainAssignments` is every solve whose usage should KEEP a gem: the active endgame solve, plus
 * (for hybrids) the other build's current and endgame solves. `activeCurrent` is passed separately
 * because it also drives the 'equipped' label; it is folded into the retained set internally.
 */
export function triageOwnedGems(
  owned: OwnedTriageInput[],
  opts: {
    activeCurrent: ArkGridGem[][] | undefined;
    retainAssignments: (ArkGridGem[][] | undefined)[];
    baseline: number;
    hasEndgameEvidence: boolean;
    /** Which axis's rank ladder to read tiers on (the two differ only in where S+ starts). */
    role?: GemRole;
  }
): TriageResult[] {
  const role: GemRole = opts.role ?? 'dps';
  const equippedRemaining = solveKeyCounts(opts.activeCurrent);
  const retainedRemaining = retainedCounts([opts.activeCurrent, ...opts.retainAssignments]);
  const baseTier = rankFromGrade(opts.baseline, role);

  return owned.map(({ gem, grade }) => {
    const key = gemKey(gem);
    const gemTier = rankFromGrade(grade, role);
    const retained = retainedRemaining.get(key) ?? 0;

    if (retained > 0) {
      retainedRemaining.set(key, retained - 1);
      const eq = equippedRemaining.get(key) ?? 0;
      if (eq > 0) {
        equippedRemaining.set(key, eq - 1);
        return {
          action: 'equipped',
          rationale: 'Currently equipped, part of your solved loadout.',
        };
      }
      if (grade >= opts.baseline) {
        return {
          action: 'upgrade',
          rationale: `Tier ${gemTier} reaches your baseline ${baseTier} and a maxed grid slots it — a slot-able upgrade.`,
        };
      }
      return {
        action: 'keep',
        rationale: `Tier ${gemTier} is below your baseline ${baseTier}, but a fully-maxed (Ancient) grid still uses it, so keep.`,
      };
    }

    if (!opts.hasEndgameEvidence) {
      return {
        action: 'keep',
        rationale:
          'Use Optimize to check whether a maxed grid would use this gem before removing it.',
      };
    }
    return {
      action: 'remove',
      rationale: `Tier ${gemTier} isn't used by your current grid or a fully-maxed (Ancient) grid — surplus, safe to drop.`,
    };
  });
}
