import { describe, expect, it } from 'vitest';

import type { ArkGridGem, ArkGridGemOptionName } from '../models/arkGridGems';
import { runSolve } from './solverWorker';
import type { SolverRunPayload, WorkerCore } from './types';

// A monotonic point→coeff ramp so core points genuinely matter; the exact values are incidental to
// the equivalence under test (that skipping the extras leaves the assignment untouched).
function core(energy: number, point: number): WorkerCore {
  return { energy, point, coeff: Array.from({ length: 21 }, (_, p) => p * 60) };
}

function gem(
  gemAttr: 'Order' | 'Chaos',
  req: number,
  point: number,
  o1: ArkGridGemOptionName,
  v1: number,
  o2: ArkGridGemOptionName,
  v2: number
): ArkGridGem {
  return {
    gemAttr,
    req,
    point,
    option1: { optionType: o1, value: v1 },
    option2: { optionType: o2, value: v2 },
  };
}

// Under-saturated all-Ancient (energy-17) cores with only a few gems each: mirrors the endgame pass
// and leaves cores short of their 17-point cap, so the full run has real launcher-gem work to skip.
const payload: SolverRunPayload = {
  orderCores: [core(17, 0), core(17, 0), core(17, 0)],
  chaosCores: [core(17, 0), core(17, 0), core(17, 0)],
  orderGems: [
    gem('Order', 3, 5, 'AtkPower', 5, 'AddDamage', 5),
    gem('Order', 4, 5, 'AddDamage', 5, 'BossDamage', 5),
    gem('Order', 5, 4, 'AtkPower', 3, 'BossDamage', 4),
    gem('Order', 6, 5, 'AtkPower', 5, 'AddDamage', 3),
  ],
  chaosGems: [
    gem('Chaos', 3, 5, 'AtkPower', 5, 'BossDamage', 5),
    gem('Chaos', 4, 4, 'AddDamage', 4, 'BossDamage', 4),
    gem('Chaos', 5, 5, 'AtkPower', 4, 'AddDamage', 5),
  ],
  isSupporter: false,
};

const noop = () => {};

describe('runSolve assignmentOnly', () => {
  it('produces the same gem assignment as a full solve', () => {
    const full = runSolve(payload, noop);
    const assignmentOnly = runSolve({ ...payload, assignmentOnly: true }, noop);
    // The assignment is what the endgame pass consumes; skipping the score/launcher work must not
    // change it.
    expect(assignmentOnly.assignedGemIndexes).toEqual(full.assignedGemIndexes);
    expect(assignmentOnly.needLauncherGem).toEqual(full.needLauncherGem);
  });

  it('the full run actually has launcher-gem work to skip (non-vacuity)', () => {
    // If the cores were already saturated, the full run would skip the simulation too and the
    // equivalence above would be trivial. This proves the skipped path was live.
    const full = runSolve(payload, noop);
    expect(full.needLauncherGem.Order || full.needLauncherGem.Chaos).toBe(true);
  });

  it('zeroes the fields the endgame pass discards', () => {
    const assignmentOnly = runSolve({ ...payload, assignmentOnly: true }, noop);
    expect(assignmentOnly.scoreSet).toEqual({ score: 0, bestScore: 0, perfectScore: 0 });
    expect(assignmentOnly.additionalGemResult).toEqual({ Order: {}, Chaos: {} });
  });
});
