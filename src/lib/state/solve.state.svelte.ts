import { toast } from '@zerodevx/svelte-toast';

import type { AppLocale } from '../constants/enums';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
import { overallPercent } from '../solver/progress';
import { solveInputSignature } from '../solver/solveSignature';
import { SolverController } from '../solver/solverController';
import type { SolverProgress, SolverProgressStage } from '../solver/types';
import { appLocale } from './locale.state.svelte';
import {
  type BuildRole,
  type CharacterProfile,
  buildState,
  getCurrentProfile,
  setBuildEndgame,
  setBuildSolveAfter,
} from './profile.state.svelte';

// Module-singleton solver + ephemeral solve/progress state, shared so Gem Triage's refresh button
// triggers a solve and every panel (triage progress bar, gem-pool lock) observes the same state.
const controller = new SolverController();

export const solveState = $state<{
  isSolving: boolean;
  progress: SolverProgress | null;
}>({
  isSolving: false,
  progress: null,
});

type SolvePassKind = 'live' | 'perfect';
type SolvePass = { kind: SolvePassKind; role: BuildRole };

// A full analysis runs a sequence of worker solves (live per role, then the perfect-grid pass per
// role); each emits its own 0→100% sweep. `activePass` tells the progress handler which pass in
// that sequence is currently reporting, so it can remap the per-pass percentage onto one monotonic
// overall bar. It's safe as a module singleton because passes run strictly sequentially (each is
// awaited) and the worker rejects a second concurrent solve.
let activePass: { index: number; total: number } | null = null;

controller.onProgress = (progress: SolverProgress) => {
  const ctx = activePass;
  const totalPercent = ctx
    ? overallPercent(ctx.index, ctx.total, progress.totalPercent)
    : progress.totalPercent;
  solveState.progress = { ...progress, totalPercent };
};

function buildAssignedGems(
  profile: CharacterProfile,
  assignedGemIndexes: number[][]
): ArkGridGem[][] {
  const orderGems = profile.gems.orderGems;
  const chaosGems = profile.gems.chaosGems;
  const gemPools = [orderGems, orderGems, orderGems, chaosGems, chaosGems, chaosGems];

  return assignedGemIndexes.map((indexes, coreIndex) =>
    indexes.map(
      (gemIndex) => JSON.parse(JSON.stringify(gemPools[coreIndex][gemIndex])) as ArkGridGem
    )
  );
}

// The pool's gem fingerprints in position order. `sig` ignores order, but a result's gem indexes are
// positions, so a pool swapped for the same gems in another order must also count as changed.
function gemPoolOrder(profile: CharacterProfile): string {
  return JSON.stringify([
    profile.gems.orderGems.map(gemFingerprint),
    profile.gems.chaosGems.map(gemFingerprint),
  ]);
}

// A pass's result indexes into the exact pool it was sent and is written into the current profile,
// so it is only kept when the user has not switched profile or edited this build's cores or the gem
// pool (including its order) while the worker ran. Otherwise nothing is written: the old result
// stays and shows stale.
function solvedInputsUnchanged(
  profile: CharacterProfile,
  role: BuildRole,
  sig: string,
  poolOrder: string
): boolean {
  return (
    profile === getCurrentProfile() &&
    solveInputSignature(buildState(role, profile).cores, profile.gems) === sig &&
    gemPoolOrder(profile) === poolOrder
  );
}

export function getProgressLabel(progress: SolverProgress | null) {
  if (!progress) {
    return '';
  }

  const locale = appLocale.current;
  const LProgressStage: Record<AppLocale, Record<SolverProgressStage, string>> = {
    en_us: {
      preparing: 'Preparing inputs',
      searching_order_packs: 'Searching for Order combinations',
      searching_chaos_packs: 'Searching for Chaos combinations',
      combining_results: 'Merging both combinations',
      finalizing: 'Finalizing result',
    },
  };
  return LProgressStage[locale][progress.stage];
}

async function solveOne(profile: CharacterProfile, role: BuildRole) {
  const sig = solveInputSignature(buildState(role, profile).cores, profile.gems);
  const poolOrder = gemPoolOrder(profile);
  const result = await controller.runSolve(profile, role);
  if (!solvedInputsUnchanged(profile, role, sig, poolOrder)) return;

  setBuildSolveAfter(role, {
    solveAnswer: {
      assignedGems: buildAssignedGems(profile, result.assignedGemIndexes),
    },
    scoreSet: result.scoreSet,
    inputSig: sig,
  });
}

async function solveEndgame(profile: CharacterProfile, role: BuildRole) {
  const sig = solveInputSignature(buildState(role, profile).cores, profile.gems);
  const poolOrder = gemPoolOrder(profile);
  const result = await controller.runSolve(profile, role, { endgame: true });
  if (!solvedInputsUnchanged(profile, role, sig, poolOrder)) return;
  setBuildEndgame(role, {
    assignedGems: buildAssignedGems(profile, result.assignedGemIndexes),
    inputSig: sig,
  });
}

export async function runSolve(profile: CharacterProfile) {
  if (solveState.isSolving) return;

  solveState.isSolving = true;
  solveState.progress = { stage: 'preparing', totalPercent: 0, stagePercent: 0 };

  // Dual-role characters solve both builds (they share one gem pool, so triage/cutplan can see what
  // each build leverages); single-role solves the active build only. The live passes run first (they
  // produce the displayed result), then the perfect-grid (all-Ancient) passes that feed triage. All
  // passes are treated as slices of one progress bar so it climbs 0→100% once instead of per pass.
  const roles: BuildRole[] = profile.dualRole ? ['dps', 'support'] : [profile.activeBuild];
  const passes: SolvePass[] = [
    ...roles.map((role): SolvePass => ({ kind: 'live', role })),
    ...roles.map((role): SolvePass => ({ kind: 'perfect', role })),
  ];

  // Tracks a worker crash / rejection so the finally block leaves the bar stalled instead of
  // sweeping it to 100%; the toast below is the user-facing failure signal.
  let failed = false;
  try {
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      activePass = { index: i, total: passes.length };
      if (pass.kind === 'live') {
        await solveOne(profile, pass.role);
      } else {
        await solveEndgame(profile, pass.role);
      }
    }
  } catch (error) {
    console.error(error);
    failed = true;
    toast.push('Analysis failed. Please run it again.', {
      theme: {
        '--toastBackground': '#8a3a3a',
        '--toastColor': '#fff',
        '--toastBarBackground': '#5a2525',
      },
    });
  } finally {
    activePass = null;
    solveState.isSolving = false;
    // Only mark the bar complete on success. On failure, leave it where it stalled; forcing 100%
    // "Finalizing" would masquerade a crash as a finished (but stale) solve.
    if (solveState.progress && !failed) {
      solveState.progress = {
        ...solveState.progress,
        stage: 'finalizing',
        totalPercent: 100,
        stagePercent: 100,
      };
    }
  }
}
