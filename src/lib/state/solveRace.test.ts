import { describe, expect, it, vi } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { solveKeyCounts } from '../scoring/triage';
import { addNewProfile, getProfile } from './appConfig.state.svelte';
import {
  addGem,
  clearGems,
  getCurrentProfile,
  initNewProfile,
  setCurrentProfileName,
} from './profile.state.svelte';
import { runSolve } from './solve.state.svelte';

// A solve result must only be written against the profile and inputs it was computed from. Each fake
// worker pass returns a promise the test resolves by hand, so the test can edit the pool or switch
// profile while a pass is in flight.
const { pending, solveMock } = vi.hoisted(() => {
  const pending: ((r: unknown) => void)[] = [];
  return {
    pending,
    solveMock: () => new Promise((resolve) => pending.push(resolve)),
  };
});
// A constructor returning a plain object, not a class: a class field named `runSolve` here makes
// Vitest's mock hoisting treat it as the imported runSolve and read that import too early.
vi.mock('../solver/solverController', () => ({
  SolverController: function SolverController() {
    return { onProgress: null, runSolve: solveMock };
  },
}));
vi.mock('@zerodevx/svelte-toast', () => ({ toast: { push: vi.fn() } }));

const flush = () => new Promise((r) => setTimeout(r, 0));
// Worker result slotting the given Order-pool indexes into Order Sun (single-role, dps build).
const result = (orderSunIndexes: number[]) => ({
  assignedGemIndexes: [orderSunIndexes, [], [], [], [], []],
  scoreSet: {},
});
const gem = (a: number): ArkGridGem => ({
  gemAttr: 'Order',
  req: 4,
  point: a,
  option1: { optionType: 'AtkPower', value: a },
  option2: { optionType: 'AddDamage', value: a },
});
// Resolve the next in-flight worker pass, then let runSolve move on to the next one.
async function resolveNext(orderSunIndexes: number[]) {
  await flush();
  pending.shift()!(result(orderSunIndexes));
  await flush();
}

describe('runSolve writes nothing when its inputs changed mid-solve', () => {
  it('pool replaced during the endgame pass: the endgame result is not written', async () => {
    addNewProfile(initNewProfile('race-replace'));
    setCurrentProfileName('race-replace');
    addGem(gem(5)); // index 0: the gem both passes slot
    addGem(gem(1));
    const run = runSolve(getCurrentProfile());
    await resolveNext([0]); // live pass, inputs unchanged
    // Endgame pass in flight: Apply in Recognized Astrogems replaces the pool (not locked by a solve).
    clearGems('Order');
    addGem(gem(2)); // new index 0
    addGem(gem(5));
    await resolveNext([0]); // endgame solved the OLD pool, where index 0 was the point-5 gem
    await run;
    const build = getCurrentProfile().builds.dps;
    expect(build.solveInfo.after).toBeDefined(); // written before the edit; now shows stale
    expect(build.solveInfo.endgame).toBeUndefined();
  });

  it('pool reordered during the endgame pass: the endgame result is not written', async () => {
    addNewProfile(initNewProfile('race-reorder'));
    setCurrentProfileName('race-reorder');
    addGem(gem(5)); // index 0: the gem both passes slot
    addGem(gem(1));
    const run = runSolve(getCurrentProfile());
    await resolveNext([0]); // live pass, inputs unchanged
    // Endgame pass in flight: Apply replaces the pool with the same gems in reversed order, so the
    // staleness signature (order-independent) still matches but index 0 is now the point-1 gem.
    clearGems('Order');
    addGem(gem(1));
    addGem(gem(5));
    await resolveNext([0]); // endgame solved the OLD order, where index 0 was the point-5 gem
    await run;
    const build = getCurrentProfile().builds.dps;
    expect(build.solveInfo.after).toBeDefined();
    expect(build.solveInfo.endgame).toBeUndefined();
  });

  it('pool shrunk during the live pass: no gem-less slot is persisted', async () => {
    addNewProfile(initNewProfile('race-shrink'));
    setCurrentProfileName('race-shrink');
    addGem(gem(1));
    addGem(gem(2));
    addGem(gem(3));
    const run = runSolve(getCurrentProfile());
    await flush();
    clearGems('Order'); // Apply a smaller scan while the live pass is in flight
    addGem(gem(4));
    await resolveNext([2]); // index 2 existed only in the pool that was sent
    await resolveNext([0]); // the endgame pass was sent the new one-gem pool
    await run;
    const info = getCurrentProfile().builds.dps.solveInfo;
    expect(info.after).toBeUndefined();
    expect(info.endgame?.assignedGems[0]).toEqual([expect.objectContaining({ point: 4 })]);
    expect(() => solveKeyCounts(info.endgame!.assignedGems)).not.toThrow();
  });

  it('profile switched mid-solve: the other profile is left untouched', async () => {
    addNewProfile(initNewProfile('race-A'));
    addNewProfile(initNewProfile('race-B'));
    setCurrentProfileName('race-A');
    addGem(gem(3));
    const run = runSolve(getCurrentProfile());
    await flush();
    setCurrentProfileName('race-B');
    await resolveNext([0]);
    await resolveNext([0]);
    await run;
    expect(getProfile('race-B')!.builds.dps.solveInfo.after).toBeUndefined();
    expect(getProfile('race-B')!.builds.dps.solveInfo.endgame).toBeUndefined();
    expect(getProfile('race-A')!.builds.dps.solveInfo.after).toBeUndefined();
  });
});
