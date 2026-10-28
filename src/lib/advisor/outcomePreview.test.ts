// Drift guard for the Cut Advisor's per-outcome grade previews (outcomePreview.ts). Every preview must
// land exactly where the vendored DP's own transition puts the gem (dp.js outcomeBranchesActual, which
// applies nested.js applyOutcome), graded exactly as the vendored astrogem.js grades it, on both axes.
// If this fails after a re-sync, upstream changed how an outcome resolves or how a gem grades: port
// the change into outcomePreview.ts / gemScore.ts rather than loosening the test.
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import type { GemRole } from '../scoring/gemScore';
import type { AdvisorConfig, AdvisorOutcome } from './advisorController';
import {
  EFFECT_POOLS,
  applyOutcomeToConfig,
  effectChangeCandidates,
  gradeConfig,
  previewOutcome,
} from './outcomePreview';

const require = createRequire(import.meta.url);
const A = require('./vendor/model/astrogem.js');
const DP = require('./vendor/model/dp.js');

const ROLES: GemRole[] = ['dps', 'support'];
const hisGrade = (c: AdvisorConfig, role: GemRole): number =>
  role === 'dps' ? A.grade(c) : A.supportGrade(c);
const hisRank = (g: number, role: GemRole): string =>
  role === 'dps' ? A.rankFromGrade(g) : A.supportRankFromGrade(g);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Every outcome a Processing tile can carry, in the shapes ProcessingWindow's rawOutcome emits. */
const OUTCOMES: AdvisorOutcome[] = [
  ...['willpower', 'order', 'effect1', 'effect2'].flatMap((target) => [
    ...[1, 2, 3, 4].map((amount) => ({ type: 'raise_effect', target, amount })),
    { type: 'lower_effect', target, amount: 1 },
  ]),
  { type: 'change_side_option', target: 'effect1' },
  { type: 'change_side_option', target: 'effect2' },
  { type: 'change_gold_cost', change: 100 },
  { type: 'change_gold_cost', change: -100 },
  { type: 'reroll_increase', change: 1 },
  { type: 'reroll_increase', change: 2 },
  { type: 'do_nothing' },
];

/** Every base cost and ordered effect pair, at floor, ceiling and mixed levels. */
function sweepConfigs(): AdvisorConfig[] {
  const out: AdvisorConfig[] = [];
  for (const baseCost of [8, 9, 10]) {
    const pool = EFFECT_POOLS[baseCost];
    for (let i = 0; i < pool.length; i++)
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;
        for (const [wp, order, a, b] of [
          [1, 1, 1, 1],
          [3, 2, 4, 1],
          [2, 4, 5, 3],
          [5, 5, 5, 5],
        ])
          out.push({
            baseCost,
            gemType: 'chaos',
            willpowerLevel: wp,
            orderLevel: order,
            effect1: pool[i],
            effect1Level: a,
            effect2: pool[j],
            effect2Level: b,
          });
      }
  }
  return out;
}

interface Branch {
  config: AdvisorConfig;
  dCm: number;
  dRerolls: number;
  w: number;
}

