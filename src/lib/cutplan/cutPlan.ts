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
  EconomyRow,
  GoldBracket,
  PipelineCellEntry,
  PipelineData,
  PipelineMeta,
  PipelineThruEntry,
  Rarity,
  ThruRow,
  Verdict,
} from './types';
import { gradeRows } from '../scoring/gemScore';
import { COSTS, GOLD_PER_DAMAGE, RARITIES } from './types';

export { GOLD_PER_DAMAGE };

// Economy constants that OVERRIDE the baked legacy meta (shizukaziye's pipeline.js CONST block does
// the same: the committed bake still carries his old deployed-page bands, these are the current ones).
// No re-bake needed. Both equal model/astrogem.js COSTS.reset.
export const RESET_COST = 20000; // gold to reset a finished gem for a fresh cut
export const RESET_THRESHOLD = 20000; // green band: a below-baseline finished gem is worth resetting iff cut-EV >= this

/**
 * Map a baseline GRADE to the exact baked key the DP cells were solved at. Shizukaziye bakes one
 * solve per baseline-ladder anchor (gradeRows(axis)) at baseline = gradeToScore(anchor), stored (same
 * order) in `meta.baselines[axis]`, and reads cells by exact key — so a baseline grade maps to that
 * array at the grade's anchor index. Any non-anchor grade snaps to its nearest anchor. Pass the
 * AXIS-matching array: DPS and support cells are baked at different value scales, and the two ladders
 * end at different S+ cuts, so feeding the DPS array to a support read misreads every cell. (Each axis
 * ladder and its baked array are kept parallel; the length guard tolerates a re-bake with fewer anchors.)
 */
export function pipelineBaselineForGrade(grade: number, axis: CutAxis, baselines: number[]): number {
  const rows = gradeRows(axis);
  const n = Math.min(rows.length, baselines.length);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(rows[i] - grade);
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

/** Verdict band from a cut value. Green uses the 20k reset threshold (a code override of the baked
 *  legacy meta.verdict.green of 18000); the yellow/red bands still come from the baked meta. */
export function verdictFor(cut: number, v: PipelineMeta['verdict']): Verdict {
  if (cut >= RESET_THRESHOLD) return 'green';
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
  baseline: number,
  blockFuse = false
): CutCell | null {
  const entries = data.axes[axis]?.cells?.[rarity]?.[String(cost)]?.[bucket]?.[String(gpd)];
  if (!entries || entries.length === 0) return null;
  const field = (pick: (e: PipelineCellEntry) => number) => lerp(entries, baseline, (e) => e.b, pick);
  const cut = field((e) => e[binding].cut);
  // A fuse-first block paints every bucket purple; the reset glyph is suppressed (purple is not green).
  const verdict = blockFuse ? 'purple' : verdictFor(cut, data.meta.verdict);
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
    action: blockFuse ? 'fuse' : actionFor(verdict),
    resetWorthy: verdict === 'green',
  };
}

export interface BucketBreakdown {
  key: BucketKey;
  label: string; // 2D/2S/Op/Sub/No (role-aware)
  effects: string; // the concrete effect pair, e.g. "Boss Damage + Attack Power" (role- and cost-aware)
  cut: number;
  pAbove: number;
  expScore: number;
  expSpend: number;
}
export interface CellBreakdown {
  buckets: BucketBreakdown[];
  averageCut: number; // (1·2D + 2·Op + 2·Sub + 1·No)/6 over the present buckets
}

// Average weights: (1·2D + 2·Op + 2·Sub + 1·No)/6 — the fresh-drop bucket mix (meta.freshBucketMix is
// the rounded form). Use the exact integers so the displayed average matches shizukaziye's tooltip.
const BUCKET_AVG_WEIGHT: Record<BucketKey, number> = {
  '2_damage': 1,
  optimal_damage: 2,
  suboptimal_damage: 2,
  no_damage: 1,
};

/**
 * Per-bucket breakdown for one archetype card: each bucket's cut / hit / expected score + spend, plus
 * the 1:2:2:1 weighted-average cut. Role-aware (2D vs 2S label, per-axis effect pairs) via `axis`.
 * Returns null when the archetype has no cells at this axis / gpd.
 */
export function cellBreakdown(
  data: PipelineData,
  axis: CutAxis,
  rarity: Rarity,
  cost: number,
  binding: BindingMode,
  gpd: number,
  baseline: number
): CellBreakdown | null {
  const buckets: BucketBreakdown[] = [];
  let accWeighted = 0;
  let accWeight = 0;
  for (const key of data.meta.buckets) {
    const cell = getCutCell(data, axis, rarity, cost, key, binding, gpd, baseline);
    if (!cell) continue;
    const base = data.meta.bucketLabels[key];
    const label = axis === 'support' && base === '2D' ? '2S' : base;
    buckets.push({
      key,
      label,
      effects: effectPair(data.meta, axis, cost, key),
      cut: cell.cut,
      pAbove: cell.pAbove,
      expScore: cell.expScore,
      expSpend: cell.expSpend,
    });
    const w = BUCKET_AVG_WEIGHT[key];
    accWeighted += w * cell.cut;
    accWeight += w;
  }
  if (buckets.length === 0) return null;
  return { buckets, averageCut: accWeight > 0 ? accWeighted / accWeight : 0 };
}

