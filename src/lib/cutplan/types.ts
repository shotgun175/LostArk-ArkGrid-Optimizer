export type GoldBracket = '500k' | '1M' | '1_5M' | '2_5M' | '3_5M' | '5M' | '7_5M' | '10M';
export type BindingMode = 'nrb' | 'rb';
export type CutAction = 'cut-reset' | 'cut' | 'fuse' | 'dont-cut';
export type Archetype = 'UC8' | 'UC9' | 'UC10' | 'R8' | 'R9' | 'R10' | 'E8' | 'E9' | 'E10';
export type Bucket = '2D' | 'Op' | 'Sub' | 'No';

export interface BucketCell {
  goldEV: number | null;
  pct: number | null;
  action: CutAction;
}
export interface ArchetypeCell {
  headerEV: number | null;
  buckets: Partial<Record<Bucket, BucketCell>>;
}
export interface PipelineStats {
  boxes: string;
  boxEV: string;
  directWk: string;
  fuseWk: string;
  totalWk: string;
  weeks: string;
  gold: string;
  avgScore: string;
  totalScore: string;
  cpGain: string;
}
export interface CutPlanRow {
  baseline: number;
  archetypes: Record<Archetype, ArchetypeCell>;
  pipeline: PipelineStats;
}
export type PipelineTable = Record<GoldBracket, Record<BindingMode, CutPlanRow[]>>;

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
export const ARCHETYPES: Archetype[] = ['UC8', 'UC9', 'UC10', 'R8', 'R9', 'R10', 'E8', 'E9', 'E10'];
export const BUCKETS: Bucket[] = ['2D', 'Op', 'Sub', 'No'];

// Numeric "gold per 1% damage" for each bracket (the author's value selector). Drives the support
// EV (and could back the DPS value formula too); the DPS pipeline table embeds its own EVs already.
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

// supportCutQuality[baseline][archetype][bucket] = { pct: P(score > baseline), avg: E[score | >bl] }.
export interface SupportCell {
  pct: number;
  avg: number | null;
}
export type SupportCutQuality = Record<
  string,
  Record<Archetype, Partial<Record<Bucket, SupportCell>>>
>;

export interface SupportArchetypeRank {
  archetype: Archetype;
  best: number; // best single-cut % across this archetype's buckets at the baseline
  // per-bucket single-cut % + E[score | above baseline], for the cards and the EV-based cut action
  buckets: Partial<Record<Bucket, { pct: number; avg: number | null }>>;
}

// Relative summary tiles, mirroring the DPS pipeline stats but odds/score based (no economics).
export interface SupportSummary {
  bestPct: number; // best single-cut chance across all archetypes/buckets
  cutsPerHit: number | null; // expected cuts to land one above-baseline gem (round(100/bestPct))
  bestTarget: { archetype: Archetype; bucket: Bucket } | null;
  avgScore: number | null; // best target's E[score | above baseline]
  totalScore: number | null; // avgScore × grid slots (projected full grid)
}

export interface SupportPlan {
  ranks: SupportArchetypeRank[];
  summary: SupportSummary;
}
