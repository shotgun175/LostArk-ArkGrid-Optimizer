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

// Support gets the same four action pills as the DPS view. There's no gold/EV model for support
// (only relative single-cut odds), so the mapping is:
//   - "Fuse first" is mirrored from the DPS table wherever it recommends fuse for the same
//     archetype+bucket — fusing lower gems up is an acquisition strategy that doesn't depend on role.
//   - the other three follow the support single-cut % (thresholds are tunable):
//       >= 50%  Cut + reset  (better-than-coinflip cut; re-roll sub-baseline results)
//       >= 15%  Cut          (lands within ~7 cuts on average; don't reset)
//       else    Don't cut    (poor odds / no chance)
export const SUPPORT_CUT_RESET_MIN = 50;
export const SUPPORT_CUT_MIN = 15;
export function supportBucketAction(
  pct: number | null | undefined,
  dpsAction?: CutAction
): CutAction {
  if (dpsAction === 'fuse') return 'fuse';
  if (pct != null && pct >= SUPPORT_CUT_RESET_MIN) return 'cut-reset';
  if (pct != null && pct >= SUPPORT_CUT_MIN) return 'cut';
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
  return { bestPct: 0, cutsPerHit: null, bestTarget: null, avgScore: null, totalScore: null };
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
    const pctByBucket: Partial<Record<Bucket, number>> = {};
    let best = 0;
    for (const [bktStr, cell] of Object.entries(buckets)) {
      if (!cell) continue;
      const bkt = bktStr as Bucket;
      pctByBucket[bkt] = cell.pct;
      if (cell.pct > best) best = cell.pct;
      if (cell.pct > bestPct) {
        bestPct = cell.pct;
        bestTarget = { archetype, bucket: bkt };
        bestAvg = cell.avg;
      }
    }
    ranks.push({ archetype, best, buckets: pctByBucket });
  }
  ranks.sort((a, b) => b.best - a.best);

  const summary: SupportSummary = {
    bestPct,
    cutsPerHit: bestPct > 0 ? Math.round(100 / bestPct) : null,
    bestTarget,
    avgScore: bestAvg,
    totalScore: bestAvg != null ? Math.round(bestAvg * GRID_SLOTS) : null,
  };
  return { ranks, summary };
}