// ---- Pre-cut rarity-upgrade fusion (his pipeline.js CONST + unopenedFusion, Global region only) ----
const FUSION_COST = 500; // gold per 3-into-1 fuse
const UC_FUSE = { uncommon: 0.85, rare: 0.135, epic: 0.015 }; // 3 UC same cost -> same cost out
const RARE_FUSE = { uncommon: 0.52, rare: 0.44, epic: 0.04 }; // 1R + 2UC -> cost from inputs

export interface FuseFirst {
  /** Per (rarity, cost) NRB fuse-EV per block; null for epic (never fuses). */
  fuse: Record<Rarity, Record<number, number | null>>;
  /** Cost a Rare steers its two partners toward (argmax mixed output); UC keeps its own; epic null. */
  steer: Record<Rarity, Record<number, number | null>>;
}

/**
 * Fuse-first fixed point over the baked cells (shizukaziye's pipeline.js unopenedFusion, Global
 * branch only — KR excluded). Returns each block's rarity-upgrade fuse-EV and its steer cost, or
 * null if any required open value is missing. A block's open value is the (1:2:2:1)/6 mean of its
 * four bucket cut-EVs; the fuse value couples the three rarities across the three costs by plain
 * iteration (a contraction, so it converges to ~1e-9 in well under 200 steps).
 */
export function unopenedFusion(
  data: PipelineData,
  axis: CutAxis,
  gpd: number,
  baseline: number
): FuseFirst | null {
  const getCut = (roster: BindingMode, rarity: Rarity, cost: number, bucket: BucketKey): number | null => {
    const cell = getCutCell(data, axis, rarity, cost, bucket, roster, gpd, baseline);
    return cell ? cell.cut : null;
  };
  const openValue = (roster: BindingMode, rarity: Rarity, cost: number): number | null => {
    let acc = 0;
    let wsum = 0;
    for (const b of data.meta.buckets) {
      const cut = getCut(roster, rarity, cost, b);
      if (cut == null) return null;
      acc += BUCKET_AVG_WEIGHT[b] * cut;
      wsum += BUCKET_AVG_WEIGHT[b];
    }
    return wsum > 0 ? acc / wsum : null;
  };

  const OV: Record<BindingMode, Record<Rarity, Record<number, number>>> = {
    nrb: { uncommon: {}, rare: {}, epic: {} },
    rb: { uncommon: {}, rare: {}, epic: {} },
  };
  for (const roster of ['nrb', 'rb'] as BindingMode[])
    for (const rar of RARITIES)
      for (const cost of COSTS) {
        const ov = openValue(roster, rar, cost);
        if (ov == null) return null;
        OV[roster][rar][cost] = ov;
      }

  const U: Record<Rarity, Record<number, number>> = { uncommon: {}, rare: {}, epic: {} };
  for (const rar of RARITIES) for (const cost of COSTS) U[rar][cost] = OV.nrb[rar][cost];

  // Global: half of a fusion output is roster-bound (free to cut), so its "other half" is the RB
  // open value; the other half is the current NRB fixed-point estimate.
  const E = (rar: Rarity, cost: number) => 0.5 * OV.rb[rar][cost] + 0.5 * U[rar][cost];

  let fuse: Record<Rarity, Record<number, number | null>> = { uncommon: {}, rare: {}, epic: {} };
  let bestCost: number = COSTS[0];
  for (let iter = 0; iter < 200; iter++) {
    const Out: Record<number, number> = {};
    let maxOut = -Infinity;
    bestCost = COSTS[0];
    for (const c of COSTS) {
      Out[c] = RARE_FUSE.uncommon * E('uncommon', c) + RARE_FUSE.rare * E('rare', c) + RARE_FUSE.epic * E('epic', c);
      if (Out[c] > maxOut) {
        maxOut = Out[c];
        bestCost = c;
      }
    }
    const fA: Record<Rarity, Record<number, number | null>> = { uncommon: {}, rare: {}, epic: {} };
    for (const c of COSTS) {
      fA.uncommon[c] =
        (UC_FUSE.uncommon * E('uncommon', c) + UC_FUSE.rare * E('rare', c) + UC_FUSE.epic * E('epic', c) - FUSION_COST) / 3;
      fA.rare[c] = (1 / 3) * Out[c] + (2 / 3) * maxOut - FUSION_COST;
      fA.epic[c] = null;
    }
    let maxChange = 0;
    for (const rar of RARITIES)
      for (const c of COSTS) {
        const fv = fA[rar][c];
        const nv = fv == null ? OV.nrb[rar][c] : Math.max(OV.nrb[rar][c], fv);
        maxChange = Math.max(maxChange, Math.abs(nv - U[rar][c]));
        U[rar][c] = nv;
      }
    fuse = fA;
    if (maxChange < 1e-9) break;
  }

  const steer: Record<Rarity, Record<number, number | null>> = { uncommon: {}, rare: {}, epic: {} };
  for (const c of COSTS) {
    steer.uncommon[c] = c;
    steer.rare[c] = bestCost;
    steer.epic[c] = null;
  }
  return { fuse, steer };
}