describe('outcome previews match the vendored DP transitions and grades', () => {
  it('uses the vendored side-effect pools, in the vendored order', () => {
    expect(EFFECT_POOLS).toEqual(A.EFFECT_POOLS);
  });

  it('grades every config like the vendored engine, on both axes', () => {
    for (const cfg of sweepConfigs())
      for (const role of ROLES) {
        const g = hisGrade(cfg, role);
        expect(gradeConfig(cfg, role)).toEqual({ grade: g, rank: hisRank(g, role) });
      }
  });

  it('lands every outcome where the DP lands it', () => {
    let checked = 0;
    for (const cfg of sweepConfigs())
      for (const o of OUTCOMES) {
        const branches: Branch[] = DP.outcomeBranchesActual(cfg, o);
        for (const role of ROLES) {
          const now = hisGrade(cfg, role);
          const pv = previewOutcome(cfg, o, role);
          if (o.type === 'raise_effect' || o.type === 'lower_effect') {
            expect(branches).toHaveLength(1);
            const next = branches[0].config;
            expect(applyOutcomeToConfig(cfg, o)).toEqual(next);
            const g = hisGrade(next, role);
            expect(pv).toEqual({ kind: 'grade', grade: g, rank: hisRank(g, role), delta: round1(g - now) });
          } else if (o.type === 'change_side_option') {
            // The DP fans an unnamed effect change evenly over the candidates; ours shows each one.
            const slot = o.target === 'effect2' ? 'effect2' : 'effect1';
            expect(branches).toHaveLength(2);
            for (const b of branches) {
              expect(b.w).toBe(0.5);
              expect(applyOutcomeToConfig(cfg, o, b.config[slot])).toEqual(b.config);
            }
            const theirs = branches
              .map((b) => {
                const g = hisGrade(b.config, role);
                return { effect: b.config[slot], grade: g, rank: hisRank(g, role), delta: round1(g - now) };
              })
              .sort((x, y) => x.grade - y.grade);
            expect(pv).toEqual({ kind: 'split', landings: theirs });
          } else {
            // Cost, reroll and do-nothing outcomes leave the gem itself exactly as it is.
            expect(branches).toHaveLength(1);
            expect(branches[0].config).toEqual(cfg);
            expect(applyOutcomeToConfig(cfg, o)).toEqual(cfg);
            expect(pv).toEqual({ kind: o.type === 'do_nothing' ? 'none' : 'unchanged' });
          }
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(6000);
  });
});

describe('outcome previews: what the tiles show', () => {
  // The gem in the owner's 2026-10-28 screenshot of his advisor: c10 chaos, willpower 4, chaos
  // points 4, Boss Damage 5, Additional Damage 4. His page read it A 84.0, and Chaos Points +1 -> S-.
  const screenshot: AdvisorConfig = {
    baseCost: 10,
    gemType: 'chaos',
    willpowerLevel: 4,
    orderLevel: 4,
    effect1: 'Boss Damage',
    effect1Level: 5,
    effect2: 'Additional Damage',
    effect2Level: 4,
  };

  it('reads the screenshot gem and its points raise the way his page does', () => {
    expect(gradeConfig(screenshot, 'dps')).toEqual({ grade: 84, rank: 'A' });
    expect(previewOutcome(screenshot, { type: 'raise_effect', target: 'order', amount: 1 }, 'dps')).toEqual({
      kind: 'grade',
      grade: 92.5,
      rank: 'S-',
      delta: 8.5,
    });
  });

  it('shows no change for a raise the axis does not value, even though the game shows a green arrow', () => {
    const brand: AdvisorConfig = { ...screenshot, effect2: 'Brand Power', effect2Level: 2 };
    const pv = previewOutcome(brand, { type: 'raise_effect', target: 'effect2', amount: 2 }, 'dps');
    expect(pv).toMatchObject({ kind: 'grade', delta: 0 });
    // The same tile is a real raise on the support axis, where Brand Power counts.
    const sup = previewOutcome(brand, { type: 'raise_effect', target: 'effect2', amount: 2 }, 'support');
    expect(sup.kind === 'grade' && sup.delta > 0).toBe(true);
  });

  it('shows no change for a raise on a line already at 5, and a drop for a lower', () => {
    expect(previewOutcome(screenshot, { type: 'raise_effect', target: 'effect1', amount: 1 }, 'dps')).toMatchObject({
      kind: 'grade',
      delta: 0,
    });
    const lower = previewOutcome(screenshot, { type: 'lower_effect', target: 'effect1', amount: 1 }, 'dps');
    expect(lower.kind === 'grade' && lower.delta < 0).toBe(true);
  });

  it('gives both landings of an effect change, lowest first, keeping the replaced level', () => {
    expect(effectChangeCandidates(screenshot)).toEqual(['Brand Power', 'Ally Attack Enh.']);
    const pv = previewOutcome(screenshot, { type: 'change_side_option', target: 'effect1' }, 'dps');
    if (pv.kind !== 'split') throw new Error(`expected a split, got ${pv.kind}`);
    // Boss Damage 5 swapped for a line DPS does not value: both landings drop, by the same amount.
    expect(pv.landings.map((l) => l.effect).sort()).toEqual(['Ally Attack Enh.', 'Brand Power']);
    expect(pv.landings.every((l) => l.delta < 0)).toBe(true);
    expect(pv.landings[0].grade).toBe(pv.landings[1].grade);
    const kept = applyOutcomeToConfig(screenshot, { type: 'change_side_option', target: 'effect1' }, 'Brand Power');
    expect(kept).toMatchObject({ effect1: 'Brand Power', effect1Level: 5 });
  });

  it('never swaps in an effect the gem already carries or one outside the pool', () => {
    const o: AdvisorOutcome = { type: 'change_side_option', target: 'effect1' };
    expect(applyOutcomeToConfig(screenshot, o, 'Additional Damage')).toEqual(screenshot);
    expect(applyOutcomeToConfig(screenshot, o, 'Attack Power')).toEqual(screenshot); // a c8/c9 line
  });

  it('renders nothing for an unset tile or a gem the scorer cannot grade', () => {
    expect(previewOutcome(screenshot, { type: 'do_nothing' }, 'dps')).toEqual({ kind: 'none' });
    const unknown: AdvisorConfig = { ...screenshot, effect2: 'Crit Rate' };
    expect(gradeConfig(unknown, 'dps')).toBeNull();
    expect(previewOutcome(unknown, { type: 'raise_effect', target: 'order', amount: 1 }, 'dps')).toEqual({
      kind: 'none',
    });
  });
});
