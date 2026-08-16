// Gem scoring in REAL % DAMAGE (log space). Each gem line is scored as
//   D = 100 · ln(multiplier)   ≈ % damage gain, additive in log space.
// The grade (0-100+, letter rank) is shizukaziye's 2026-08-10 roster-bound model: willpower enters as
// an ADDITIVE fitted credit per effective cost (K tables fitted on ~117k DPS / ~107k support simulated
// roster-bound accounts against an exact grid packer), the scale is anchored so the worst legal gem is
// 0 and the MEAN of the perfect Ark Grid layout (3 c8 + 3 c9 + 6 c10) is 100 (open above: perfect
// c8/c9/c10 grade 96.1/99.7/102.1 DPS, 94.6/98.2/103.6 support), and the letter ladder is even thirds
// of 10-point bands with S+ pinned at each axis's perfect c8. This re-implements the model published
// by shizukaziye (loastuff/loa-astrogem-calc, model/astrogem.js + docs/how-a-gem-is-graded.md); the
// per-line D values are derived in code from documented stat baselines so the assumptions stay
// editable. Re-implemented from the methodology, not copied; src/lib/advisor/advisorDp.test.ts is the
// drift guard that pins it to the vendored astrogem.js grade for grade.
//
// Type-only import keeps this module runnable under node (the support-table generator
// imports it; arkGridGems.ts itself uses Vite-only import.meta.glob).
import {
  type ArkGridGemOptionName,
  ArkGridGemOptionTypes,
  ArkGridGemSpecs,
} from '../models/arkGridGemSpecs';
import type { ArkGridGem } from '../models/arkGridGems';

export type GemRole = 'dps' | 'support';
/** Letter rank, e.g. 'S+', 'A-', 'B', 'F-'. */
export type GemRank = string;

// ---- Per-line D constants (% damage), derived from documented stat baselines ----
// MARGINAL D of one more level on top of a full lvl-30 grid — the standalone yardstick each gem is
// rated against (a single gem can't see the rest of the grid). Matches shizukaziye's current
// model/astrogem.js `_perLevelD`; his code is the source of truth (his METHODOLOGY.md still shows
// the older per-level *average* formula, which his code superseded — doc not yet updated).
//   per-level D = 100 · ln((base + gridAdd/levels) / base),  base = 1 + other + gridAdd
const STAT_BASELINES = {
  attackPower: { other: 0.121, gridAdd: 0.011, levels: 30 }, // 12.1% other, +1.1% over 30
  additionalDamage: { other: 0.336, gridAdd: 0.0242, levels: 30 }, // 33.6% other, +2.42% over 30
  bossDamage: { other: 0.0, gridAdd: 0.025, levels: 30 }, // 0% other, +2.5% over 30
} as const;
function perLevelD(b: { other: number; gridAdd: number; levels: number }): number {
  const base = 1 + b.other + b.gridAdd;
  return 100 * Math.log((base + b.gridAdd / b.levels) / base);
}

export const D_ATTACK = perLevelD(STAT_BASELINES.attackPower); // ≈ 0.032386
export const D_ADD = perLevelD(STAT_BASELINES.additionalDamage); // ≈ 0.059287
export const D_BOSS = perLevelD(STAT_BASELINES.bossDamage); // ≈ 0.081268
export const D_ORDER = 100 * Math.log(1.0016); // ≈ 0.159872, FLAT per point
export const WILLPOWER_OVER_ATTACK_RATIO = 2.4; // kept from the prior model
export const D_WILLPOWER = WILLPOWER_OVER_ATTACK_RATIO * D_ATTACK; // ≈ 0.07773 per cost-level
const WILLPOWER_NEUTRAL = 4; // willpower cost 4 is the zero point

// ---- Support coefficients (PER-DPS; shizukaziye's current model) ----
// A support gem buffs all 3 party DPS, so its raw value is ~3× a single DPS gem. Under the
// multiplicative model that ×3 double-counts, so every party-buff coefficient is stored ÷3 (the
// per-DPS efficiency). The ×3 party benefit is reapplied ONLY at the gold step — which for us lives
// in the baked cut-plan (pipeline-support.json), so no ×3 belongs here. Willpower is a per-DPS ratio
// (not a party buff), so it is NOT divided — just the 2/3 factor.
export const SUPPORT_ORDER_D = 0.0769 / 3; // support order, flat per point (party buff ÷3 = 0.0256)
export const SUPPORT_WILLPOWER_FACTOR = 2 / 3; // support willpower = (2/3) × the DPS willpower term

