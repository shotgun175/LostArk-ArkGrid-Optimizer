import type { AppLocale } from '../constants/enums';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
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
  solvingRole: BuildRole | null;
  progress: SolverProgress | null;
  progressLog: { header: string; text: string }[];
}>({
  isSolving: false,
  solvingRole: null,
  progress: null,
  progressLog: [],
});

controller.onProgress = (progress: SolverProgress) => {
  solveState.progress = progress;
  const header = getProgressLogKey(progress);
  const text = `${progress.stagePercent}% ${getProgressLabel(progress)}`;
  const index = solveState.progressLog.findIndex((entry) => entry.header === header);

  if (index === -1) {
    solveState.progressLog = [...solveState.progressLog, { header, text }];
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
  solveState.progress = { stage: 'preparing', totalPercent: 0, stagePercent: 0 };

  try {
    // Dual-role characters solve both builds (they share one gem pool, so triage/cutplan can see
    // what each build leverages); single-role solves the active build only.
    const roles: BuildRole[] = profile.dualRole ? ['dps', 'support'] : [profile.activeBuild];
    for (const role of roles) {
      solveState.solvingRole = role;
      await solveOne(profile, role);
    }
    // Endgame (all-Ancient) pass for the same roles — feeds the triage removal decision.
    for (const role of roles) {
      solveState.solvingRole = role;
      await solveEndgame(profile, role);
    }
  } catch (error) {
    console.error(error);
  } finally {
    solveState.isSolving = false;
    solveState.solvingRole = null;
    if (solveState.progress) {
      controller.onProgress?.({
        ...solveState.progress,
        stage: 'finalizing',
        totalPercent: 100,
        stagePercent: 100,
      });
    }
  }
}
