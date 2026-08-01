// Temporal fusion for the Cut Advisor. Checks each new parse against what the game could
// legally have done since the previous committed state (the prior), pins fields the
// transition determines, and raises (never lowers) per-field confidence under the
// invariants in docs/superpowers/specs/2026-07-31-advisor-temporal-fusion-design.md.
// Pure module: no Svelte, no DOM, no Vite-isms, no vendor imports. The vendored transition
// primitive (AstrogemNested.applyOutcome) is injected by the caller, so this file imports
// cleanly under plain Node (the tsx harness) and inside the advisor worker.
import type { AdvisorConfig, AdvisorOutcome, ParsedAdvisorState } from './advisorController';

export const FLAG_BAR = 0.8;
export const LIFT_AGREE_HARD = 0.85;
export const LIFT_AGREE_SOFT = 0.7;
export const ADOPT_HARD = 0.85;
export const ADOPT_SOFT = 0.6;
/** Invariant: no tuning may push any prior-derived lift above this. */
export const LIFT_CEILING = 0.92;

export type ChainQuality = 'hard' | 'soft';
export type FusionStatus = 'none' | 'seeded' | 'fused' | 'desync';
export type ApplyOutcomeFn = (config: AdvisorConfig, outcome: AdvisorOutcome) => AdvisorConfig;

export interface FusionPrior {
  config: AdvisorConfig;
  state: ParsedAdvisorState['state'];
  outcomes: AdvisorOutcome[];
  quality: {
    config: Record<string, ChainQuality>;
    state: Record<string, ChainQuality>;
    outcomes: ChainQuality[];
  };
}

interface ConfMaps {
  config?: Record<string, number>;
  state?: Record<string, number>;
  outcomes?: (number | null)[];
}

export function confMapsOf(p: ParsedAdvisorState): ConfMaps {
  return (p.confidence ?? {}) as ConfMaps;
}

/** Absent confidence = 1.0 (constraintSnap's manual-entry semantics), hence hard. */
export function qualityOf(conf: number | null | undefined): ChainQuality {
  return (conf ?? 1) >= FLAG_BAR ? 'hard' : 'soft';
}

export function minQ(...qs: ChainQuality[]): ChainQuality {
  return qs.includes('soft') ? 'soft' : 'hard';
}

export function seedFromParse(p: ParsedAdvisorState): FusionPrior {
  const cf = confMapsOf(p);
  const cq: Record<string, ChainQuality> = {};
  for (const k of Object.keys(p.config)) cq[k] = qualityOf(cf.config?.[k]);
  const sq: Record<string, ChainQuality> = {};
  for (const k of Object.keys(p.state)) sq[k] = qualityOf(cf.state?.[k]);
  return {
    config: { ...p.config },
    state: { ...p.state },
    outcomes: p.outcomes.map((o) => ({ ...o })),
    quality: { config: cq, state: sq, outcomes: p.outcomes.map((_, i) => qualityOf(cf.outcomes?.[i])) },
  };
}
