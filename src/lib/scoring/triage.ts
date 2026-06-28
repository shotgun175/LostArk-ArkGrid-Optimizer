import type { ArkGridCore, ArkGridCoreType } from '../models/arkGridCores';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
import { type GemRole, computeGemScore } from './gemScore';

export type TriageAction = 'equipped' | 'upgrade' | 'keep' | 'remove';

export interface TriageResult {
  action: TriageAction;
  rationale: string;
}

// The baseline slider range, in % damage. Baseline = score of the weakest equipped gem;
// a perfect gem is ≈ 1.4 % damage, so real weakest-equipped values sit inside this band.
const BASELINE_MIN = 0;
const BASELINE_MAX = 2;

/**
 * Auto baseline = the score (% damage) of the weakest *equipped* gem (rounded to 2 dp,
 * clamped to 0–2) — the threshold a gem must beat to be a slot-able upgrade. Returns null
 * when there is no equipped loadout to derive it from (e.g. before the optimizer has run).
 */
export function autoBaselineFromLoadout(equipped: ArkGridGem[], role: GemRole): number | null {
  if (equipped.length === 0) return null;
  const weakest = Math.min(...equipped.map((gem) => computeGemScore(gem, role).score));
  return Math.max(BASELINE_MIN, Math.min(BASELINE_MAX, round2(weakest)));
}

/** Effective baseline: a manual override wins; otherwise the auto value; otherwise 0. */
export function effectiveBaseline(auto: number | null, override: number | undefined): number {
  return override ?? auto ?? 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
 * Triage a gem:
 *  - equipped → 'equipped' (currently slotted; not an upgrade or removal target)
 *  - spare, at/above baseline → 'upgrade' (beats your weakest equipped gem; slot-able)
 *  - spare, below baseline, attribute still has core headroom → 'keep' (a core upgrade could
 *    still slot it — hold for now)
 *  - spare, below baseline, cores maxed (no headroom) → 'remove' (it will never be slotted)
 */
export function triageGem({
  score,
  baseline,
  isEquipped,
  hasHeadroom,
}: {
  score: number;
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
  if (score >= baseline) {
    return {
      action: 'upgrade',
      rationale: `Beats your weakest equipped gem (${round2(score)} >= ${baseline}), a slot-able upgrade.`,
    };
  }
  if (hasHeadroom) {
    return {
      action: 'keep',
      rationale: `Below your weakest equipped (${round2(score)} < ${baseline}), but a core upgrade could still slot it, so hold for now.`,
    };
  }
  return {
    action: 'remove',
    rationale: `Below your weakest equipped (${round2(score)} < ${baseline}) and your cores are maxed, so it will never be slotted.`,
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