export const DPS_EFFECT_D: Record<ArkGridGemOptionName, number> = {
  AtkPower: D_ATTACK,
  AddDamage: D_ADD,
  BossDamage: D_BOSS,
  BrandPower: 0,
  AllyAttackEnh: 0,
  AllyDamageEnh: 0,
};
// Re-derived 2026-08 against the corrected support-buff model (his accessory calculator, METHODOLOGY §3).
export const SUPPORT_EFFECT_D: Record<ArkGridGemOptionName, number> = {
  AllyAttackEnh: 0.0586 / 3, // party attack buff ÷3 (per-DPS)
  BrandPower: 0.0437 / 3, // brand amp ÷3
  AllyDamageEnh: 0.0214 / 3, // party damage buff ÷3
  AtkPower: 0,
  AddDamage: 0,
  BossDamage: 0,
};

// Side-effect pools per base cost (8/9/10), derived from the canonical gem specs.
const EFFECT_POOLS: Record<number, ArkGridGemOptionName[]> = (() => {
  const pools: Record<number, ArkGridGemOptionName[]> = {};
  for (const spec of Object.values(ArkGridGemSpecs)) pools[spec.req] = [...spec.availableOptions];
  return pools;
})();

/** Minimal shape the scorer reads from a gem (req = willpower cost, point = order level). */
type ScoredGem = Pick<ArkGridGem, 'req' | 'point' | 'option1' | 'option2'>;

function effectD(role: GemRole, type: ArkGridGemOptionName): number {
  return (role === 'support' ? SUPPORT_EFFECT_D : DPS_EFFECT_D)[type];
}
function orderPerPoint(role: GemRole): number {
  return role === 'support' ? SUPPORT_ORDER_D : D_ORDER;
}

/**
 * Willpower score in % damage. `req` IS the willpower cost (baseCost − willpowerLevel);
 * cost 4 is neutral (0), lower costs are worth more, higher cost less. Support scales by 2/3.
 */
export function willpowerScore(req: number, role: GemRole = 'dps'): number {
  const factor = role === 'support' ? SUPPORT_WILLPOWER_FACTOR : 1;
  if (req < WILLPOWER_NEUTRAL) return (WILLPOWER_NEUTRAL - req) * D_WILLPOWER * factor;
  if (req > WILLPOWER_NEUTRAL) return (req - WILLPOWER_NEUTRAL) * -D_WILLPOWER * factor;
  return 0;
}

// Gem damage = effects + order (NO willpower) — the gem's actual % damage line sum.
function gemDamage(gem: ScoredGem, role: GemRole): number {
  return (
    effectD(role, gem.option1.optionType) * gem.option1.value +
    effectD(role, gem.option2.optionType) * gem.option2.value +
    gem.point * orderPerPoint(role)
  );
}

// ---- Willpower as an ADDITIVE fitted credit (the grading model) ----
// K[effective cost] is the packer's revealed price of willpower budget on the roster-bound world:
// costs 3 and 4 earn a bonus, 5 is neutral, 6-9 are taxed harder and harder (a cost-9 gem is essentially
// never socketed, so its price is an upper bound). Support's table is ~5x smaller only because support
// effect lines are ~5x smaller; the shape is the same. Non-integer costs interpolate (baseline math).
const DPS_WP_CREDIT: Record<number, number> = {
  3: 0.1327,
  4: 0.0896,
  5: 0,
  6: -0.1203,
  7: -0.2504,
  8: -0.397,
  9: -0.5686,
};
const SUPPORT_WP_CREDIT: Record<number, number> = {
  3: 0.0252,
  4: 0.015,
  5: 0,
  6: -0.0235,
  7: -0.0593,
  8: -0.0986,
  9: -0.1346,
};
/** Support's fitted order weight for the GRADING value (its damage weight is SUPPORT_ORDER_D). */
export const SUPPORT_VALUE_ORDER_D = 0.02879;
/** DPS order is pinned at its exact damage weight and centered at level 4 (4 adds nothing). */
const ORDER_VALUE_NEUTRAL = 4;

function willpowerCredit(role: GemRole, cost: number): number {
  const K = role === 'support' ? SUPPORT_WP_CREDIT : DPS_WP_CREDIT;
  if (cost <= 3) return K[3];
  if (cost >= 9) return K[9];
  if (K[cost] != null) return K[cost];
  const lo = Math.floor(cost); // non-integer (e.g. 4.25 neutral): interpolate
  return K[lo] + (K[lo + 1] - K[lo]) * (cost - lo);
}

/** Grading value = effects + order (DPS centered at 4; support at its fitted weight) + willpower credit. */
function gemValue(gem: ScoredGem, role: GemRole): number {
  const effects =
    effectD(role, gem.option1.optionType) * gem.option1.value +
    effectD(role, gem.option2.optionType) * gem.option2.value;
  const order =
    role === 'support'
      ? SUPPORT_VALUE_ORDER_D * gem.point
      : D_ORDER * (gem.point - ORDER_VALUE_NEUTRAL);
  return effects + order + willpowerCredit(role, gem.req);
}

