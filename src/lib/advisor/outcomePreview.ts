// Per-outcome grade previews for the Cut Advisor: what the gem would grade if ONE of the four possible
// outcomes on the Processing window landed, next to what it grades now, and where it stands against
// the baseline. Re-implements the preview in shizukaziye's advisor-window.js (previewGrade /
// oscoreHtml) on our own gemScore.ts, which advisorDp.test.ts pins to the vendored astrogem.js grade
// for grade. An outcome is evaluated exactly as the advice evaluates it: snapped like the vendored
// constraintSnap, then applied like the vendored nested.js applyOutcome; outcomePreview.test.ts pins
// both against the vendored files. Pure: no Svelte, no worker, so the window can recompute it on
// every click.
//
// Two deliberate divergences from upstream's display: an Effect Changed outcome shows the grade each
// possible new effect lands on (the vendored DP resolves it as an even split over the pool effects the
// gem does not already carry, and the new effect keeps the replaced line's level), where upstream shows
// "?"; and a cost or reroll outcome reads "no change" rather than repeating the current grade.
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

// The four lines an outcome can raise or lower (the vendored OUTCOME_TARGETS), and the level each sets.
const OUTCOME_TARGETS = ['willpower', 'order', 'effect1', 'effect2'] as const;
type OutcomeTarget = (typeof OUTCOME_TARGETS)[number];
const LEVEL_FIELD: Record<
  OutcomeTarget,
  'willpowerLevel' | 'orderLevel' | 'effect1Level' | 'effect2Level'
> = {
  willpower: 'willpowerLevel',
  order: 'orderLevel',
  effect1: 'effect1Level',
  effect2: 'effect2Level',
};
const isTarget = (t: string | undefined): t is OutcomeTarget =>
  (OUTCOME_TARGETS as readonly (string | undefined)[]).includes(t);

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
 * The outcome as the advice reads it. The worker runs every state through the vendored constraintSnap
 * before the DP, and its snapOutcome makes a lower exactly -1 (the game has no bigger lower), a raise
 * +1..+4 on a known line (anything else is willpower), and an Effect Changed name effect1 unless it
 * says effect2. Cost, reroll and do-nothing outcomes pass through; none of them touches the gem.
 */
