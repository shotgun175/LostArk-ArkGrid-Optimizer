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
  setBuildEndgame,
  setBuildSolveAfter,
} from './profile.state.svelte';

// Module-singleton solver + ephemeral solve/progress state, shared across panels so any panel
// (SolvePanel, Gem Triage) can trigger a solve and observe the same progress.
const controller = new SolverController();

export const solveState = $state<{
  isSolving: boolean;
  progress: SolverProgress | null;
  phaseLabel: string | null;
  progressLog: { header: string; text: string; phase: string }[];
  // Set when a solve fails (worker crash / rejection) so the UI can show a real error instead of a
  // bar that silently sweeps to 100%. Cleared at the start of each run.
  error: string | null;
}>({
  isSolving: false,
  progress: null,
  phaseLabel: null,
  progressLog: [],
  error: null,
});

type SolvePassKind = 'live' | 'perfect';
type SolvePass = { kind: SolvePassKind; role: BuildRole };

// A full optimization runs a sequence of worker solves (live per role, then the perfect-grid pass
// per role); each emits its own 0→100% sweep. `activePass` tells the progress handler which pass in
// that sequence is currently reporting, so it can remap the per-pass percentage onto one monotonic
// overall bar and label the phase. It's safe as a module singleton because passes run strictly
// sequentially (each is awaited) and the worker rejects a second concurrent solve.
let activePass: { index: number; total: number; pass: SolvePass; dual: boolean } | null = null;

function phaseLabelFor(pass: SolvePass, dual: boolean): string {
  const roleSuffix = dual ? (pass.role === 'support' ? ' — Support' : ' — DPS') : '';
  return pass.kind === 'live'
    ? `Optimizing your grid${roleSuffix}`
    : `Analyzing perfect grid (for gem triage)${roleSuffix}`;
}

controller.onProgress = (progress: SolverProgress) => {
  const ctx = activePass;
  const totalPercent = ctx
    ? overallPercent(ctx.index, ctx.total, progress.totalPercent)
    : progress.totalPercent;
  solveState.progress = { ...progress, totalPercent };

  const phase = ctx ? phaseLabelFor(ctx.pass, ctx.dual) : '';
  solveState.phaseLabel = phase || null;

  // Namespace each log row by pass index so a later pass emitting the same stage appends a fresh row
  // instead of resetting an earlier pass's row back to 0% in place.
  const header = `${ctx?.index ?? 0}:${getProgressLogKey(progress)}`;
  const text = `${progress.stagePercent}% ${getProgressLabel(progress)}`;
  const index = solveState.progressLog.findIndex((entry) => entry.header === header);

  if (index === -1) {
    solveState.progressLog = [...solveState.progressLog, { header, text, phase }];
    return;
  }

  if (solveState.progressLog[index].text === text) {
    return;
  }

  solveState.progressLog = solveState.progressLog.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, text } : entry
  );
};

function buildAssignedGems(
  profile: CharacterProfile,
  assignedGemIndexes: number[][],
  previousPerSlot: ArkGridGem[][] | undefined
): ArkGridGem[][] {
  const orderGems = profile.gems.orderGems;
  const chaosGems = profile.gems.chaosGems;
  const gemPools = [orderGems, orderGems, orderGems, chaosGems, chaosGems, chaosGems];

  return assignedGemIndexes.map((indexes, coreIndex) => {
    const newGems = indexes.map((gemIndex) => gemPools[coreIndex][gemIndex]);
    const oldGems: ArkGridGem[] = previousPerSlot?.[coreIndex] ?? [];

    if (!previousPerSlot) {
      // First solve — no previous assignment to compare against.
      return newGems.map(
        (gem) => JSON.parse(JSON.stringify({ ...gem, isNew: false })) as ArkGridGem
      );
    }

    // Build a consumable multiset of old fingerprints.
    const oldCounts = new Map<string, number>();
    for (const gem of oldGems) {
      const fp = gemFingerprint(gem);
      oldCounts.set(fp, (oldCounts.get(fp) ?? 0) + 1);
    }

    // Collect dropped gems (in old slot but not in new slot).
    const newCounts = new Map<string, number>();
    for (const gem of newGems) {
      const fp = gemFingerprint(gem);
      newCounts.set(fp, (newCounts.get(fp) ?? 0) + 1);
    }
    const remaining = new Map(oldCounts);
    for (const [fp, cnt] of newCounts) {
      const old = remaining.get(fp) ?? 0;
      if (old <= cnt) remaining.delete(fp);
      else remaining.set(fp, old - cnt);
    }
    const droppedGems: ArkGridGem[] = [];
    for (const gem of oldGems) {
      const fp = gemFingerprint(gem);
      const c = remaining.get(fp) ?? 0;
      if (c > 0) {
        droppedGems.push(gem);
        remaining.set(fp, c - 1);
      }
    }

    // Mark new gems and pair each with a dropped gem it replaced.
    let droppedIdx = 0;
    const oldCountsForNew = new Map(oldCounts);
    return newGems.map((gem) => {
      const fp = gemFingerprint(gem);
      const c = oldCountsForNew.get(fp) ?? 0;
      if (c > 0) {
        oldCountsForNew.set(fp, c - 1);
        return JSON.parse(JSON.stringify({ ...gem, isNew: false })) as ArkGridGem;
      }
      const replaces: ArkGridGem | undefined = droppedGems[droppedIdx++];
      return JSON.parse(JSON.stringify({ ...gem, isNew: true, replaces })) as ArkGridGem;
    });
  });
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
      simulating_launcher_gems: 'Simulating Next Astrogem Preview',
      finalizing: 'Finalizing result',
    },
  };
  const baseLabel = LProgressStage[locale][progress.stage];

  if (progress.stage !== 'simulating_launcher_gems' || !progress.total || !progress.current) {
    return baseLabel;
  }

  const attrLabel = {
    en_us: { Order: 'Order', Chaos: 'Chaos' },
  }[locale][progress.attr ?? 'Order'];

  return `${baseLabel} (${attrLabel} ${progress.current}/${progress.total})`;
}

