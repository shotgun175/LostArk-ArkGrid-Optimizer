// Types for the per-effect-pair-bucket cut-plan model (shizukaziye's exact Bellman-DP
// pipeline, real % damage). Both axes (DPS, Support) share this shape; the data is baked
// by scripts/extract-pipeline.cjs into pipeline.json.

export type GoldBracket = '500k' | '1M' | '1_5M' | '2_5M' | '3_5M' | '5M' | '7_5M' | '10M';
export type BindingMode = 'nrb' | 'rb';
export type CutAxis = 'dps' | 'support';
export type CutAction = 'cut-reset' | 'cut' | 'dont-cut' | 'fuse';
export type Rarity = 'uncommon' | 'rare' | 'epic';
export type BucketKey = '2_damage' | 'optimal_damage' | 'suboptimal_damage' | 'no_damage';
/** Verdict band from the cut value (his meta.verdict gold thresholds); 'purple' = block fuse-first. */
export type Verdict = 'green' | 'yellow-hi' | 'yellow-mid' | 'yellow-lo' | 'yellow-dim' | 'red' | 'purple';

// ---- Baked data shape (output of scripts/extract-pipeline.cjs) ----
export type CutRootAction = 'process' | 'complete' | 'reroll';
export interface CellNrb {
  cut: number; // exact Bellman gold value of cutting a fresh gem of this archetype
  act: CutRootAction; // the DP's chosen root action; a 'complete' cell yields no fodder
  pAbove: number; // P(the optimal cut ends at/above baseline)
  expScore: number; // expected % damage of the cut
  expSpend: number; // expected gold spent per cut attempt of this archetype
  fLeg: number; // fodder tier split (legendary / relic / ancient), sums to 1 − pAbove
  fRelic: number;
  fAnc: number;
}
export interface CellRb {
  cut: number;
  act: CutRootAction;
  pAbove: number;
  expScore: number;
  expSpend: number; // 0 in the source (rb is free to cut); shown as "—"
}
export interface PipelineCellEntry {
  b: number; // baseline anchor (% damage)
  nrb: CellNrb;
  rb: CellRb;
}
export interface PipelineThruEntry {
  b: number;
  directPerWk: number;
  fusePerWk: number;
  totalPerWk: number;
  weeks: number | null; // null when total = 0 (24/0 = ∞); recomputed from total at read time
  goldPerWk: number;
  boxEV: number;
  avgScore: number;
  cpGain: number;
}
export interface PipelineMeta {
  scoreUnit: string;
  costs: number[];
  rarities: Rarity[];
  buckets: BucketKey[];
  bucketLabels: Record<BucketKey, string>;
  // Per-axis: the DPS and support tables pair different effects into each bucket, so the
  // tooltip labels are keyed by axis (every other meta field is identical across the two).
  effectBuckets: Record<CutAxis, Record<string, Record<BucketKey, { effect1: string; effect2: string }>>>;
  verdict: { green: number; yellowHi: number; yellowMid: number; yellowLo: number; red: number };
  slots: number;
  cutsPerWeek: Record<Rarity, number>;
  boxSchedule: { count: number; rarity: Rarity }[];
  freshBucketMix: Record<BucketKey, number>;
  anchorGpd: number[];
  // Per-axis baseline anchors (DPS and support cells are baked at different value scales). Each array
  // is parallel to gradeRows(axis); read the axis-matching one, like effectBuckets above.
  baselines: Record<CutAxis, number[]>;
}
type CellsByGpd = Record<string, PipelineCellEntry[]>;
type ThruByGpd = Record<string, PipelineThruEntry[]>;

/** Fusion / fodder values (his joint fixed-point solve), baked per baseline anchor. */
export interface FusionRow {
  /** Expected gold of a random PROCESSED gem of each fodder tier (keep-or-fuse EV). */
  tierEV: { leg: number; relic: number; anc: number };
  /** Per-input value of a below-baseline gem of each tier used as fusion fodder. */
  fodder: { leg: number; relic: number; anc: number };
}
// gpd -> cost -> [per baseline anchor], parallel to the cells' baseline order.
type FusionByGpd = Record<string, Record<string, FusionRow[]>>;

/** The whole-economy weekly model (his pipeline.js computePipeline), baked per baseline anchor. */
export interface EconomyRow {
  boxEV: number; // EV/box-gem this week; drives the buy flags
  buyVendor: boolean;
  buyMat: boolean;
  buyEpic: boolean;
  directPerWk: number; // above-baseline gems/week from cutting
  fusePerWk: number; // above-baseline gems/week from the fusion chain
  totalPerWk: number; // direct + fuse
  weeks: number | null; // 24 / total; null when nothing clears the baseline
  goldPerWk: number; // gold SPENT per week (boxes + cutting + 20k resets + fusion fees)
  goldTotal: number | null; // gold to fill all 24 slots
  cpPct: number; // combat-power % gain of the produced loadout (his COND_SCORE fallback)
}
type EconomyByGpd = Record<string, EconomyRow[]>;

export interface PipelineAxis {
  cells: Record<Rarity, Record<string, Record<BucketKey, CellsByGpd>>>;
  thru: Record<Rarity, Record<string, ThruByGpd>>;
  fusion: FusionByGpd;
  economy: EconomyByGpd;
}
export interface PipelineData {
  _provenance: Record<string, unknown>;
  meta: PipelineMeta;
  axes: Record<CutAxis, PipelineAxis>;
}

// ---- Interpolated results the UI renders ----
export interface CutCell {
  cut: number;
  pAbove: number;
  expScore: number;
  expSpend: number;
  fLeg: number;
  fRelic: number;
  fAnc: number;
  verdict: Verdict;
  action: CutAction;
  resetWorthy: boolean; // green band — worth resetting if it lands below baseline
}
export interface ThruRow {
  directPerWk: number;
  fusePerWk: number;
  totalPerWk: number;
  weeks: number | null; // null = nothing clears the baseline (can't fill at this budget)
  goldPerWk: number;
  boxEV: number;
  avgScore: number;
  cpGain: number;
}

export const GOLD_BRACKETS: GoldBracket[] = [
  '500k',
  '1M',
  '1_5M',
  '2_5M',
  '3_5M',
  '5M',
  '7_5M',
  '10M',
];
/** "Gold per 1% damage" for each bracket; these are exactly his baked gpd anchors. */
export const GOLD_PER_DAMAGE: Record<GoldBracket, number> = {
  '500k': 500_000,
  '1M': 1_000_000,
  '1_5M': 1_500_000,
  '2_5M': 2_500_000,
  '3_5M': 3_500_000,
  '5M': 5_000_000,
  '7_5M': 7_500_000,
  '10M': 10_000_000,
};

export const RARITIES: Rarity[] = ['uncommon', 'rare', 'epic'];
export const COSTS = [8, 9, 10] as const;
export const RARITY_LABEL: Record<Rarity, string> = {
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
};
