// Drift guard for the Cut Advisor's per-outcome grade previews (outcomePreview.ts). Every preview must
// land exactly where the advice lands it: the worker snaps each outcome with the vendored constraintSnap
// (ocr/engine.js), then the DP applies it with dp.js outcomeBranchesActual (nested.js applyOutcome),
// and the landing is graded exactly as the vendored astrogem.js grades it, on both axes. If this fails
// after a re-sync, upstream changed how an outcome resolves or how a gem grades: port the change into
// outcomePreview.ts / gemScore.ts rather than loosening the test.
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
  snapOutcome,
  standingAgainst,
  tilePreview,
} from './outcomePreview';

const require = createRequire(import.meta.url);
const A = require('./vendor/model/astrogem.js');
const DP = require('./vendor/model/dp.js');
const E = require('./vendor/ocr/engine.js');

const ROLES: GemRole[] = ['dps', 'support'];
const hisGrade = (c: AdvisorConfig, role: GemRole): number =>
  role === 'dps' ? A.grade(c) : A.supportGrade(c);
const hisRank = (g: number, role: GemRole): string =>
  role === 'dps' ? A.rankFromGrade(g) : A.supportRankFromGrade(g);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Every outcome shape a tile can carry, plus the malformed ones the snap repairs: lowers past -1 (the
 * dropdown editor once offered -2..-4), raise amounts outside 1..4 or missing, unknown targets, and an
 * Effect Changed with no or a non-effect target (left behind by switching a tile's type).
 */
const OUTCOMES: AdvisorOutcome[] = [
  ...['willpower', 'order', 'effect1', 'effect2'].flatMap((target) => [
    ...[1, 2, 3, 4].map((amount) => ({ type: 'raise_effect', target, amount })),
    ...[1, 2, 3, 4].map((amount) => ({ type: 'lower_effect', target, amount })),
  ]),
  { type: 'raise_effect', target: 'order', amount: 7 },
  { type: 'raise_effect', target: 'effect2', amount: 0 },
  { type: 'raise_effect', target: 'effect1' },
  { type: 'raise_effect', target: 'toString', amount: 2 },
  { type: 'lower_effect', target: 'bogus', amount: 3 },
  { type: 'change_side_option', target: 'effect1' },
  { type: 'change_side_option', target: 'effect2' },
  { type: 'change_side_option' },
  { type: 'change_side_option', target: 'order' },
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

/** The outcome as the worker hands it to the DP: through the vendored constraintSnap. */
function hisSnap(cfg: AdvisorConfig, o: AdvisorOutcome): AdvisorOutcome {
  const snapped = E.constraintSnap({
    config: cfg,
    state: { currentTurn: 1, maxTurns: 9, rerollsRemaining: 3, processCostMultiplier: 0 },
    outcomes: [o],
  });
  expect(snapped.config).toEqual(cfg); // a legal gem passes the snap untouched
  return snapped.outcomes[0];
}

interface Branch {
  config: AdvisorConfig;
  dCm: number;
  dRerolls: number;
  w: number;
}

describe('outcome previews match the vendored snap, DP transitions and grades', () => {
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

  it('snaps every outcome shape the way the vendored constraintSnap does', () => {
    const cfg = sweepConfigs()[0];
    for (const o of OUTCOMES) {
      const his = hisSnap(cfg, o);
      const ours = snapOutcome(o);
      expect(ours.type).toBe(his.type);
      expect(ours.target).toBe(his.target);
      expect(ours.amount).toBe(his.amount);
      expect(ours.change).toBe(his.change);
    }
  });

  it('lands every outcome where the DP lands it', () => {
    let checked = 0;
    for (const cfg of sweepConfigs())
      for (const o of OUTCOMES) {
        const snapped = hisSnap(cfg, o);
        const branches: Branch[] = DP.outcomeBranchesActual(cfg, snapped);
        for (const role of ROLES) {
          const now = hisGrade(cfg, role);
          const pv = previewOutcome(cfg, o, role);
          if (snapped.type === 'raise_effect' || snapped.type === 'lower_effect') {
            expect(branches).toHaveLength(1);
            const next = branches[0].config;
            expect(applyOutcomeToConfig(cfg, snapOutcome(o))).toEqual(next);
            const g = hisGrade(next, role);
            expect(pv).toEqual({ kind: 'grade', grade: g, rank: hisRank(g, role), delta: round1(g - now) });
          } else if (snapped.type === 'change_side_option') {
            // The DP fans an unnamed effect change evenly over the candidates; ours shows each one.
            const slot = snapped.target === 'effect2' ? 'effect2' : 'effect1';
            expect(branches).toHaveLength(2);
            for (const b of branches) {
              expect(b.w).toBe(0.5);
              expect(applyOutcomeToConfig(cfg, snapped, b.config[slot])).toEqual(b.config);
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
            expect(pv).toEqual({ kind: snapped.type === 'do_nothing' ? 'none' : 'unchanged' });
          }
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(9000);
  });
});

// The gem in the owner's 2026-10-28 screenshot of his advisor: c10 chaos, willpower 4, chaos points 4,
// Boss Damage 5, Additional Damage 4. His page read it A 84.0, and Chaos Points +1 -> S- 92.5.
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

describe('outcome previews: what the tiles show', () => {
  it('reads the screenshot gem and its points raise the way his page does', () => {
    expect(gradeConfig(screenshot, 'dps')).toEqual({ grade: 84, rank: 'A' });
    expect(previewOutcome(screenshot, { type: 'raise_effect', target: 'order', amount: 1 }, 'dps')).toEqual({
      kind: 'grade',
      grade: 92.5,
      rank: 'S-',
      delta: 8.5,
    });
    expect(tilePreview(screenshot, { type: 'raise_effect', target: 'order', amount: 1 }, 'dps')).toEqual({
      kind: 'grade',
      rank: 'S-',
      grade: '92.5',
      dir: 'up',
      label: 'If this lands: 92.5 (S-), up 8.5 from 84.0 (A).',
    });
  });

  it('a lower is always -1, however much the tile asks for', () => {
    const asked = previewOutcome(screenshot, { type: 'lower_effect', target: 'effect1', amount: 3 }, 'dps');
    const one = previewOutcome(screenshot, { type: 'lower_effect', target: 'effect1', amount: 1 }, 'dps');
    expect(asked).toEqual(one);
    expect(tilePreview(screenshot, { type: 'lower_effect', target: 'effect1', amount: 1 }, 'dps')).toMatchObject({
      dir: 'down',
      label: expect.stringMatching(/^If this lands: \d+\.\d \([A-F][+-]?\), down \d+\.\d from 84\.0 \(A\)\.$/),
    });
  });

  it('says why a raise changes nothing: a line the axis does not value, or one already at its limit', () => {
    const brand: AdvisorConfig = { ...screenshot, effect2: 'Brand Power', effect2Level: 2 };
    expect(tilePreview(brand, { type: 'raise_effect', target: 'effect2', amount: 2 }, 'dps')).toMatchObject({
      kind: 'grade',
      dir: 'same',
      label: expect.stringMatching(/that line does not count for DPS\.$/),
    });
    // The same tile is a real raise on the support axis, where Brand Power counts.
    expect(tilePreview(brand, { type: 'raise_effect', target: 'effect2', amount: 2 }, 'support')).toMatchObject({
      dir: 'up',
    });
    expect(tilePreview(screenshot, { type: 'raise_effect', target: 'effect1', amount: 1 }, 'dps')).toMatchObject({
      dir: 'same',
      label: 'No change: the gem stays 84.0 (A), that line is already at its limit.',
    });
    const floor: AdvisorConfig = { ...screenshot, orderLevel: 1 };
    expect(tilePreview(floor, { type: 'lower_effect', target: 'order', amount: 1 }, 'dps')).toMatchObject({
      dir: 'same',
      label: expect.stringMatching(/already at its limit\.$/),
    });
  });

  it('shows one grade when both possible new effects land the same, and both when they differ', () => {
    expect(effectChangeCandidates(screenshot)).toEqual(['Brand Power', 'Ally Attack Enh.']);
    // Boss Damage 5 swapped for a line DPS does not value: both landings drop, by the same amount.
    const same = tilePreview(screenshot, { type: 'change_side_option', target: 'effect1' }, 'dps');
    expect(same).toMatchObject({
      kind: 'grade',
      dir: 'down',
      label: expect.stringMatching(/^The new effect is random, and either one \(Brand Power or Ally Attack Enh\.\) lands /),
    });
    // Two DPS-dead lines on a c9: the change rolls Attack Power or Boss Damage, two different raises.
    const dead: AdvisorConfig = {
      ...screenshot,
      baseCost: 9,
      effect1: 'Ally Damage Enh.',
      effect1Level: 3,
      effect2: 'Ally Attack Enh.',
      effect2Level: 2,
    };
    const split = tilePreview(dead, { type: 'change_side_option', target: 'effect1' }, 'dps');
    if (split?.kind !== 'split') throw new Error(`expected a split, got ${split?.kind}`);
    expect(split.values.map((v) => v.dir)).toEqual(['up', 'up']);
    expect(Number(split.values[0].grade)).toBeLessThan(Number(split.values[1].grade));
    expect(split.label).toMatch(/^The new effect is random \(even odds\): Attack Power lands .*; Boss Damage lands /);
    const kept = applyOutcomeToConfig(dead, { type: 'change_side_option', target: 'effect1' }, 'Boss Damage');
    expect(kept).toMatchObject({ effect1: 'Boss Damage', effect1Level: 3 });
  });

  it('reads cost and reroll tiles as no change to the gem, and shows nothing for an unset tile', () => {
    expect(tilePreview(screenshot, { type: 'change_gold_cost', change: 100 }, 'dps')).toEqual({
      kind: 'unchanged',
      label: 'Changes the processing cost, not the gem: it stays 84.0 (A).',
    });
    expect(tilePreview(screenshot, { type: 'reroll_increase', change: 1 }, 'dps')).toEqual({
      kind: 'unchanged',
      label: 'Adds rerolls, not the gem: it stays 84.0 (A).',
    });
    expect(tilePreview(screenshot, { type: 'do_nothing' }, 'dps')).toBeNull();
  });

  it('never swaps in an effect the gem already carries or one outside the pool', () => {
    const o: AdvisorOutcome = { type: 'change_side_option', target: 'effect1' };
    expect(applyOutcomeToConfig(screenshot, o, 'Additional Damage')).toEqual(screenshot);
    expect(applyOutcomeToConfig(screenshot, o, 'Attack Power')).toEqual(screenshot); // a c8/c9 line
  });

  it('renders nothing for a gem the scorer cannot grade', () => {
    const unknown: AdvisorConfig = { ...screenshot, effect2: 'Crit Rate' };
    expect(gradeConfig(unknown, 'dps')).toBeNull();
    expect(previewOutcome(unknown, { type: 'raise_effect', target: 'order', amount: 1 }, 'dps')).toEqual({
      kind: 'none',
    });
    expect(tilePreview(unknown, { type: 'raise_effect', target: 'order', amount: 1 }, 'dps')).toBeNull();
    expect(standingAgainst(unknown, 86.7, 'dps')).toBeNull();
  });
});

describe('standing against the baseline', () => {
  it('reports the gap above, below or at the baseline, with the baseline rank on its own axis', () => {
    expect(standingAgainst(screenshot, 86.7, 'dps')).toEqual({
      now: { grade: 84, rank: 'A' },
      baseline: { grade: 86.7, rank: 'A+' },
      gap: -2.7,
      dir: 'down',
      text: '2.7 below baseline',
    });
    expect(standingAgainst(screenshot, 60, 'dps')).toMatchObject({ gap: 24, dir: 'up', text: '24.0 above baseline' });
    expect(standingAgainst(screenshot, 84, 'dps')).toMatchObject({ gap: 0, dir: 'same', text: 'at baseline' });
    // Support grades the same gem on its own scale and ranks the baseline on the support ladder.
    const sup = standingAgainst(screenshot, 94.6, 'support');
    expect(sup).toMatchObject({ now: { grade: 48.7 }, baseline: { rank: 'S+' }, dir: 'down' });
  });
});