/** The perfect gem of a base cost for a role: its top-2 effects at 5, order 5, willpower 5. */
function perfectGem(role: GemRole, baseCost: number): ScoredGem {
  const top = [...EFFECT_POOLS[baseCost]].sort((a, b) => effectD(role, b) - effectD(role, a));
  return {
    req: baseCost - 5,
    point: 5,
    option1: { optionType: top[0], value: 5 },
    option2: { optionType: top[1], value: 5 },
  };
}

// The grade scale per role: 0 = the worst legal gem, 100 = the mean value of the perfect Ark Grid
// layout (3 perfect c8 + 3 perfect c9 + 6 perfect c10, the wp5 5+5+4+3 = 17 packing per core).
const _scale: Partial<Record<GemRole, { min: number; anchor: number }>> = {};
function valueScale(role: GemRole): { min: number; anchor: number } {
  const cached = _scale[role];
  if (cached) return cached;
  let min = Infinity;
  for (const baseCost of [8, 9, 10]) {
    const pool = EFFECT_POOLS[baseCost];
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++)
        for (let wpLevel = 1; wpLevel <= 5; wpLevel++) {
          const req = baseCost - wpLevel;
          for (let point = 1; point <= 5; point++)
            for (let a = 1; a <= 5; a++)
              for (let b = 1; b <= 5; b++) {
                const v = gemValue(
                  {
                    req,
                    point,
                    option1: { optionType: pool[i], value: a },
                    option2: { optionType: pool[j], value: b },
                  },
                  role
                );
                if (v < min) min = v;
              }
        }
  }
  const anchor =
    (3 * gemValue(perfectGem(role, 8), role) +
      3 * gemValue(perfectGem(role, 9), role) +
      6 * gemValue(perfectGem(role, 10), role)) /
    12;
  const scale = { min, anchor };
  _scale[role] = scale;
  return scale;
}

/**
 * Grade (rounded to 1 decimal): 0 = worst possible gem, 100 = the perfect-grid mean; open above 100
 * (a perfect c10 reads 102.1 DPS / 103.6 support), clamped at 110 like the reference model.
 */
export function grade(gem: ScoredGem, role: GemRole): number {
  const { min, anchor } = valueScale(role);
  const g = (100 * (gemValue(gem, role) - min)) / (anchor - min);
  return Math.round(Math.max(0, Math.min(110, g)) * 10) / 10;
}

// ---- Letter ladder (shizukaziye 2026-08-10, percentile-aware bands) ----
// Even thirds of each 10-point band from 50 up (D 50/53.3/56.7, C 60/…, B 70/…, A 80/83.3/86.7,
// S 90/93.3/S+), F = thirds of 0-50. The S+ cut is the AXIS'S PERFECT 8-COST grade, derived from the
// model so a refit moves it: 96.1 DPS, 94.6 support ("every perfect gem is S+ on its axis").
const _sPlusCut: Partial<Record<GemRole, number>> = {};
/** The S+ cut for a role: the grade of that role's perfect cost-8 gem. */
export function sPlusCut(role: GemRole): number {
  return (_sPlusCut[role] ??= grade(perfectGem(role, 8), role));
}
const RANK_LADDER_TAIL: [GemRank, number][] = [
  ['S', 93.3],
  ['S-', 90],
  ['A+', 86.7],
  ['A', 83.3],
  ['A-', 80],
  ['B+', 76.7],
  ['B', 73.3],
  ['B-', 70],
  ['C+', 66.7],
  ['C', 63.3],
  ['C-', 60],
  ['D+', 56.7],
  ['D', 53.3],
  ['D-', 50],
  ['F+', 33.3],
  ['F', 16.7],
  ['F-', 0],
];
/** Letter rank from a grade. The ladders differ per role only in where S+ starts. */
export function rankFromGrade(g: number, role: GemRole = 'dps'): GemRank {
  if (g >= sPlusCut(role)) return 'S+';
  for (const [letter, lo] of RANK_LADDER_TAIL) if (g >= lo) return letter;
  return 'F-';
}

// Shizukaziye's baseline rank ladder: the 12 grade anchors his exact-DP cut pipeline bakes ONE solve
// per, C- … S+ (one distinct rank each), the last one being the axis's own S+ cut. pipeline.json's
// meta.baselines is per-axis (Record<CutAxis, number[]>): meta.baselines[axis][i] is the value this
// grade anchor was baked at for that role (his gradeToScore/supportGradeToScore(rows[i])), so the
// Cutting Plan reads cell i by exact key lookup. KEEP ALIGNED with each meta.baselines[axis] array
// (same length, same order). Used as the shared triage/cut-plan baseline ladder.
const GRADE_ROWS_HEAD = [60, 63.3, 66.7, 70, 73.3, 76.7, 80, 83.3, 86.7, 90, 93.3] as const;
export function gradeRows(role: GemRole): readonly number[] {
  return [...GRADE_ROWS_HEAD, sPlusCut(role)];
}
export const BASELINE_MIN_GRADE = GRADE_ROWS_HEAD[0];
export function baselineMaxGrade(role: GemRole): number {
  return sPlusCut(role);
}

