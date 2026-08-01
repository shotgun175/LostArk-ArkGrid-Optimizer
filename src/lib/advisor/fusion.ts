// Temporal fusion for the Cut Advisor. Checks each new parse against what the game could
// legally have done since the previous committed state (the prior), pins fields the
// transition determines, and raises (never lowers) per-field confidence under the
// invariants in docs/superpowers/specs/2026-07-31-advisor-temporal-fusion-design.md.
// Pure module: no Svelte, no DOM, no Vite-isms, no vendor imports. The vendored transition
// primitive (AstrogemNested.applyOutcome) is injected by the caller, so this file imports
// cleanly under plain Node (the tsx harness) and inside the advisor worker.
// A determined value that disagrees with a soft (<0.8) pixel read is ADOPTED outright at a flat
// ADOPT_HARD/ADOPT_SOFT confidence, never blended with the parse's own confidence; see the "field
// determined" rows in the spec's rule table. rerollsRemaining is exempt: it only ever lifts,
// never adopts, since a legal Charge purchase can move it outside the remembered tiles.
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

/**
 * processCost carries no confidence key of its own in the real pipeline: the vendored
 * constraintSnap always synthesizes `state.processCost`, but its confidence map only ever
 * populates `processCostMultiplier`. Looking `processCost` up directly falls through the `?? 1`
 * default and treats a defaulted 900 as a confident pixel read. Borrow the multiplier's
 * confidence for it instead. `fuse()` also derives `processCost`'s VALUE from the multiplier
 * (see the end of the field loop), so this borrow is the only place processCost confidence is
 * ever computed from.
 */
function stateConfOf(cf: ConfMaps, key: string): number | undefined {
  if (key === 'processCost') return cf.state?.processCostMultiplier;
  return cf.state?.[key];
}

