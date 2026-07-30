import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { solveInputSignature } from '../solver/solveSignature';
import { initBuildCores } from './dualBuild';
import type { CharacterProfile } from './profile.state.svelte';
import { isSolveNeverRun, isSolveStale } from './solveStale';

const gem: ArkGridGem = {
  gemAttr: 'Order',
  req: 5,
  point: 5,
  option1: { optionType: 'AtkPower', value: 5 },
  option2: { optionType: 'AddDamage', value: 5 },
};

// Hand-rolled (mirrors initNewProfile) rather than imported: pulling profile.state.svelte in at
// runtime before appConfig.state.svelte trips their module cycle under Vitest.
function makeProfile(name: string): CharacterProfile {
  return {
    characterName: name,
    gems: { orderGems: [], chaosGems: [] },
    builds: {
      dps: { cores: initBuildCores(false), solveInfo: {} },
      support: { cores: initBuildCores(true), solveInfo: {} },
    },
    activeBuild: 'dps',
    dualRole: false,
  };
}

/** A profile whose active (dps) build has solves stamped with its CURRENT input signature. */
function freshlySolvedProfile(name: string): CharacterProfile {
  const p = makeProfile(name);
  p.gems.orderGems.push(gem);
  const sig = solveInputSignature(p.builds.dps.cores, p.gems);
  p.builds.dps.solveInfo.after = { inputSig: sig };
  p.builds.dps.solveInfo.endgame = { assignedGems: [[gem], [], [], [], [], []], inputSig: sig };
  return p;
}

describe('isSolveStale', () => {
  it('is not stale when nothing has ever been solved', () => {
    expect(isSolveStale(makeProfile('never-solved'))).toBe(false);
  });

  it('is not stale when the stored signatures match the live inputs', () => {
    expect(isSolveStale(freshlySolvedProfile('fresh'))).toBe(false);
  });

  it('is stale when the gem pool changed after the solve', () => {
    const p = freshlySolvedProfile('gems-changed');
    p.gems.chaosGems.push({ ...gem, gemAttr: 'Chaos' });
    expect(isSolveStale(p)).toBe(true);
  });

  it('is stale when only the endgame solve is out of date', () => {
    const p = freshlySolvedProfile('endgame-stale');
    p.builds.dps.solveInfo.endgame!.inputSig = 'stale-sig';
    expect(isSolveStale(p)).toBe(true);
  });

  it('never reads a pre-signature solve (no inputSig) as stale', () => {
    const p = makeProfile('pre-sig');
    p.builds.dps.solveInfo.after = {};
    expect(isSolveStale(p)).toBe(false);
  });

  it('ignores the inactive build for a single-role profile', () => {
    const p = freshlySolvedProfile('single-role');
    p.builds.support.solveInfo.after = { inputSig: 'stale-sig' };
    expect(isSolveStale(p)).toBe(false);
  });

  it('counts the inactive build for a dual-role profile', () => {
    const p = freshlySolvedProfile('dual-role');
    p.dualRole = true;
    p.builds.support.solveInfo.after = { inputSig: 'stale-sig' };
    expect(isSolveStale(p)).toBe(true);
  });
});

describe('isSolveNeverRun', () => {
  it('is true when gems exist but the active build has never been solved', () => {
    const p = makeProfile('gems-no-solve');
    p.gems.orderGems.push(gem);
    expect(isSolveNeverRun(p)).toBe(true);
  });

  it('is false when there are no gems to solve', () => {
    expect(isSolveNeverRun(makeProfile('empty'))).toBe(false);
  });

  it('is false once the active build has a live solve', () => {
    const p = makeProfile('has-after');
    p.gems.orderGems.push(gem);
    p.builds.dps.solveInfo.after = {};
    expect(isSolveNeverRun(p)).toBe(false);
  });

  it('is false once the active build has an endgame solve', () => {
    const p = makeProfile('has-endgame');
    p.gems.orderGems.push(gem);
    p.builds.dps.solveInfo.endgame = { assignedGems: [[], [], [], [], [], []], inputSig: 's' };
    expect(isSolveNeverRun(p)).toBe(false);
  });

  it('looks at the active build, not the other one', () => {
    const p = makeProfile('other-build-solved');
    p.gems.orderGems.push(gem);
    p.builds.support.solveInfo.after = {};
    expect(isSolveNeverRun(p)).toBe(true);
  });
});