/** Nearest baseline-row index to a grade for a role (exact when on an anchor, else closest by value). */
export function gradeRowIndex(grade: number, role: GemRole): number {
  const rows = gradeRows(role);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(rows[i] - grade);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * A grade bumped ONE rank up on the baseline ladder (shizukaziye's bumpedBaselineGrade): the baseline
 * a gem must beat to be a real upgrade is one rank above the gem itself. Finds the anchor whose rank
 * matches the gem's rank (each anchor is a distinct rank), steps +1, clamped at the top (S+). An
 * off-ladder grade (rank below C-) snaps to the nearest anchor first. Returns a ladder value.
 */
export function bumpedBaselineGrade(grade: number, role: GemRole): number {
  const rows = gradeRows(role);
  const rank = rankFromGrade(grade, role);
  let idx = rows.findIndex((g) => rankFromGrade(g, role) === rank);
  if (idx < 0) idx = gradeRowIndex(grade, role);
  return rows[Math.min(idx + 1, rows.length - 1)];
}

/** The %-damage zero-point: a willpower-4.25 / order-4.25 gem with dead side effects. */
export function cpBaseline(role: GemRole): number {
  return willpowerScore(4.25, role) + 4.25 * orderPerPoint(role);
}

export interface GemScoreResult {
  /** Additive % damage (willpower + order + two effects) — the headline score. */
  score: number;
  /** Exact multiplicative % damage of the gem (effects + order, no willpower). */
  damagePercent: number;
  /** Grading value (effects + order + additive willpower credit); drives the grade. */
  gemValue: number;
  /** 0-100 grade. */
  grade: number;
  /** Letter rank (S+/S/S-/A+/…/F-). */
  rank: GemRank;
  /** Score above the cp baseline (may be negative). */
  relDamage: number;
  contributions: {
    willpower: number;
    point: number;
    option1: number;
    option2: number;
  };
}

export function computeGemScore(gem: ArkGridGem, role: GemRole): GemScoreResult {
  const willpower = willpowerScore(gem.req, role);
  const point = gem.point * orderPerPoint(role);
  const option1 = effectD(role, gem.option1.optionType) * gem.option1.value;
  const option2 = effectD(role, gem.option2.optionType) * gem.option2.value;
  const score = willpower + point + option1 + option2;
  const g = grade(gem, role);
  return {
    score,
    damagePercent: (Math.exp(gemDamage(gem, role) / 100) - 1) * 100,
    gemValue: gemValue(gem, role),
    grade: g,
    rank: rankFromGrade(g, role),
    relDamage: score - cpBaseline(role),
    contributions: { willpower, point, option1, option2 },
  };
}

export interface ScoreFactor {
  label: string;
  detail: string; // the formula, e.g. "4 × 0.0598"
  value: number;
}

/**
 * Per-factor breakdown of a gem's score under a role (drives the score tooltip).
 * The four factor values sum to computeGemScore(gem, role).score.
 */
export function explainGemScore(gem: ArkGridGem, role: GemRole): ScoreFactor[] {
  const optLabel = (t: ArkGridGemOptionName) => ArkGridGemOptionTypes[t].name.en_us;
  const round = (n: number) => Math.round(n * 1e4) / 1e4;
  const wpStep = role === 'support' ? D_WILLPOWER * SUPPORT_WILLPOWER_FACTOR : D_WILLPOWER;
  return [
    {
      label: 'Willpower',
      detail: `(${WILLPOWER_NEUTRAL} − ${gem.req}) × ${round(wpStep)}`,
      value: willpowerScore(gem.req, role),
    },
    {
      label: 'Points',
      detail: `${gem.point} × ${round(orderPerPoint(role))}`,
      value: gem.point * orderPerPoint(role),
    },
    {
      label: optLabel(gem.option1.optionType),
      detail: `${gem.option1.value} × ${round(effectD(role, gem.option1.optionType))}`,
      value: effectD(role, gem.option1.optionType) * gem.option1.value,
    },
    {
      label: optLabel(gem.option2.optionType),
      detail: `${gem.option2.value} × ${round(effectD(role, gem.option2.optionType))}`,
      value: effectD(role, gem.option2.optionType) * gem.option2.value,
    },
  ];
}
