import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import realPipeline from './pipeline.json';
import { costFloor, productionCosts, stopVerdict, stopVerdictAtFloor } from './stopFloors';
import type { PipelineData } from './types';

const real = realPipeline as unknown as PipelineData;

/** A hand-built equipped gem; only the fields stopFloors reads need to be realistic. */
function gem(req: number, effectValue: number): ArkGridGem {
  return {
    gemAttr: 'Order',
    req,
    point: 3,
    option1: { optionType: 'AtkPower', value: effectValue },
    option2: { optionType: 'BossDamage', value: effectValue },
  };
}

describe('costFloor (the willpower rule)', () => {
  it('only counts equipped gems a fresh cut of that cost can legally replace (req >= cost - 5)', () => {
    // A fresh 10-cost's best possible requirement is 5, so it can never sit where a req-4 gem does.
    expect(costFloor([gem(4, 3)], 10, 'dps')).toBeNull();
    expect(costFloor([gem(5, 3)], 10, 'dps')).not.toBeNull();
    // An 8-cost (best req 3) can replace req >= 3.
    expect(costFloor([gem(3, 3)], 8, 'dps')).not.toBeNull();
    expect(costFloor([gem(2, 3)], 8, 'dps')).toBeNull();
  });
  it('returns the WORST qualifying grade (the gem a new cut would actually replace)', () => {
    const weak = gem(5, 1);
    const strong = gem(5, 5);
    const floor = costFloor([strong, weak], 9, 'dps')!;
    expect(floor.grade).toBeLessThan(costFloor([strong], 9, 'dps')!.grade);
    expect(floor.req).toBe(5);
  });
  it('returns null on an empty loadout', () => {
    expect(costFloor([], 8, 'dps')).toBeNull();
  });
});

// Real-data anchors from shizukaziye's when-to-stop-cutting.md (2026-08-17) NA/EU table, judged at
// ladder rows one full band away from his continuous-DP floors (the baked cut is rounded to whole
// gold, so the row nearest a crossing can read 0 while the true crossing sits just above it).
// His floors (nrb): 2.5M gpd -> c8 92.9, c10 98.2 (above the ladder); 500k -> c9 91.0.
describe('stopVerdictAtFloor (real baked data, dps/nrb)', () => {
  it('c8 at 2.5M: still pays at a 90 floor, stopped at 93.3', () => {
    const pays = stopVerdictAtFloor(real, 'dps', 8, 'nrb', 2_500_000, 90);
    expect(pays.kind).toBe('pays');
    if (pays.kind === 'pays') expect(pays.cut).toBeGreaterThan(0);
    expect(stopVerdictAtFloor(real, 'dps', 8, 'nrb', 2_500_000, 93.3).kind).toBe('stopped');
  });
  it('c10 at 2.5M: still pays even at the ladder top (his floor 98.2 is above S+)', () => {
    expect(stopVerdictAtFloor(real, 'dps', 10, 'nrb', 2_500_000, 96.1).kind).toBe('pays');
  });
  it('c9 at 500k: pays at 86.7, stopped at 93.3 (his floor 91.0 lies between)', () => {
    expect(stopVerdictAtFloor(real, 'dps', 9, 'nrb', 500_000, 86.7).kind).toBe('pays');
    expect(stopVerdictAtFloor(real, 'dps', 9, 'nrb', 500_000, 93.3).kind).toBe('stopped');
  });
});

describe('stopVerdict (composed with the equipped loadout)', () => {
  it('reports no-slot when no equipped gem qualifies for the cost', () => {
    expect(stopVerdict(real, 'dps', 10, 'nrb', 2_500_000, [gem(4, 3)], 'dps').kind).toBe('no-slot');
  });
  it('carries the floor grade through to the verdict', () => {
    const g = gem(5, 1);
    const v = stopVerdict(real, 'dps', 8, 'nrb', 2_500_000, [g], 'dps');
    expect(v.kind === 'pays' || v.kind === 'stopped').toBe(true);
    if (v.kind !== 'no-slot') expect(v.floorGrade).toBeGreaterThan(0);
  });
});

// Production cost = expected cutting spend per gem that reaches the tier: expSpend / pAbove at the
// EXACT ladder anchor (epic cuts, best 2-damage pair, nrb). Verified 2026-08-24 to reproduce his
// when-to-stop-cutting.md sidebar exactly at the 2.5M anchor.
describe('productionCosts (real baked data, dps @2.5M)', () => {
  const rows = productionCosts(real, 'dps', 2_500_000);
  const at = (grade: number) => rows.find((r) => Math.abs(r.grade - grade) < 0.01)!;
  it('covers A through S+ with rank labels', () => {
    expect(rows.map((r) => r.rank)).toEqual(['A', 'A+', 'S-', 'S', 'S+']);
  });
  it('reproduces his sidebar at A (c8 ~130k, c9 ~132k, c10 ~152k)', () => {
    const a = at(83.3);
    expect(a.byCost[8]! / 1000).toBeCloseTo(130, 0);
    expect(a.byCost[9]! / 1000).toBeCloseTo(132, 0);
    expect(a.byCost[10]! / 1000).toBeCloseTo(152, 0);
  });
  it('reproduces his sidebar at S (c8 unreachable, c9 ~626k, c10 ~576k)', () => {
    const s = at(93.3);
    expect(s.byCost[8]).toBeNull();
    expect(s.byCost[9]! / 1000).toBeCloseTo(626, 0);
    expect(s.byCost[10]! / 1000).toBeCloseTo(576, 0);
  });
});