export function seedFromParse(p: ParsedAdvisorState): FusionPrior {
  const cf = confMapsOf(p);
  const cq: Record<string, ChainQuality> = {};
  for (const k of Object.keys(p.config)) cq[k] = qualityOf(cf.config?.[k]);
  const sq: Record<string, ChainQuality> = {};
  for (const k of Object.keys(p.state)) sq[k] = qualityOf(stateConfOf(cf, k));
  const outs = p.outcomes ?? []; // tooltip-occluded captures can omit outcomes entirely
  return {
    config: { ...p.config },
    state: { ...p.state },
    outcomes: outs.map((o) => ({ ...o })),
    quality: { config: cq, state: sq, outcomes: outs.map((_, i) => qualityOf(cf.outcomes?.[i])) },
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
  'baseCost',
  'gemType',
  'willpowerLevel',
  'orderLevel',
  'effect1',
  'effect1Level',
  'effect2',
  'effect2Level',
];

export type Inferred =
  | { kind: 'still'; turnQuality: ChainQuality }
  | { kind: 'process'; successors: Successor[]; turnQuality: ChainQuality }
  | { kind: 'desync'; reason: string };

/** True when a confidently-read field of the parse rules this successor out. */
export function contradicts(
  s: Successor,
  prior: FusionPrior,
  snapped: ParsedAdvisorState
): boolean {
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
  // processCost is not checked here: it is bijectively derived from processCostMultiplier (see
  // fuse()), so vetoing on the multiplier already covers it, and a defaulted/unread cost value
  // can never wrongly veto a successor.
  const f = 'processCostMultiplier';
  const expected = s.state[f] ?? (prior.state[f] as number | undefined);
  if (expected != null && (stateConfOf(cf, f) ?? 1) >= FLAG_BAR && snapped.state[f] !== expected)
    return true;
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
  // nameDesyncAtStill() is provably a no-op here (its two fields are a subset of CONFIG_FIELDS,
  // which stillContradiction already found no confident difference on); kept anyway as a guard
  // against a future edit to either field list silently losing that coverage.
  if (!stillContradiction) return nameDesyncAtStill() ?? { kind: 'still', turnQuality: 'soft' };
  const viable = successors.filter((s) => !contradicts(s, prior, snapped));
  if (viable.length === 1) return { kind: 'process', successors, turnQuality: 'soft' };
  return { kind: 'desync', reason: 'soft turn read and ambiguous config' };
}

export interface FuseOutput {
  result: ParsedAdvisorState;
  status: FusionStatus;
  nextPrior: FusionPrior;
}

interface FieldRef {
  bucket: 'config' | 'state';
  key: string;
}

const STATE_FUSABLE: FieldRef[] = [
  { bucket: 'state', key: 'processCostMultiplier' },
  { bucket: 'state', key: 'rerollsRemaining' }, // lift-only, see below
  // processCost is deliberately absent: it is derived from processCostMultiplier after this
  // loop runs (see the end of fuse()), never fused as its own field.
];

function valueFor(s: Successor, prior: FusionPrior, ref: FieldRef): unknown {
  if (ref.bucket === 'config') return s.config[ref.key as keyof AdvisorConfig];
  return (
    s.state[ref.key as keyof Successor['state']] ??
    prior.state[ref.key as keyof FusionPrior['state']]
  );
}

function deepCopy(p: ParsedAdvisorState): ParsedAdvisorState {
  return {
    ...p,
    config: { ...p.config },
    state: { ...p.state },
    outcomes: (p.outcomes ?? []).map((o) => ({ ...o })),
    confidence: p.confidence
      ? {
          config: { ...(p.confidence as ConfMaps).config },
          state: { ...(p.confidence as ConfMaps).state },
          outcomes: [...((p.confidence as ConfMaps).outcomes ?? [])],
        }
      : undefined,
  } as ParsedAdvisorState;
}

export function fuse(
  prior: FusionPrior | null,
  snapped: ParsedAdvisorState,
  applyOutcome: ApplyOutcomeFn
): FuseOutput {
  if (!prior) return { result: snapped, status: 'seeded', nextPrior: seedFromParse(snapped) };
  const inferred = inferAction(prior, snapped, applyOutcome);
  if (inferred.kind === 'desync')
    return { result: snapped, status: 'desync', nextPrior: seedFromParse(snapped) };

  const stillSuccessor: Successor = {
    tileIndex: -1,
    config: { ...prior.config },
    state: {},
    tileQuality: 'hard', // a still frame involves no tile; hardness comes from the prior fields
  };
  const candidates = inferred.kind === 'still' ? [stillSuccessor] : inferred.successors;
  const viable = candidates.filter((s) => !contradicts(s, prior, snapped));
  if (viable.length === 0)
    return { result: snapped, status: 'desync', nextPrior: seedFromParse(snapped) };

  const result = deepCopy(snapped);
  const cf = (result.confidence ?? { config: {}, state: {}, outcomes: [] }) as Required<ConfMaps>;
  cf.config = cf.config ?? {};
  cf.state = cf.state ?? {};
  result.confidence = cf as ParsedAdvisorState['confidence'];

  // Tile link: whether the remembered tile SET can be trusted, not whether the one tile that
  // appears to move a given field looks hard. A process frame's successors are a pick among all
  // four remembered tiles together, so a single soft tile taints every field the process path
  // determines: a tile read soft as do_nothing that was really change_side_option makes the
  // stale effect name look "moved by nobody," and a per-successor mover check would wrongly call
  // that hard. A still frame involves no tile at all, so its link is unconditionally hard.
  const tileLink: ChainQuality =
    inferred.kind === 'process' ? minQ(...prior.quality.outcomes) : 'hard';

  const refs: FieldRef[] = [
    ...CONFIG_FIELDS.map((k) => ({ bucket: 'config' as const, key: k as string })),
    ...STATE_FUSABLE,
  ];
  for (const ref of refs) {
    // A slot whose name a viable change tile refreshes is a free draw: pixel-owned, no fusion.
    if (ref.bucket === 'config' && viable.some((s) => s.nameChangeSlot === ref.key)) continue;
    const values = viable.map((s) => valueFor(s, prior, ref));
    if (values.some((v) => v == null) || new Set(values).size !== 1) continue; // not determined
    const determined = values[0];

    // Chain quality: the prior field feeding this value, the remembered tile set's trust, and
    // the turn inference itself.
    const priorQ =
      ref.bucket === 'config'
        ? (prior.quality.config[ref.key] ?? 'soft')
        : (prior.quality.state[ref.key] ?? 'soft');
    const chainQ = minQ(priorQ, tileLink, inferred.turnQuality);

    const bucketVals = ref.bucket === 'config' ? result.config : result.state;
    const bucketConf = ref.bucket === 'config' ? cf.config : cf.state;
    const parseConf =
      ref.bucket === 'config' ? (bucketConf[ref.key] ?? 1) : (stateConfOf(cf, ref.key) ?? 1);
    const parseVal = (bucketVals as Record<string, unknown>)[ref.key];

    if (parseVal === determined) {
      const lift = chainQ === 'hard' ? LIFT_AGREE_HARD : LIFT_AGREE_SOFT;
      bucketConf[ref.key] = Math.max(parseConf, lift);
    } else if (parseConf < FLAG_BAR) {
      if (ref.key === 'rerollsRemaining') continue; // lift-only field, never adopted
      (bucketVals as Record<string, unknown>)[ref.key] = determined;
      bucketConf[ref.key] = chainQ === 'hard' ? ADOPT_HARD : ADOPT_SOFT;
    }
    // rerollsRemaining can reach here confidently different from `determined`: contradicts()
    // deliberately exempts it from viability filtering (a Charge purchase is legal outside the
    // remembered tiles), so it alone can arrive with parseConf >= FLAG_BAR and a mismatched
    // value; the else-if guard above already leaves it pixel-owned in that case. Every other
    // field's viability filtering means parseConf >= FLAG_BAR with a different value cannot
    // reach here at all.
  }

  // processCost is derived, not fused: deriving it from the just-fused multiplier (rather than
  // fusing it as its own STATE_FUSABLE field) guarantees the pair the result reports is always
  // internally consistent, and mirroring the multiplier's final confidence into processCost's
  // slot keeps the confidence map honest for anything that reads processCost directly.
  if (typeof result.state.processCostMultiplier === 'number') {
    result.state.processCost = costFromCm(result.state.processCostMultiplier);
    cf.state.processCost = cf.state.processCostMultiplier;
  }

  return { result, status: 'fused', nextPrior: seedFromParse(result) };
}
