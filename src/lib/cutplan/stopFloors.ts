// Per-cost "is cutting still paying?" verdicts + top-gem production costs, derived from the baked
// pipeline cells. The rules are shizukaziye's when-to-stop-cutting.md (2026-08-17): each base cost is
// judged against its own floor, the worst EQUIPPED gem a fresh cut of that cost could legally replace
// (the willpower rule: a fresh c-cost's best possible requirement is c-5, and packed cores have zero
// slack, so it can only sit where the current gem's requirement is >= c-5). Cutting a cost stops
// paying when the cut value at that floor drops to zero (the NA/EU bar; we model no KR market).
// Both reads use the last-to-die case (epic cuts, best 2-damage pair), so `pays` is the OPTIMISTIC
// verdict: worse pairs stop earlier.
import type { ArkGridGem } from '../models/arkGridGems';
import { type GemRole, computeGemScore, gradeRows, rankFromGrade } from '../scoring/gemScore';
import { getCutCell, pipelineBaselineForGrade } from './cutPlan';
import type { BindingMode, CutAxis, PipelineData } from './types';

export interface CostFloor {
  /** Grade of the worst equipped gem this cost can legally replace. */
  grade: number;
  /** That gem's current willpower requirement. */
  req: number;
}

/** The floor gem for a base cost, or null when no equipped gem qualifies ("no slot"). */
export function costFloor(equipped: ArkGridGem[], cost: number, role: GemRole): CostFloor | null {
  const minReq = cost - 5;
  let worst: CostFloor | null = null;
  for (const g of equipped) {
    if (g.req < minReq) continue;
    const grade = computeGemScore(g, role).grade;
    if (!worst || grade < worst.grade) worst = { grade, req: g.req };
  }
  return worst;
}

export type StopVerdict =
  | { kind: 'no-slot' }
  | { kind: 'pays'; cut: number; floorGrade: number }
  | { kind: 'stopped'; cut: number; floorGrade: number };

/** The stop-cutting verdict for a cost judged at an explicit floor grade (ladder-snapped read). */
export function stopVerdictAtFloor(
  data: PipelineData,
  axis: CutAxis,
  cost: number,
  binding: BindingMode,
  gpd: number,
  floorGrade: number
): StopVerdict {
  const floorPct = pipelineBaselineForGrade(floorGrade, axis, data.meta.baselines[axis]);
  const cell = getCutCell(data, axis, 'epic', cost, '2_damage', binding, gpd, floorPct);
  const cut = cell?.cut ?? 0;
  return cut > 0
    ? { kind: 'pays', cut, floorGrade }
    : { kind: 'stopped', cut, floorGrade };
}

/** The stop-cutting verdict for a cost against the equipped loadout (floor via the willpower rule). */
export function stopVerdict(
  data: PipelineData,
  axis: CutAxis,
  cost: number,
  binding: BindingMode,
  gpd: number,
  equipped: ArkGridGem[],
  role: GemRole
): StopVerdict {
  const floor = costFloor(equipped, cost, role);
  if (!floor) return { kind: 'no-slot' };
  return stopVerdictAtFloor(data, axis, cost, binding, gpd, floor.grade);
}

export interface ProductionRow {
  grade: number;
  rank: string;
  /** Expected gold to produce one gem at/above this tier per cost; null = unreachable (pAbove 0). */
  byCost: Record<number, number | null>;
}

/**
 * Expected total cutting spend per gem that reaches each tier: expSpend / pAbove read at the EXACT
 * ladder anchor (epic, 2-damage pair, nrb; production is a gold-spend concept, so there is no rb
 * variant). Rows A through the axis S+. Reproduces his when-to-stop-cutting.md sidebar.
 */
export function productionCosts(data: PipelineData, axis: CutAxis, gpd: number): ProductionRow[] {
  const rows = gradeRows(axis);
  const out: ProductionRow[] = [];
  for (let i = rows.indexOf(83.3); i >= 0 && i < rows.length; i++) {
    const grade = rows[i];
    const byCost: Record<number, number | null> = {};
    for (const cost of [8, 9, 10]) {
      const entry = data.axes[axis]?.cells?.epic?.[String(cost)]?.['2_damage']?.[String(gpd)]?.[i];
      byCost[cost] =
        entry && entry.nrb.pAbove > 0 ? entry.nrb.expSpend / entry.nrb.pAbove : null;
    }
    out.push({ grade, rank: rankFromGrade(grade, axis), byCost });
  }
  return out;
}
