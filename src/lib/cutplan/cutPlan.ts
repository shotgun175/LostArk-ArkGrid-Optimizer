// Cut-plan accessors over shizukaziye's baked exact-Bellman-DP pipeline (real % damage),
// per effect-pair bucket. The committed data (pipeline.json) stores per-(rarity, cost,
// bucket, gpd) arrays of baseline anchors; live mode linearly interpolates a cell's fields
// across those anchors at the user's baseline. gpd is always one of his baked anchors (our
// gold brackets == his anchorGpd), so only the baseline axis needs interpolation.
import type {
  BindingMode,
  BucketKey,
  CutAction,
  CutAxis,
  CutCell,
  GoldBracket,
  PipelineCellEntry,
  PipelineData,
  PipelineMeta,
  PipelineThruEntry,
  Rarity,
  ThruRow,
  Verdict,
} from './types';
import { GRADE_ROWS } from '../scoring/gemScore';
import { GOLD_PER_DAMAGE } from './types';

export { GOLD_PER_DAMAGE };

/**
 * Map a baseline GRADE to the exact baked % key the DP cells were solved at. Shizukaziye bakes one
 * solve per GRADE_ROWS anchor at baseline = gradeToScore(anchor), stored (same order) in
 * `meta.baselines[axis]`, and reads cells by exact key — so a baseline grade maps to that array at
 * the grade's anchor index. Any non-anchor grade snaps to its nearest anchor. Pass the AXIS-matching
 * array: DPS and support cells are baked at different % scales (support ÷3), so feeding the DPS array
 * to a support read clamps every cell to its top anchor (cut ≈ 0). (GRADE_ROWS and each axis array
 * are kept parallel; the length guard tolerates a future re-bake with fewer anchors.)
 */
export function pipelineBaselineForGrade(grade: number, baselines: number[]): number {
  const n = Math.min(GRADE_ROWS.length, baselines.length);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(GRADE_ROWS[i] - grade);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return baselines[best];
}

// Linear interpolation of a numeric field across baseline anchors (sorted ascending).
// Baseline is clamped to the baked range (his anchors span ≈ 0.83–1.47 % damage).
function lerp<T>(entries: T[], baseline: number, getB: (e: T) => number, getV: (e: T) => number): number {
  const n = entries.length;
  if (n === 0) return 0;
  if (baseline <= getB(entries[0])) return getV(entries[0]);
  if (baseline >= getB(entries[n - 1])) return getV(entries[n - 1]);
  for (let i = 1; i < n; i++) {
    if (baseline <= getB(entries[i])) {
      const lo = entries[i - 1];
      const hi = entries[i];
      const span = getB(hi) - getB(lo);
      const t = span > 0 ? (baseline - getB(lo)) / span : 0;
      return getV(lo) + (getV(hi) - getV(lo)) * t;
    }
  }
  return getV(entries[n - 1]);
}

/** Verdict band from a cut value, using his baked gold thresholds. */
export function verdictFor(cut: number, v: PipelineMeta['verdict']): Verdict {
  if (cut >= v.green) return 'green';
  if (cut >= v.yellowHi) return 'yellow-hi';
  if (cut >= v.yellowMid) return 'yellow-mid';
  if (cut >= v.yellowLo) return 'yellow-lo';
  if (cut > v.red) return 'yellow-dim';
  return 'red';
}

export function actionFor(verdict: Verdict): CutAction {
  if (verdict === 'green') return 'cut-reset'; // worth resetting if it lands below baseline
  if (verdict === 'red') return 'dont-cut';
  return 'cut';
}

/** Interpolate one (rarity, cost, bucket) cell at the given binding / gpd / baseline. */
export function getCutCell(
  data: PipelineData,
  axis: CutAxis,
  rarity: Rarity,
  cost: number,
  bucket: BucketKey,
  binding: BindingMode,
  gpd: number,
  baseline: number
): CutCell | null {
  const entries = data.axes[axis]?.cells?.[rarity]?.[String(cost)]?.[bucket]?.[String(gpd)];
  if (!entries || entries.length === 0) return null;
  const field = (pick: (e: PipelineCellEntry) => number) => lerp(entries, baseline, (e) => e.b, pick);
  const cut = field((e) => e[binding].cut);
  const verdict = verdictFor(cut, data.meta.verdict);
  return {
    cut,
    pAbove: field((e) => e[binding].pAbove),
    expScore: field((e) => e[binding].expScore),
    expSpend: field((e) => e[binding].expSpend),
    // The fodder tier split only exists for roster-free gems (rb gems are free to cut).
    fLeg: binding === 'nrb' ? field((e) => e.nrb.fLeg) : 0,
    fRelic: binding === 'nrb' ? field((e) => e.nrb.fRelic) : 0,
    fAnc: binding === 'nrb' ? field((e) => e.nrb.fAnc) : 0,
    verdict,
    action: actionFor(verdict),
    resetWorthy: verdict === 'green',
  };
}

/** Best (max) cut value across an archetype's four buckets — the per-cell header EV. */
export function headerCut(
  data: PipelineData,
  axis: CutAxis,
  rarity: Rarity,
  cost: number,
  binding: BindingMode,
  gpd: number,
  baseline: number
): number {
  let best = 0;
  for (const bucket of data.meta.buckets) {
    const cell = getCutCell(data, axis, rarity, cost, bucket, binding, gpd, baseline);
    if (cell && cell.cut > best) best = cell.cut;
  }
  return best;
}

/** Interpolate the weekly-throughput row for a (rarity, cost) at the baseline. */
export function getThru(
  data: PipelineData,
  axis: CutAxis,
  rarity: Rarity,
  cost: number,
  gpd: number,
  baseline: number
): ThruRow | null {
  const entries = data.axes[axis]?.thru?.[rarity]?.[String(cost)]?.[String(gpd)];
  if (!entries || entries.length === 0) return null;
  const f = (pick: (e: PipelineThruEntry) => number) => lerp(entries, baseline, (e) => e.b, pick);
  const totalPerWk = f((e) => e.totalPerWk);
  return {
    directPerWk: f((e) => e.directPerWk),
    fusePerWk: f((e) => e.fusePerWk),
    totalPerWk,
    // Weeks = slots / total is hyperbolic, so DERIVE it from the interpolated total rather than
    // linearly interpolating the baked weeks — which is also baked as null when total = 0
    // (24/0 = ∞). null means "nothing clears the baseline; can't fill at this budget".
    weeks: totalPerWk > 0 ? data.meta.slots / totalPerWk : null,
    goldPerWk: f((e) => e.goldPerWk),
    boxEV: f((e) => e.boxEV),
    avgScore: f((e) => e.avgScore),
    cpGain: f((e) => e.cpGain),
  };
}

/** The two effects that define a bucket at a base cost, for the given axis (for tooltips). */
export function effectPair(meta: PipelineMeta, axis: CutAxis, cost: number, bucket: BucketKey): string {
  const pair = meta.effectBuckets[axis]?.[String(cost)]?.[bucket];
  return pair ? `${pair.effect1} + ${pair.effect2}` : '';
}

const ACTION_LABELS: Record<CutAction, string> = {
  'cut-reset': 'Cut + reset',
  cut: 'Cut',
  'dont-cut': "Don't cut",
};
export function actionLabel(action: CutAction): string {
  return ACTION_LABELS[action];
}

export function bracketLabel(bracket: GoldBracket): string {
  return bracket.replace('_', '.');
}

export function weeksBand(weeks: number): 'fast' | 'med' | 'slow' {
  if (weeks <= 8) return 'fast';
  if (weeks <= 26) return 'med';
  return 'slow';
}
