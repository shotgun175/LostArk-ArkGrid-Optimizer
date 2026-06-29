import type { ArkGridAttr } from '../constants/enums';
import type { ArkGridCore, ArkGridCoreType } from '../models/arkGridCores';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
import {
  BASELINE_MAX_GRADE,
  BASELINE_MIN_GRADE,
  type GemRole,
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
  return bumpedBaselineGrade(strongerSource);
}

/**
 * Effective baseline GRADE: a manual override (a ladder grade) wins; otherwise the auto value; otherwise
 * the floor. An out-of-range override (e.g. a pre-grade-migration % value ≤ 2) is ignored so a stale
 * setting can't drag the baseline down to F.
 */
export function effectiveBaseline(auto: number | null, override: number | undefined): number {
  if (override !== undefined && override >= BASELINE_MIN_GRADE && override <= BASELINE_MAX_GRADE) {
    return override;
  }
  return auto ?? BASELINE_MIN_GRADE;
}

/**
 * Per-owned-gem "is this gem currently slotted?" flags, matched against the solved loadout
 * by value (attribute + stat fingerprint) with a consumable count — so if you own duplicates
 * and only some are equipped, exactly that many are flagged. Mirrors the dup-handling in
 * SolvePanel's buildAssignedGems. The flag order matches `owned`.
 */
export function equippedFlags(owned: ArkGridGem[], equipped: ArkGridGem[]): boolean[] {
  const counts = new Map<string, number>();
  for (const gem of equipped) {
    const key = equippedKey(gem);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return owned.map((gem) => {
    const key = equippedKey(gem);
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) {
      counts.set(key, remaining - 1);
      return true;
    }
    return false;
  });
}

// Attribute matters: an Order and a Chaos gem can share stats but are not interchangeable.
function equippedKey(gem: ArkGridGem): string {
  return `${gem.gemAttr}|${gemFingerprint(gem)}`;
}

/**
 * Does this attribute's grid still have capacity headroom? True when any of its cores is
 * below Ancient (or missing) — a core grade upgrade adds energy that can slot an otherwise
 * unused gem, so a below-baseline spare is not safe to remove yet. Only when every core is
 * maxed (Ancient) is there no future arrangement that could rescue it.
 */
export function attrHasUpgradeHeadroom(
  coresForAttr: Record<ArkGridCoreType, ArkGridCore | null>
): boolean {
  return Object.values(coresForAttr).some((core) => !core || core.grade !== 'Ancient');
}

/**
 * Triage a gem by comparing its GRADE (letter tier) against the baseline tier:
 *  - equipped → 'equipped' (currently slotted; not an upgrade or removal target)
 *  - spare, at/above the baseline tier → 'upgrade' (reaches your target tier; slot-able)
 *  - spare, below baseline, attribute still has core headroom → 'keep' (a core upgrade could
 *    still slot it — hold for now)
 *  - spare, below baseline, cores maxed (no headroom) → 'remove' (it will never be slotted)
 */
export function triageGem({
  grade,
  baseline,
  isEquipped,
  hasHeadroom,
}: {
  grade: number;
  baseline: number;
  isEquipped: boolean;
  hasHeadroom: boolean;
}): TriageResult {
  if (isEquipped) {
    return {
      action: 'equipped',
      rationale: 'Currently equipped, part of your solved loadout.',
    };
  }
  const gemTier = rankFromGrade(grade);
  const baseTier = rankFromGrade(baseline);
  if (grade >= baseline) {
    return {
      action: 'upgrade',
      rationale: `Tier ${gemTier} reaches your baseline ${baseTier} — a slot-able upgrade.`,
    };
  }
  if (hasHeadroom) {
    return {
      action: 'keep',
      rationale: `Tier ${gemTier} is below your baseline ${baseTier}, but a core upgrade could still slot it, so hold for now.`,
    };
  }
  return {
    action: 'remove',
    rationale: `Tier ${gemTier} is below your baseline ${baseTier} and your cores are maxed, so it will never be slotted.`,
  };
}

const ROLE_LABEL: Record<GemRole, string> = { dps: 'DPS', support: 'Support' };

/**
 * Reconcile a gem's active-build verdict against its other build (dual-role characters only).
 * A gem is only ever 'remove' if BOTH builds would remove it: when the active build says remove
 * but the other build still uses it (equipped/upgrade/keep), downgrade to 'keep'. `other` is null
 * for single-role characters, leaving the active verdict untouched. Only the action is reconciled —
 * the displayed score/tier stay the active build's.
 */
export function reconcileDualBuild(
  active: TriageResult,
  other: TriageResult | null,
  otherRoleName: GemRole
): TriageResult {
  if (active.action !== 'remove' || !other || other.action === 'remove') {
    return active;
  }
  return {
    action: 'keep',
    rationale: `Below baseline for your active build, but your ${ROLE_LABEL[otherRoleName]} build still uses it, so keep.`,
  };
}