export function snapOutcome(outcome: AdvisorOutcome): AdvisorOutcome {
  if (outcome.type === 'raise_effect' || outcome.type === 'lower_effect') {
    const target = isTarget(outcome.target) ? outcome.target : 'willpower';
    const asked = Number.parseInt(String(outcome.amount), 10);
    const amount =
      outcome.type === 'lower_effect' ? 1 : Math.max(1, Math.min(4, Number.isNaN(asked) ? 1 : asked));
    return { type: outcome.type, target, amount };
  }
  if (outcome.type === 'change_side_option')
    return { type: outcome.type, target: outcome.target === 'effect2' ? 'effect2' : 'effect1' };
  return outcome;
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
  const field = isTarget(outcome.target) ? LEVEL_FIELD[outcome.target] : null;
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
  const o = snapOutcome(outcome);
  switch (o.type) {
    case 'raise_effect':
    case 'lower_effect': {
      const next = gradeConfig(applyOutcomeToConfig(config, o), role);
      return next
        ? { kind: 'grade', ...next, delta: round1(next.grade - now.grade) }
        : { kind: 'none' };
    }
    case 'change_side_option': {
      const landings = effectChangeCandidates(config)
        .flatMap((effect) => {
          const next = gradeConfig(applyOutcomeToConfig(config, o, effect), role);
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

// ---- display: the wording under each tile and in the advice panel ------------------------------

/** A landing against the gem now: green up, red down, grey no change. */
export type GradeDir = 'up' | 'down' | 'same';

/** What one outcome tile shows, plus the sentence its hover and screen readers get. */
export type TilePreview =
  | { kind: 'grade'; rank: GemRank; grade: string; dir: GradeDir; label: string }
  | { kind: 'split'; values: { grade: string; dir: GradeDir }[]; label: string }
  | { kind: 'unchanged'; label: string };

const dirOf = (delta: number): GradeDir => (delta > 0 ? 'up' : delta < 0 ? 'down' : 'same');
const change = (delta: number) =>
  delta > 0 ? `up ${delta.toFixed(1)}` : delta < 0 ? `down ${(-delta).toFixed(1)}` : 'no change';
const shown = (g: GradeRead) => `${g.grade.toFixed(1)} (${g.rank})`;

/**
 * The preview under one outcome tile, or null when there is nothing to show. A raise that changes
 * nothing says why: the line is already at its limit, or this axis does not value it (the game still
 * shows a green arrow for it). An Effect Changed whose two landings agree reads as one grade.
 */
export function tilePreview(
  config: AdvisorConfig,
  outcome: AdvisorOutcome,
  role: GemRole
): TilePreview | null {
  const now = gradeConfig(config, role);
  if (!now) return null;
  const pv = previewOutcome(config, outcome, role);
  switch (pv.kind) {
    case 'grade': {
      const o = snapOutcome(outcome); // a grade preview is always a raise / lower on a known line
      const level = isTarget(o.target) ? config[LEVEL_FIELD[o.target]] : 0;
      const atLimit =
        (o.type === 'raise_effect' && level >= 5) || (o.type === 'lower_effect' && level <= 1);
      const why = atLimit
        ? 'that line is already at its limit'
        : `that line does not count for ${role === 'support' ? 'Support' : 'DPS'}`;
      const label =
        pv.delta !== 0
          ? `If this lands: ${shown(pv)}, ${change(pv.delta)} from ${shown(now)}.`
          : `No change: the gem stays ${shown(now)}, ${why}.`;
      return { kind: 'grade', rank: pv.rank, grade: pv.grade.toFixed(1), dir: dirOf(pv.delta), label };
    }
    case 'split': {
      const first = pv.landings[0];
      if (pv.landings.every((l) => l.grade === first.grade))
        return {
          kind: 'grade',
          rank: first.rank,
          grade: first.grade.toFixed(1),
          dir: dirOf(first.delta),
          label: `The new effect is random, and either one (${pv.landings.map((l) => l.effect).join(' or ')}) lands ${shown(first)}: ${change(first.delta)} from ${shown(now)}.`,
        };
      const each = pv.landings.map((l) => `${l.effect} lands ${l.grade.toFixed(1)} (${l.rank}, ${change(l.delta)})`);
      return {
        kind: 'split',
        values: pv.landings.map((l) => ({ grade: l.grade.toFixed(1), dir: dirOf(l.delta) })),
        label: `The new effect is random (even odds): ${each.join('; ')}. Now ${shown(now)}.`,
      };
    }
    case 'unchanged':
      return {
        kind: 'unchanged',
        label: `${outcome.type === 'change_gold_cost' ? 'Changes the processing cost' : 'Adds rerolls'}, not the gem: it stays ${shown(now)}.`,
      };
    default:
      return null;
  }
}

/** Where a gem stands against the baseline the advice weighs. */
export interface Standing {
  now: GradeRead;
  baseline: GradeRead;
  /** Grade now minus the baseline, 1 decimal. */
  gap: number;
  dir: GradeDir;
  text: string;
}

/**
 * The gem's grade against the baseline grade, on the advice's axis. Above / below here agree with the
 * DP's "above baseline" odds, which compare the same linear value the grade is drawn from; only an
 * exact tie reads "at baseline", which the DP does not count as above.
 */
export function standingAgainst(
  config: AdvisorConfig,
  baselineGrade: number,
  role: GemRole
): Standing | null {
  const now = gradeConfig(config, role);
  if (!now) return null;
  const gap = round1(now.grade - baselineGrade);
  return {
    now,
    baseline: { grade: baselineGrade, rank: rankFromGrade(baselineGrade, role) },
    gap,
    dir: dirOf(gap),
    text:
      gap > 0
        ? `${gap.toFixed(1)} above baseline`
        : gap < 0
          ? `${(-gap).toFixed(1)} below baseline`
          : 'at baseline',
  };
}