/**
 * Whether a (rarity, cost) block is "fuse first" (purple): NRB only, its fuse-EV beats the raw
 * (1:2:2:1)/6 open value of its four buckets. Mirrors pipeline.js gemCell's blockFuse test.
 */
export function isBlockFuse(
  data: PipelineData,
  axis: CutAxis,
  rarity: Rarity,
  cost: number,
  binding: BindingMode,
  gpd: number,
  baseline: number,
  ff: FuseFirst | null
): boolean {
  if (binding !== 'nrb' || !ff) return false;
  const fuse = ff.fuse[rarity]?.[cost];
  if (fuse == null) return false;
  const bd = cellBreakdown(data, axis, rarity, cost, 'nrb', gpd, baseline);
  if (!bd) return false;
  return fuse > bd.averageCut;
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

// Economy and fusion are baked per baseline ANCHOR (not interpolated: box/reset decisions are
// discrete), indexed parallel to meta.baselines[axis]. `baseline` is already snapped to an anchor by
// pipelineBaselineForGrade, so we find the matching anchor index.
function baselineIndex(data: PipelineData, axis: CutAxis, baseline: number): number {
  const arr = data.meta.baselines[axis];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - baseline);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The whole-economy weekly model at the given axis / gpd / baseline (his live pipeline model). */
export function getEconomy(
  data: PipelineData,
  axis: CutAxis,
  gpd: number,
  baseline: number
): EconomyRow | null {
  const rows = data.axes[axis]?.economy?.[String(gpd)];
  if (!rows || rows.length === 0) return null;
  return rows[baselineIndex(data, axis, baseline)] ?? null;
}

export interface FusionWeighted {
  tierEV: { leg: number; relic: number; anc: number };
  fodder: { leg: number; relic: number; anc: number };
}
const FUSION_COST_MIX: Record<number, number> = { 8: 0.6, 9: 0.3, 10: 0.1 };

/** Cost-weighted (60/30/10) fusion / fodder values at the given axis / gpd / baseline (his table). */
export function getFusion(
  data: PipelineData,
  axis: CutAxis,
  gpd: number,
  baseline: number
): FusionWeighted | null {
  const byCost = data.axes[axis]?.fusion?.[String(gpd)];
  if (!byCost) return null;
  const idx = baselineIndex(data, axis, baseline);
  const acc: FusionWeighted = {
    tierEV: { leg: 0, relic: 0, anc: 0 },
    fodder: { leg: 0, relic: 0, anc: 0 },
  };
  for (const cost of [8, 9, 10]) {
    const row = byCost[String(cost)]?.[idx];
    if (!row) return null;
    const w = FUSION_COST_MIX[cost];
    for (const k of ['leg', 'relic', 'anc'] as const) {
      acc.tierEV[k] += w * row.tierEV[k];
      acc.fodder[k] += w * row.fodder[k];
    }
  }
  return acc;
}

/** The two effects that define a bucket at a base cost, for the given axis (for tooltips). */
export function effectPair(meta: PipelineMeta, axis: CutAxis, cost: number, bucket: BucketKey): string {
  const pair = meta.effectBuckets[axis]?.[String(cost)]?.[bucket];
  return pair ? `${pair.effect1} + ${pair.effect2}` : '';
}

const ACTION_LABELS: Record<CutAction, string> = {
  'cut-reset': 'Cut + reset',
  cut: 'Cut',
  'dont-cut': 'Dismantle',
  fuse: 'Fuse first',
};
export function actionLabel(action: CutAction): string {
  return ACTION_LABELS[action];
}

/**
 * The rarity-upgrade fuse recipe for a "fuse first" block (shizukaziye's pipeline.js steerTxt): an
 * Uncommon block fuses 3 of its own cost; a Rare fuses itself with two Uncommons steered toward the
 * cost with the best mixed output; Epic never fuses. Returns null when there's no fuse recipe.
 */
export function fuseRecipe(ff: FuseFirst | null, rarity: Rarity, cost: number): string | null {
  if (!ff || rarity === 'epic') return null;
  if (rarity === 'uncommon') return `3x ${cost}-cost Uncommon`;
  const steer = ff.steer.rare[cost] ?? cost;
  return `this + 2x ${steer}-cost Uncommon`;
}

export function bracketLabel(bracket: GoldBracket): string {
  return bracket.replace('_', '.');
}

export function weeksBand(weeks: number): 'fast' | 'med' | 'slow' {
  if (weeks <= 8) return 'fast';
  if (weeks <= 26) return 'med';
  return 'slow';
}
