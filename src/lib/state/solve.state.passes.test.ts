import { describe, expect, it, vi } from 'vitest';

import { solveInputSignature } from '../solver/solveSignature';
import { addNewProfile } from './appConfig.state.svelte';
import {
  type BuildRole,
  addGem,
  getCurrentProfile,
  initNewProfile,
  setCurrentProfileName,
  setDualRole,
} from './profile.state.svelte';
import { runSolve } from './solve.state.svelte';

// Guards the locked "Optimize runs the full solve" decision: every run must do the live solve AND
// the all-Ancient endgame solve for each build, in that order, and stamp both with a fresh inputSig.
const { solveMock } = vi.hoisted(() => ({
  // One Order gem in the pool, so slot 0 index 0 is the only valid assignment.
  solveMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    assignedGemIndexes: [[0], [], [], [], [], []],
    gemSetPackTuple: {},
    scoreSet: {},
  })),
}));
// A constructor returning a plain object, not a class: a class field named `runSolve` here makes
// Vitest's mock hoisting treat it as the imported runSolve and read that import too early.
vi.mock('../solver/solverController', () => ({
  SolverController: function SolverController() {
    return { onProgress: null, runSolve: solveMock };
  },
}));
vi.mock('@zerodevx/svelte-toast', () => ({ toast: { push: vi.fn() } }));

async function runFor(name: string, dualRole: boolean) {
  addNewProfile(initNewProfile(name));
  setCurrentProfileName(name);
  addGem({
    gemAttr: 'Order',
    req: 5,
    point: 5,
    option1: { optionType: 'AtkPower', value: 5 },
    option2: { optionType: 'AddDamage', value: 5 },
  });
  setDualRole(dualRole);
  solveMock.mockClear();
  const profile = getCurrentProfile();
  await runSolve(profile);
  const calls = solveMock.mock.calls.map(([, role, opts]) => [
    role,
    !!(opts as { endgame?: boolean } | undefined)?.endgame,
  ]);
  return { profile, calls };
}

function expectFreshSigs(profile: ReturnType<typeof getCurrentProfile>, roles: BuildRole[]) {
  for (const role of roles) {
    const build = profile.builds[role];
    const sig = solveInputSignature(build.cores, profile.gems);
    expect(build.solveInfo.after?.inputSig).toBe(sig);
    expect(build.solveInfo.endgame?.inputSig).toBe(sig);
  }
}

describe('runSolve pass sequence', () => {
  it('runs live then endgame for both builds of a dual-role profile', async () => {
    const { profile, calls } = await runFor('passes-dual', true);
    expect(calls).toEqual([
      ['dps', false],
      ['support', false],
      ['dps', true],
      ['support', true],
    ]);
    expectFreshSigs(profile, ['dps', 'support']);
  });

  it('runs live then endgame for the active build of a single-role profile', async () => {
    const { profile, calls } = await runFor('passes-single', false);
    expect(calls).toEqual([
      ['dps', false],
      ['dps', true],
    ]);
    expectFreshSigs(profile, ['dps']);
  });
});
