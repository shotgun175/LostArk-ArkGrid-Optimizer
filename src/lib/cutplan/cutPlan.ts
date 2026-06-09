import type { BindingMode, CutAction, CutPlanRow, GoldBracket, PipelineTable } from './types';
import type {
  Archetype,
  Bucket,
  SupportArchetypeRank,
  SupportCutQuality,
  SupportPlan,
  SupportSummary,
} from './types';

export type DpsPlanResult =
  | { kind: 'ok'; row: CutPlanRow }
  | { kind: 'below-window'; minBaseline: number }
  | { kind: 'above-window'; maxBaseline: number }
  | { kind: 'no-data' };

export function getDpsPlan(
  table: PipelineTable,
  bracket: GoldBracket,
  binding: BindingMode,
  baseline: number
): DpsPlanResult {
  // rows are expected sorted ascending by baseline (the extractor emits them in table order).
  const rows = table[bracket]?.[binding];
  if (!rows || rows.length === 0) return { kind: 'no-data' };
  const exact = rows.find((r) => r.baseline === baseline);
  if (exact) return { kind: 'ok', row: exact };
  const min = rows[0].baseline;
  const max = rows[rows.length - 1].baseline;
  if (baseline < min) return { kind: 'below-window', minBaseline: min };
  return { kind: 'above-window', maxBaseline: max };
}

const ACTION_LABELS: Record<CutAction, string> = {
  'cut-reset': 'Cut + reset',
  cut: 'Cut',
  fuse: 'Fuse first',
  'dont-cut': "Don't cut",
};
export function actionLabel(action: CutAction): string {
  return ACTION_LABELS[action];
}

// Support uses the SAME EV-based cut rule as the DPS view. The author's gem-value formula
// (shizukaziye/ark-grid-solver: calculateGemValue) is role-agnostic in form — a gem's gold value is
// (score - baseline) x gold-per-score — and the app scores support on the SAME scale as DPS
// (gemScore.ts: shared willpower/point base, same tiers), so the support coefficients already make
// the score damage-equivalent. Per cut:
//   goldEV = E[gold gain of one cut] - cut cost
//          = (pct/100) x max(0, avg - baseline) x goldPerScore  -  CUT_COST
// Actions match the DPS table: goldEV >= RESET_COST -> Cut + reset ; > 0 -> Cut ; <= 0 -> Don't cut.
// "Fuse first" is still mirrored from the DPS table (a role-agnostic acquisition strategy).
export const SCORE_PER_DMG_PCT = 27; // author's score -> %damage normalization (goldPerScore = goldPerDmg/27)
export const CUT_COST = 900; // gold per cut attempt
export const RESET_COST = 20_000; // gold for one retry; the DPS table's cut-reset threshold
// Tunable: gold value of one SUPPORT score point relative to one DPS score point. 1.0 = value
// support exactly like DPS. Raise toward ~1.6 to honor the ally-vs-personal-damage gap if desired.
export const SUPPORT_VALUE_RATE = 1.0;

// Expected gold value of one support cut at this cell: P(above baseline) × value of the surplus −
// cut cost. Drives both the action and the per-archetype header EV (mirrors the DPS headerEV).
export function supportGoldEV(
  pct: number | null | undefined,
  avg: number | null | undefined,
  baseline: number,
  goldPerDamage: number
): number {
  if (pct == null || avg == null) return -CUT_COST;
  const goldPerScore = (goldPerDamage / SCORE_PER_DMG_PCT) * SUPPORT_VALUE_RATE;
  const expectedGain = (pct / 100) * Math.max(0, avg - baseline) * goldPerScore;
  return expectedGain - CUT_COST;
}

export function supportBucketAction(
  pct: number | null | undefined,
  avg: number | null | undefined,
  baseline: number,
  goldPerDamage: number,
  dpsAction?: CutAction
): CutAction {
  if (dpsAction === 'fuse') return 'fuse';
  const goldEV = supportGoldEV(pct, avg, baseline, goldPerDamage);
  if (goldEV >= RESET_COST) return 'cut-reset';
  if (goldEV > 0) return 'cut';
  return 'dont-cut';
}

export function bracketLabel(bracket: GoldBracket): string {
  return bracket.replace('_', '.');
}

export function weeksBand(weeks: number): 'fast' | 'med' | 'slow' {
  if (weeks <= 8) return 'fast';
  if (weeks <= 26) return 'med';
  return 'slow';
}

// Projected full ArkGrid astrogem slots (matches the DPS "fill all 24 slots" framing).
const GRID_SLOTS = 24;

function emptySupportSummary(): SupportSummary {
  return { bestPct: 0, bestTarget: null, avgScore: null, totalScore: null };
}

/**
 * Support cut plan at a baseline: the per-archetype ranking (best-first) plus relative summary
 * tiles. Returns empty ranks when the baseline is out of the sim's range (above ~17) — the caller
 * shows a "grid already very strong" message rather than odds.
 */
export function getSupportPlan(data: SupportCutQuality, baseline: number): SupportPlan {
  const atBaseline = data[String(baseline)];
  if (!atBaseline) return { ranks: [], summary: emptySupportSummary() };

  const ranks: SupportArchetypeRank[] = [];
  let bestPct = 0;
  let bestTarget: { archetype: Archetype; bucket: Bucket } | null = null;
  let bestAvg: number | null = null;

  for (const [archetypeStr, buckets] of Object.entries(atBaseline)) {
    const archetype = archetypeStr as Archetype;
    const bucketCells: Partial<Record<Bucket, { pct: number; avg: number | null }>> = {};
    let best = 0;
    for (const [bktStr, cell] of Object.entries(buckets)) {
      if (!cell) continue;
      const bkt = bktStr as Bucket;
      bucketCells[bkt] = { pct: cell.pct, avg: cell.avg };
      if (cell.pct > best) best = cell.pct;
      if (cell.pct > bestPct) {
        bestPct = cell.pct;
        bestTarget = { archetype, bucket: bkt };
        bestAvg = cell.avg;
      }
    }
    ranks.push({ archetype, best, buckets: bucketCells });
  }
  ranks.sort((a, b) => b.best - a.best);

  const summary: SupportSummary = {
    bestPct,
    bestTarget,
    avgScore: bestAvg,
    totalScore: bestAvg != null ? Math.round(bestAvg * GRID_SLOTS) : null,
  };
  return { ranks, summary };
}
