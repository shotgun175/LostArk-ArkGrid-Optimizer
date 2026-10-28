// Per-outcome grade previews for the Cut Advisor: what the gem would grade if ONE of the four possible
// outcomes on the Processing window landed, next to what it grades now. Re-implements the preview in
// shizukaziye's advisor-window.js (previewGrade / oscoreHtml) on our own gemScore.ts, which
// advisorDp.test.ts pins to the vendored astrogem.js grade for grade. The transitions mirror the
// vendored nested.js applyOutcome; outcomePreview.test.ts pins both against the vendored files.
// Pure: no Svelte, no worker, so the window can recompute it on every click.
//
// One deliberate divergence: upstream shows "?" for an Effect Changed outcome. The vendored DP itself
// resolves that outcome as an even split over the pool effects the gem does not already carry (two,
// every pool has four), and the new effect keeps the replaced line's level, so both landing grades
// are known and shown instead.
import type { ArkGridGemOptionName } from '../models/arkGridGemSpecs';
import { type GemRank, type GemRole, grade, rankFromGrade } from '../scoring/gemScore';
import type { AdvisorConfig, AdvisorOutcome } from './advisorController';

/** His effect names (the advisor's vocabulary) to our option-type keys. */
export const EFFECT_NAME_TO_KEY: Record<string, ArkGridGemOptionName> = {
  'Attack Power': 'AtkPower',
  'Additional Damage': 'AddDamage',
  'Boss Damage': 'BossDamage',
  'Brand Power': 'BrandPower',
  'Ally Damage Enh.': 'AllyDamageEnh',
  'Ally Attack Enh.': 'AllyAttackEnh',
};

/** Side-effect pool per base cost, in his names and order (the vendored EFFECT_POOLS). */
export const EFFECT_POOLS: Record<number, readonly string[]> = {
  8: ['Additional Damage', 'Attack Power', 'Brand Power', 'Ally Damage Enh.'],
  9: ['Boss Damage', 'Attack Power', 'Ally Damage Enh.', 'Ally Attack Enh.'],
  10: ['Boss Damage', 'Additional Damage', 'Brand Power', 'Ally Attack Enh.'],
};

const LEVEL_FIELD: Record<
  string,
  'willpowerLevel' | 'orderLevel' | 'effect1Level' | 'effect2Level'
> = {
  willpower: 'willpowerLevel',
  order: 'orderLevel',
  effect1: 'effect1Level',
  effect2: 'effect2Level',
};

/** A gem's grade (0-100+, 1 decimal) and letter rank on one axis. */
export interface GradeRead {
  grade: number;
  rank: GemRank;
}

/** One possible landing of an Effect Changed outcome. */
export interface EffectLanding extends GradeRead {
  effect: string;
  /** Grade change from the gem now. */
  delta: number;
}

/** One outcome's preview, relative to the gem's grade now. */
export type OutcomePreview =
  /** Nothing to preview: an unset (do-nothing) tile, or a gem the scorer cannot grade. */
  | { kind: 'none' }
  /** A cost or reroll outcome: it changes the cut, not the gem, so the grade stays where it is. */
  | { kind: 'unchanged' }
  /** Where a raise / lower lands; delta is 0 for a line this axis does not value, or a capped level. */
  | { kind: 'grade'; grade: number; rank: GemRank; delta: number }
  /** Effect Changed: one landing per candidate effect at even odds, lowest grade first. */
  | { kind: 'split'; landings: EffectLanding[] };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Grade an advisor config on a role's axis, or null when an effect name is outside the model, so the
 * caller renders nothing rather than NaN.
 */
export function gradeConfig(config: AdvisorConfig, role: GemRole): GradeRead | null {
  const option1 = EFFECT_NAME_TO_KEY[config.effect1];
  const option2 = EFFECT_NAME_TO_KEY[config.effect2];
  if (!option1 || !option2) return null;
  const g = grade(
    {
      req: config.baseCost - config.willpowerLevel, // willpower COST = base cost - level
      point: config.orderLevel,
      option1: { optionType: option1, value: config.effect1Level },
      option2: { optionType: option2, value: config.effect2Level },
    },
    role
  );
  return { grade: g, rank: rankFromGrade(g, role) };
}

/** The pool effects a gem does not already carry: what an Effect Changed outcome can roll into. */
export function effectChangeCandidates(config: AdvisorConfig): string[] {
  return (EFFECT_POOLS[config.baseCost] ?? []).filter(
    (e) => e !== config.effect1 && e !== config.effect2
  );
}

/**
 * The config after an outcome lands (the vendored nested.js applyOutcome). Raises cap at 5 and lowers
 * floor at 1; an Effect Changed swaps in `newEffect` (only a legal candidate) and keeps the replaced
 * line's level; cost, reroll and do-nothing outcomes leave the gem itself untouched.
 */
export function applyOutcomeToConfig(
  config: AdvisorConfig,
  outcome: AdvisorOutcome,
  newEffect?: string
): AdvisorConfig {
  const c = { ...config };
  const amount = outcome.amount || 1;
  const field = LEVEL_FIELD[outcome.target ?? ''];
  if (outcome.type === 'raise_effect' && field) c[field] = Math.min(5, c[field] + amount);
  else if (outcome.type === 'lower_effect' && field) c[field] = Math.max(1, c[field] - amount);
  else if (
    outcome.type === 'change_side_option' &&
    newEffect &&
    effectChangeCandidates(config).includes(newEffect)
  ) {
    // Same slot reading as the DP's outcomeBranchesActual: anything but effect2 means effect1.
    if (outcome.target === 'effect2') c.effect2 = newEffect;
    else c.effect1 = newEffect;
  }
  return c;
}

/** Preview one outcome tile: where the gem's grade lands if this outcome is the one applied. */
export function previewOutcome(
  config: AdvisorConfig,
  outcome: AdvisorOutcome,
  role: GemRole
): OutcomePreview {
  const now = gradeConfig(config, role);
  if (!now) return { kind: 'none' };
  switch (outcome.type) {
    case 'raise_effect':
    case 'lower_effect': {
      const next = gradeConfig(applyOutcomeToConfig(config, outcome), role);
      return next
        ? { kind: 'grade', ...next, delta: round1(next.grade - now.grade) }
        : { kind: 'none' };
    }
    case 'change_side_option': {
      const landings = effectChangeCandidates(config)
        .flatMap((effect) => {
          const next = gradeConfig(applyOutcomeToConfig(config, outcome, effect), role);
          return next ? [{ effect, ...next, delta: round1(next.grade - now.grade) }] : [];
        })
        .sort((a, b) => a.grade - b.grade);
      return landings.length ? { kind: 'split', landings } : { kind: 'none' };
    }
    case 'change_gold_cost':
    case 'reroll_increase':
      return { kind: 'unchanged' };
    default:
      return { kind: 'none' };
  }
}