export function getProgressLogKey(progress: SolverProgress | null) {
  if (!progress) return '';
  if (progress.stage !== 'simulating_launcher_gems') return progress.stage;
  return `${progress.stage}:${progress.attr ?? ''}`;
}

async function solveOne(profile: CharacterProfile, role: BuildRole) {
  // Per-slot previous assignment for isNew + replaces detection (this build's prior result).
  const previousAssigned = buildState(role, profile).solveInfo.after?.solveAnswer?.assignedGems;

  const result = await controller.runSolve(profile, role);

  const assignedGems = buildAssignedGems(profile, result.assignedGemIndexes, previousAssigned);
  let swapIdx = 1;
  for (const slotGems of assignedGems) {
    for (const gem of slotGems) {
      if (gem.isNew && gem.replaces) gem.swapIndex = swapIdx++;
    }
  }

  setBuildSolveAfter(role, {
    solveAnswer: {
      assignedGems,
      gemSetPackTuple: result.gemSetPackTuple,
    },
    scoreSet: result.scoreSet,
    answerCores: JSON.parse(JSON.stringify(buildState(role, profile).cores)),
    additionalGemResult: result.additionalGemResult,
    needLauncherGem: result.needLauncherGem,
    inputSig: solveInputSignature(buildState(role, profile).cores, profile.gems),
  });
}

async function solveEndgame(profile: CharacterProfile, role: BuildRole) {
  const result = await controller.runSolve(profile, role, { endgame: true });
  // No previous assignment to diff against — buildAssignedGems(_, _, undefined) just resolves the
  // indexes to clean gem copies (no isNew/replaces markers, which the triage does not read).
  const assignedGems = buildAssignedGems(profile, result.assignedGemIndexes, undefined);
  setBuildEndgame(role, {
    assignedGems,
    inputSig: solveInputSignature(buildState(role, profile).cores, profile.gems),
  });
}

export async function runSolve(profile: CharacterProfile) {
  if (solveState.isSolving) return;

  solveState.isSolving = true;
  solveState.progressLog = [];
  solveState.phaseLabel = null;
  solveState.error = null;
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

  try {
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      activePass = { index: i, total: passes.length, pass, dual: profile.dualRole };
      if (pass.kind === 'live') {
        await solveOne(profile, pass.role);
      } else {
        await solveEndgame(profile, pass.role);
      }
    }
  } catch (error) {
    console.error(error);
    solveState.error = 'Optimization failed. Please run it again.';
    toast.push('Optimization failed — please run it again.', {
      theme: {
        '--toastBackground': '#8a3a3a',
        '--toastColor': '#fff',
        '--toastBarBackground': '#5a2525',
      },
    });
  } finally {
    activePass = null;
    solveState.isSolving = false;
    // Only mark the bar complete on success. On failure, leave it where it stalled — forcing 100%
    // "Finalizing" would masquerade a crash as a finished (but stale) solve.
    if (solveState.progress && !solveState.error) {
      solveState.progress = {
        ...solveState.progress,
        stage: 'finalizing',
        totalPercent: 100,
        stagePercent: 100,
      };
    }
  }
}
