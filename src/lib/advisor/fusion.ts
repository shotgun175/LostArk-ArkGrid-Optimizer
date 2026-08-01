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

export interface Successor {
  tileIndex: number;
  config: AdvisorConfig;
  /** Only the state fields this transition determines. Untouched fields mean "same as prior". */
  state: Partial<Record<'rerollsRemaining' | 'processCostMultiplier' | 'processCost', number>>;
  /** change_side_option: this slot's NAME is a fresh pixel read (random draw); its level is pinned. */
  nameChangeSlot?: 'effect1' | 'effect2';
  tileQuality: ChainQuality;
}

const clampCm = (v: number) => Math.max(-100, Math.min(100, v));
/** Display cost from the multiplier (base 900: -100 reads 0, 0 reads 900, +100 reads 1800). */
export const costFromCm = (cm: number) => Math.max(0, Math.round(900 * (1 + cm / 100)));

export function buildSuccessors(prior: FusionPrior, applyOutcome: ApplyOutcomeFn): Successor[] {
  return prior.outcomes.map((tile, i) => {
    const s: Successor = {
      tileIndex: i,
      config: { ...prior.config },
      state: {},
      tileQuality: prior.quality.outcomes[i] ?? 'soft',
    };
    if (tile.type === 'raise_effect' || tile.type === 'lower_effect') {
      s.config = applyOutcome(prior.config, tile);
    } else if (tile.type === 'change_side_option') {
      s.nameChangeSlot = tile.target === 'effect2' ? 'effect2' : 'effect1';
      // applyOutcome draws a RANDOM new name for this tile type, so it is deliberately not
      // called here; the name stays a pixel read and the levels stay pinned to the prior
      // (the swapped-in effect keeps the replaced effect's level).
    } else if (tile.type === 'change_gold_cost') {
      const cm = clampCm((prior.state.processCostMultiplier ?? 0) + (tile.change ?? 0));
      s.state = { processCostMultiplier: cm, processCost: costFromCm(cm) };
    } else if (tile.type === 'reroll_increase') {
      s.state = { rerollsRemaining: (prior.state.rerollsRemaining ?? 0) + (tile.change ?? 1) };
    }
    // do_nothing: config and state carry over unchanged.
    return s;
  });
}

export const CONFIG_FIELDS: (keyof AdvisorConfig)[] = [
  'baseCost', 'gemType', 'willpowerLevel', 'orderLevel',
  'effect1', 'effect1Level', 'effect2', 'effect2Level',
];

export type Inferred =
  | { kind: 'still'; turnQuality: ChainQuality }
  | { kind: 'process'; successors: Successor[]; turnQuality: ChainQuality }
  | { kind: 'desync'; reason: string };

/** True when a confidently-read field of the parse rules this successor out. */
export function contradicts(s: Successor, prior: FusionPrior, snapped: ParsedAdvisorState): boolean {
  const cf = confMapsOf(snapped);
  for (const f of CONFIG_FIELDS) {
    if ((cf.config?.[f] ?? 1) < FLAG_BAR) continue;
    const parsed = snapped.config[f];
    if (s.nameChangeSlot === f) {
      // The game always swaps to a DIFFERENT effect: reading the prior's name confidently
      // means this change tile did not apply.
      if (parsed === prior.config[f]) return true;
      continue; // any other confident name is compatible (the draw is random)
    }
    if (parsed !== s.config[f]) return true;
  }
  for (const f of ['processCostMultiplier', 'processCost'] as const) {
    const expected = s.state[f] ?? (prior.state[f] as number | undefined);
    if (expected == null) continue;
    if ((cf.state?.[f] ?? 1) >= FLAG_BAR && snapped.state[f] !== expected) return true;
  }
  // rerollsRemaining deliberately never contradicts: a Charge purchase changes it legally
  // between frames without any tile explaining it.
  return false;
}

export function inferAction(
  prior: FusionPrior,
  snapped: ParsedAdvisorState,
  applyOutcome: ApplyOutcomeFn
): Inferred {
  const cf = confMapsOf(snapped);
  for (const f of ['gemType', 'baseCost'] as const) {
    if (snapped.config[f] !== prior.config[f] && (cf.config?.[f] ?? 1) >= FLAG_BAR)
      return { kind: 'desync', reason: `identity: ${f} changed` };
  }
  const turnQuality = qualityOf(cf.state?.currentTurn);
  const successors = buildSuccessors(prior, applyOutcome);

  const nameDesyncAtStill = (): Inferred | null => {
    for (const f of ['effect1', 'effect2'] as const) {
      if (snapped.config[f] !== prior.config[f] && (cf.config?.[f] ?? 1) >= FLAG_BAR)
        return { kind: 'desync', reason: `name changed without a process: ${f}` };
    }
    return null;
  };

  if (turnQuality === 'hard') {
    const d = (snapped.state.currentTurn ?? 0) - (prior.state.currentTurn ?? 0);
    if (d === 0) return nameDesyncAtStill() ?? { kind: 'still', turnQuality };
    if (d === 1) return { kind: 'process', successors, turnQuality };
    return { kind: 'desync', reason: `turn moved by ${d}` };
  }

  // Soft turn read: infer by config. Identical (no confident differences vs the prior on any
  // config field) reads as still; matching exactly one successor reads as that process.
  const stillContradiction = CONFIG_FIELDS.some(
    (f) => (cf.config?.[f] ?? 1) >= FLAG_BAR && snapped.config[f] !== prior.config[f]
  );
  if (!stillContradiction) return nameDesyncAtStill() ?? { kind: 'still', turnQuality: 'soft' };
  const viable = successors.filter((s) => !contradicts(s, prior, snapped));
  if (viable.length === 1) return { kind: 'process', successors, turnQuality: 'soft' };
  return { kind: 'desync', reason: 'soft turn read and ambiguous config' };
}
