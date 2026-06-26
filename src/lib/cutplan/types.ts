// Types for the per-effect-pair-bucket cut-plan model (shizukaziye's exact Bellman-DP
// pipeline, real % damage). Both axes (DPS, Support) share this shape; the data is baked
// by scripts/extract-pipeline.cjs into pipeline.json.

export type GoldBracket = '500k' | '1M' | '1_5M' | '2_5M' | '3_5M' | '5M' | '7_5M' | '10M';
export type BindingMode = 'nrb' | 'rb';
export type CutAxis = 'dps' | 'support';
export type CutAction = 'cut-reset' | 'cut' | 'dont-cut';
export type Rarity = 'uncommon' | 'rare' | 'epic';
export type BucketKey = '2_damage' | 'optimal_damage' | 'suboptimal_damage' | 'no_damage';
/** Verdict band from the cut value (his meta.verdict gold thresholds). */
export type Verdict = 'green' | 'yellow-hi' | 'yellow-mid' | 'yellow-lo' | 'yellow-dim' | 'red';

// ---- Baked data shape (output of scripts/extract-pipeline.cjs) ----
export interface CellNrb {
  cut: number; // exact Bellman gold value of cutting a fresh gem of this archetype
  pAbove: number; // P(the optimal cut ends at/above baseline)
  expScore: number; // expected % damage of the cut
  fLeg: number; // fodder tier split (legendary / relic / ancient), sums to 1 − pAbove
  fRelic: number;
  fAnc: number;
}
export interface CellRb {
  cut: number;
  pAbove: number;
  expScore: number;
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
  effectBuckets: Record<string, Record<BucketKey, { effect1: string; effect2: string }>>;
  verdict: { green: number; yellowHi: number; yellowMid: number; yellowLo: number; red: number };
  slots: number;
  cutsPerWeek: Record<Rarity, number>;
  boxSchedule: { count: number; rarity: Rarity }[];
  freshBucketMix: Record<BucketKey, number>;
  anchorGpd: number[];
  baselines: number[];
}
type CellsByGpd = Record<string, PipelineCellEntry[]>;
type ThruByGpd = Record<string, PipelineThruEntry[]>;
export interface PipelineAxis {
  cells: Record<Rarity, Record<string, Record<BucketKey, CellsByGpd>>>;
  thru: Record<Rarity, Record<string, ThruByGpd>>;
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
export const BUCKET_KEYS: BucketKey[] = [
  '2_damage',
  'optimal_damage',
  'suboptimal_damage',
  'no_damage',
];
export const RARITY_LABEL: Record<Rarity, string> = {
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
};
