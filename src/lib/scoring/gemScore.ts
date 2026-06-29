// Gem scoring in REAL % DAMAGE (log space). Each gem line is scored as
//   D = 100 · ln(multiplier)   ≈ % damage gain, additive in log space.
// The grade (0-100 + S/A/B letter rank) folds willpower in MULTIPLICATIVELY so every
// base cost's perfect gem ties at 100. This re-implements the model published by
// shizukaziye (astrogem-calculator, model/astrogem.js + METHODOLOGY.md); the per-line
// D values are derived in code from documented stat baselines so the assumptions stay
// editable. Re-implemented from the methodology, not copied.
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
export const SUPPORT_ORDER_D = 0.0747 / 3; // support order, flat per point (party buff ÷3 = 0.0249)
export const SUPPORT_WILLPOWER_FACTOR = 2 / 3; // support willpower = (2/3) × the DPS willpower term

export const DPS_EFFECT_D: Record<ArkGridGemOptionName, number> = {
  AtkPower: D_ATTACK,
  AddDamage: D_ADD,
  BossDamage: D_BOSS,
  BrandPower: 0,
  AllyAttackEnh: 0,
  AllyDamageEnh: 0,
};
export const SUPPORT_EFFECT_D: Record<ArkGridGemOptionName, number> = {
  AllyAttackEnh: 0.0596 / 3, // party attack buff ÷3 (per-DPS)
  BrandPower: 0.0434 / 3, // brand amp ÷3
  AllyDamageEnh: 0.0195 / 3, // party damage buff ÷3
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

// ---- Willpower as a MULTIPLIER on damage (the grading model) ----
// M(cost) is calibrated so each base cost's PERFECT gem (top-2 effects @5, order 5, the
// best willpower cost) ties at the top; cost 6+ continues linearly at the cost-4→5 slope.
function perfectDamage(role: GemRole, baseCost: number): number {
  const ranked = EFFECT_POOLS[baseCost].map((t) => effectD(role, t) * 5).sort((a, b) => b - a);
  return ranked[0] + ranked[1] + 5 * orderPerPoint(role);
}
function buildWpMult(role: GemRole): Record<number, number> {
  const M: Record<number, number> = {
    3: perfectDamage(role, 10) / perfectDamage(role, 8),
    4: perfectDamage(role, 10) / perfectDamage(role, 9),
    5: 1,
  };
  const slope = M[4] - M[5];
  for (let c = 6; c <= 9; c++) M[c] = 1 - slope * (c - 5);
  return M;
}
const WP_MULT: Record<GemRole, Record<number, number>> = {
  dps: buildWpMult('dps'),
  support: buildWpMult('support'),
};
function willpowerMultiplier(role: GemRole, cost: number): number {
  const M = WP_MULT[role];
  if (cost <= 3) return M[3];
  if (cost >= 9) return M[9];
  if (M[cost] != null) return M[cost];
  const lo = Math.floor(cost); // non-integer (e.g. 4.25 neutral): interpolate
  return M[lo] + (M[lo + 1] - M[lo]) * (cost - lo);
}

/** Grading value = gem damage × willpower multiplier (every perfect gem ties at the top). */
function gemValue(gem: ScoredGem, role: GemRole): number {
  return gemDamage(gem, role) * willpowerMultiplier(role, gem.req);
}

// Global min/max gemValue over the whole gem space (per role), for the 0-100 grade.
const _valueBounds: Partial<Record<GemRole, { min: number; max: number }>> = {};
function valueBounds(role: GemRole): { min: number; max: number } {
  const cached = _valueBounds[role];
  if (cached) return cached;
  let min = Infinity;
  let max = -Infinity;
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
                if (v > max) max = v;
              }
        }
  }
  const bounds = { min, max };
  _valueBounds[role] = bounds;
  return bounds;
}

// Highest achievable additive score (% damage) for a role — bounds the baseline UI so the
// slider can't run far past where any real gem could land (DPS ≈ 1.42%, support ≈ 0.28% per-DPS).
const _scoreMax: Partial<Record<GemRole, number>> = {};
export function maxScoreForRole(role: GemRole): number {
  const cached = _scoreMax[role];
  if (cached != null) return cached;
  let max = -Infinity;
  for (const baseCost of [8, 9, 10]) {
    const pool = EFFECT_POOLS[baseCost];
    for (let i = 0; i < pool.length; i++)
      for (let j = i + 1; j < pool.length; j++)
        for (let wpLevel = 1; wpLevel <= 5; wpLevel++) {
          const req = baseCost - wpLevel;
          for (let point = 1; point <= 5; point++)
            for (let a = 1; a <= 5; a++)
              for (let b = 1; b <= 5; b++) {
                const s =
                  willpowerScore(req, role) +
                  point * orderPerPoint(role) +
                  effectD(role, pool[i]) * a +
                  effectD(role, pool[j]) * b;
                if (s > max) max = s;
              }
        }
  }
  _scoreMax[role] = max;
  return max;
}

/** 0-100 grade (rounded to 1 decimal): 0 = worst possible gem, 100 = a perfect gem. */
export function grade(gem: ScoredGem, role: GemRole): number {
  const b = valueBounds(role);
  const g = (100 * (gemValue(gem, role) - b.min)) / (b.max - b.min);
  return Math.round(Math.max(0, Math.min(100, g)) * 10) / 10;
}

// Cutoffs synced to shizukaziye's recalibrated multiplicative grade (astrogem-calculator,
// model/astrogem.js): S85 / A70 / B55 / C40 / D20 / F0.
const RANK_CUTS: [string, number][] = [
  ['S', 85],
  ['A', 70],
  ['B', 55],
  ['C', 40],
  ['D', 20],
  ['F', 0],
];
/** Letter rank from a 0-100 grade; each band split into −/·/+ thirds for finer granularity. */
export function rankFromGrade(g: number): GemRank {
  for (let i = 0; i < RANK_CUTS.length; i++) {
    const [letter, lo] = RANK_CUTS[i];
    if (g >= lo) {
      const hi = i === 0 ? 100 : RANK_CUTS[i - 1][1];
      const t = hi > lo ? (g - lo) / (hi - lo) : 0;
      return letter + (t >= 2 / 3 ? '+' : t < 1 / 3 ? '-' : '');
    }
  }
  return 'F-';
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
  /** Grading value (damage × willpower multiplier); drives the grade. */
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
    rank: rankFromGrade(g),
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
