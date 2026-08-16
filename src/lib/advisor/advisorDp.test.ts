// Foundation gate for the Cut Advisor: the vendored decision engine (his DP) must stay wired to our
// scoring, and evaluateActionsDP must produce a well-formed recommendation from a parsed state.
//
// The vendored files are CommonJS UMD (module.exports / globalThis attach); dp.js require()s
// astrogem.js + nested.js relatively, so a plain Node require of dp.js self-wires all three. We reach
// them with createRequire (native Node resolution, no Vitest transform) — the same pattern the app's
// worker will use in reverse (globalThis attach) in the browser.
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import type { ArkGridGemOptionName } from '../models/arkGridGemSpecs';
import pipeline from '../cutplan/pipeline.json';
import {
  type GemRole,
  RANK_LADDER_TAIL,
  computeGemScore,
  gradeRows,
  sPlusCut,
} from '../scoring/gemScore';
import { DP_FIXTURES } from './advisorDp.fixtures';

const require = createRequire(import.meta.url);
const A = require('./vendor/model/astrogem.js');
const DP = require('./vendor/model/dp.js');

// His effect names <-> our option-type keys.
const NAME_TO_KEY: Record<string, ArkGridGemOptionName> = {
  'Attack Power': 'AtkPower',
  'Additional Damage': 'AddDamage',
  'Boss Damage': 'BossDamage',
  'Brand Power': 'BrandPower',
  'Ally Damage Enh.': 'AllyDamageEnh',
  'Ally Attack Enh.': 'AllyAttackEnh',
};

interface HisConfig {
  baseCost: number;
  willpowerLevel: number;
  orderLevel: number;
  effect1: string;
  effect1Level: number;
  effect2: string;
  effect2Level: number;
}
function toGem(cfg: HisConfig): ArkGridGem {
  return {
    req: cfg.baseCost - cfg.willpowerLevel, // willpower COST = baseCost - level
    point: cfg.orderLevel,
    option1: { optionType: NAME_TO_KEY[cfg.effect1], value: cfg.effect1Level },
    option2: { optionType: NAME_TO_KEY[cfg.effect2], value: cfg.effect2Level },
  } as unknown as ArkGridGem;
}

describe('advisor vendor: scoring drift guard (vendored astrogem.js vs our gemScore.ts)', () => {
  // Representative configs across all three costs and their effect pools, plus a support case.
  // If our gemScore.ts ever drifts from the vendored engine the advisor ranks against, this fails.
  const pools: Record<number, string[]> = A.EFFECT_POOLS;
  it('gemValue and grade match on both axes across the cost/effect space', () => {
    let checked = 0;
    for (const role of ['dps', 'support'] as GemRole[]) {
      for (const baseCost of [8, 9, 10]) {
        const pool = pools[baseCost];
        for (let i = 0; i < pool.length; i++)
          for (let j = i + 1; j < pool.length; j++) {
            // A few level combos per pair (not the full space; the whole-space sweep lives in the
            // session notes). Enough to catch any constant/formula change.
            for (const [wp, o, a, b] of [
              [5, 5, 5, 5],
              [3, 2, 4, 1],
              [1, 4, 2, 5],
            ]) {
              const cfg = {
                baseCost,
                willpowerLevel: wp,
                orderLevel: o,
                effect1: pool[i],
                effect1Level: a,
                effect2: pool[j],
                effect2Level: b,
              };
              const ours = computeGemScore(toGem(cfg), role);
              const hisValue = role === 'dps' ? A.gemValue(cfg) : A.supportValue(cfg);
              const hisGrade = role === 'dps' ? A.grade(cfg) : A.supportGrade(cfg);
              expect(ours.gemValue).toBeCloseTo(hisValue, 9);
              expect(ours.grade).toBeCloseTo(hisGrade, 9);
              checked++;
            }
          }
      }
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('his gradeToScore anchors match our baked pipeline baselines (both axes stay in lockstep)', () => {
    // The vendored inverse over OUR baseline ladder must reproduce the baked meta.baselines[axis]
    // exactly (that is how the Cutting Plan reads a cell by grade), and the two S+ cuts must agree.
    // The whole letter ladder, not just the S+ pin: an upstream re-tune of the band cuts must fail here.
    const ours = (role: GemRole) => [['S+', sPlusCut(role)], ...RANK_LADDER_TAIL];
    expect(A.RANK_LADDER).toEqual(ours('dps'));
    expect(A.SUPPORT_RANK_LADDER).toEqual(ours('support'));
    for (const axis of ['dps', 'support'] as const) {
      const rows = gradeRows(axis);
      const baked = pipeline.meta.baselines[axis];
      expect(baked).toHaveLength(rows.length);
      rows.forEach((g, i) => {
        const v = axis === 'support' ? A.supportGradeToScore(g) : A.gradeToScore(g);
        expect(v).toBeCloseTo(baked[i], 6);
      });
    }
  });
});

describe('advisor DP: evaluateActionsDP produces a valid recommendation', () => {
  const GPD = 1_500_000;
  const baseline = A.gradeToScore(55); // a mid B-tier baseline (gemValue-scale threshold)
  const ACTIONS = ['process', 'reroll', 'complete', 'reset'];

  // The last-turn fixture values a fresh cut for all 6 effect pairs (Reset), which is seconds of DP;
  // give these generous timeouts so a slow CI box never flakes.
  for (const [name, state] of Object.entries(DP_FIXTURES)) {
    it(
      `ranks the four actions for ${name}`,
      () => {
        const res = DP.evaluateActionsDP(state, baseline, GPD, 1, null, { axis: 'dps' });
        expect(ACTIONS).toContain(res.bestAction);
        expect(res.allActions).toHaveLength(4);
        expect(Number.isFinite(res.currentValue)).toBe(true);
        const proc = res.allActions.find((x: { name: string }) => x.name === 'Process');
        expect(Number.isFinite(proc.value)).toBe(true); // outcomes exist, so Process is evaluable
      },
      15000
    );
  }

  it(
    'offers a live Reset on the last turn (uncommon-last-turn fixture)',
    () => {
      const res = DP.evaluateActionsDP(DP_FIXTURES['uncommon-last-turn'], baseline, GPD, 1, null, {
        axis: 'dps',
      });
      const reset = res.allActions.find((x: { name: string }) => x.name === 'Reset');
      expect(Number.isFinite(reset.value)).toBe(true);
      expect(res.resetCost).toBeGreaterThan(0);
    },
    15000
  );

  it('supports the support axis without throwing', () => {
    const supBaseline = A.supportGradeToScore(55);
    const res = DP.evaluateActionsDP(DP_FIXTURES['t6-15pts'], supBaseline, GPD, 1, null, {
      axis: 'support',
    });
    expect(ACTIONS).toContain(res.bestAction);
  });
});
