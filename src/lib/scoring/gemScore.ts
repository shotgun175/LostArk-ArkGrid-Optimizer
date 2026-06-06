import {
  type ArkGridGem,
  type ArkGridGemOptionName,
  ArkGridGemOptionTypes,
} from '../models/arkGridGems';

export type GemRole = 'dps' | 'support';
export type GemTier = 'Excellent' | 'Very Good' | 'Good for now' | 'Priority to Replace';

// Offset-from-neutral-4 model (Phase 2 spec §2 / Phase 1 Appendix A).
export const WILLPOWER_NEUTRAL = 4;
export const WILLPOWER_STEP = 2.4; // (4 - req) * 2.40
export const POINT_NEUTRAL = 4;
export const POINT_STEP = 5.14; // (point - 4) * 5.14

export const DPS_NODE_COEFF: Record<ArkGridGemOptionName, number> = {
  BossDamage: 2.55,
  AddDamage: 1.85,
  AtkPower: 1.0,
  BrandPower: 0,
  AllyAttackEnh: 0,
  AllyDamageEnh: 0,
};

export const SUPPORT_NODE_COEFF: Record<ArkGridGemOptionName, number> = {
  AllyAttackEnh: 1.95,
  BrandPower: 1.36,
  AllyDamageEnh: 0.76,
  AtkPower: 0,
  BossDamage: 0,
  AddDamage: 0,
};

export interface GemScoreResult {
  score: number;
  tier: GemTier;
  contributions: {
    willpower: number;
    point: number;
    option1: number;
    option2: number;
  };
}

export function tierForScore(score: number): GemTier {
  if (score >= 15) return 'Excellent';
  if (score >= 10) return 'Very Good';
  if (score >= 5) return 'Good for now';
  return 'Priority to Replace';
}

export function computeGemScore(gem: ArkGridGem, role: GemRole): GemScoreResult {
  const coeff = role === 'support' ? SUPPORT_NODE_COEFF : DPS_NODE_COEFF;
  const willpower = (WILLPOWER_NEUTRAL - gem.req) * WILLPOWER_STEP;
  const point = (gem.point - POINT_NEUTRAL) * POINT_STEP;
  const option1 = coeff[gem.option1.optionType] * gem.option1.value;
  const option2 = coeff[gem.option2.optionType] * gem.option2.value;
  const score = willpower + point + option1 + option2;
  return {
    score,
    tier: tierForScore(score),
    contributions: { willpower, point, option1, option2 },
  };
}

export interface ScoreFactor {
  label: string;
  detail: string; // the formula, e.g. "(4 − 5) × 2.4"
  value: number;
}

/**
 * Per-factor breakdown of a gem's score under a role (drives the score tooltip).
 * The four factor values sum to computeGemScore(gem, role).score.
 */
export function explainGemScore(gem: ArkGridGem, role: GemRole): ScoreFactor[] {
  const coeff = role === 'support' ? SUPPORT_NODE_COEFF : DPS_NODE_COEFF;
  const optLabel = (t: ArkGridGemOptionName) => ArkGridGemOptionTypes[t].name.en_us;
  return [
    {
      label: 'Willpower',
      detail: `(${WILLPOWER_NEUTRAL} − ${gem.req}) × ${WILLPOWER_STEP}`,
      value: (WILLPOWER_NEUTRAL - gem.req) * WILLPOWER_STEP,
    },
    {
      label: 'Points',
      detail: `(${gem.point} − ${POINT_NEUTRAL}) × ${POINT_STEP}`,
      value: (gem.point - POINT_NEUTRAL) * POINT_STEP,
    },
    {
      label: optLabel(gem.option1.optionType),
      detail: `${gem.option1.value} × ${coeff[gem.option1.optionType]}`,
      value: coeff[gem.option1.optionType] * gem.option1.value,
    },
    {
      label: optLabel(gem.option2.optionType),
      detail: `${gem.option2.value} × ${coeff[gem.option2.optionType]}`,
      value: coeff[gem.option2.optionType] * gem.option2.value,
    },
  ];
}
