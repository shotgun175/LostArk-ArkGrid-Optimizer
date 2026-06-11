<script lang="ts">
  import { onDestroy } from 'svelte';

  import { type AppLocale, ArkGridAttrs } from '../lib/constants/enums';
  import { ArkGridCoreTypes } from '../lib/models/arkGridCores';
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import { gemFingerprint } from '../lib/models/arkGridGems';
  import { solveInputSignature } from '../lib/solver/solveSignature';
  import { SolverController } from '../lib/solver/solverController';
  import type { SolverProgress, SolverProgressStage } from '../lib/solver/types';
  import { sectionUI, toggleSection } from '../lib/state/appConfig.state.svelte';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import {
    type BuildRole,
    type CharacterProfile,
    activeBuildState,
    buildState,
    setBuildSolveAfter,
  } from '../lib/state/profile.state.svelte';
  import BuildViewSwitch from './BuildViewSwitch.svelte';
  import SolveCoreEdit from './SolveCoreEdit.svelte';
  import SolveResult from './SolveResult/SolveResult.svelte';

  type Props = {
    profile: CharacterProfile;
  };
  type ProgressLogEntry = {
    header: string;
    text: string;
  };
  let { profile = $bindable() }: Props = $props();

  let locale = $derived(appLocale.current);
  const LTitle = $derived(
    {
      en_us: 'Optimization Settings',
    }[locale]
  );
  const LSubtitle = $derived(
    {
      en_us: 'Minimum Core Points',
    }[locale]
  );
  const LRunSolve = $derived(
    {
      en_us: 'Run Optimization',
    }[locale]
  );
  const LOptimizeHint = $derived(
    {
      en_us: 'Previous results are saved',
    }[locale]
  );
  const LOptimizeTooltip = $derived(
    {
      en_us:
        'Your optimization result and astrogem list are snapshotted. On a tie, the optimizer prefers the assignment that moves the fewest gems from your previous result. Newly added astrogems not present in the previous snapshot are highlighted with a gold border in the results.',
    }[locale]
  );
  const LRunning = $derived(
    {
      en_us: 'Optimizing...',
    }[locale]
  );
  const LProgressTitle = $derived(
    {
      en_us: 'Optimization Progress',
    }[locale]
  );
  const LFailed = $derived(
    {
      en_us:
        "These minimum points can't be reached with your current astrogems — each astrogem adds at most 5 points to one core, and a core needs enough astrogems to meet its minimum. Lower the minimums or add more astrogems.",
    }[locale]
  );
  const LOrderFailed = $derived(
    {
      en_us: 'Order cores optimization failed',
    }[locale]
  );
  const LChaosFailed = $derived(
    {
      en_us: 'Chaos cores optimization failed',
    }[locale]
  );

  // The active build's solve result. Derived from the persisted store so it survives reload and
  // follows a build switch; the post-solve write goes through setBuildSolveAfter (mutating the store).
  let solveAfter = $derived(activeBuildState(profile).solveInfo.after);

  // Stale when the active build's current inputs (its cores + the shared gems) no longer match the
  // signature captured at solve time. Solves saved before this feature carry no signature, so they
  // never show stale until the next re-run.
  let solveStale = $derived.by(() => {
    const after = activeBuildState(profile).solveInfo.after;
    if (!after?.inputSig) return false;
    return after.inputSig !== solveInputSignature(activeBuildState(profile).cores, profile.gems);
  });

  let failedSign = $derived.by(() => {
    if (!solveAfter) return { order: false, chaos: false };
    const answerCores = solveAfter.answerCores;
    const allOrderCoresNull =
      !answerCores || Object.values(answerCores['Order']).every((v) => v == null);
    const allChaosCoresNull =
      !answerCores || Object.values(answerCores['Chaos']).every((v) => v == null);
    return {
      order: solveAfter.solveAnswer?.gemSetPackTuple.gsp1 === null && !allOrderCoresNull,
      chaos: solveAfter.solveAnswer?.gemSetPackTuple.gsp2 === null && !allChaosCoresNull,
    };
  });

  const solverController = new SolverController();
  let isSolving = $state(false);
  let solvingRole = $state<BuildRole | null>(null);
  let solveProgress = $state<SolverProgress | null>(null);
  let progressLog = $state<ProgressLogEntry[]>([]);

  // While solving a dual-role character, name which build is currently being optimized.
  let solveLabel = $derived(
    !isSolving
      ? LRunSolve
      : profile.dualRole && solvingRole
        ? `${LRunning.replace(/\.\.\.$/, '')} ${solvingRole === 'support' ? 'Support' : 'DPS'}...`
        : LRunning
  );

  solverController.onProgress = (progress: SolverProgress) => {
    solveProgress = progress;
    const header = getProgressLogKey(progress);
    const text = `${progress.stagePercent}% ${getProgressLabel(progress)}`;
    const index = progressLog.findIndex((entry) => entry.header === header);

    if (index === -1) {
      progressLog = [...progressLog, { header, text }];
      return;
    }

    if (progressLog[index].text === text) {
      return;
    }

    progressLog = progressLog.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, text } : entry
    );
  };

  onDestroy(() => {
    solverController.destroy();
  });

  function buildAssignedGems(
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

  function getProgressLabel(progress: SolverProgress | null) {
    if (!progress) {
      return '';
    }

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

  function getProgressLogKey(progress: SolverProgress | null) {
    if (!progress) return '';
    if (progress.stage !== 'simulating_launcher_gems') return progress.stage;
    return `${progress.stage}:${progress.attr ?? ''}`;
  }

  async function solveOne(role: BuildRole) {
    // Per-slot previous assignment for isNew + replaces detection (this build's prior result).
    const previousAssigned = buildState(role, profile).solveInfo.after?.solveAnswer?.assignedGems;

    const result = await solverController.runSolve(profile, role);

    const assignedGems = buildAssignedGems(result.assignedGemIndexes, previousAssigned);
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

  function resetMinPoints() {
    // Set every core's minimum back to 0 for the active build (a quick undo for over-set minimums).
    const cores = profile.builds[profile.activeBuild].cores;
    for (const attr of Object.values(ArkGridAttrs)) {
      for (const ctype of Object.values(ArkGridCoreTypes)) {
        const c = cores[attr][ctype];
        if (c) c.goalPoint = 0;
      }
    }
  }

  // Only surface "Reset" when there's something to reset — i.e. the active build (DPS or Support
  // lens) has at least one non-zero minimum. Re-evaluates on lens switch and on any min-point edit.
  let goalsModified = $derived.by(() => {
    const cores = profile.builds[profile.activeBuild].cores;
    for (const attr of Object.values(ArkGridAttrs)) {
      for (const ctype of Object.values(ArkGridCoreTypes)) {
        if ((cores[attr][ctype]?.goalPoint ?? 0) > 0) return true;
      }
    }
    return false;
  });

  async function runSolve() {
    if (isSolving) return;

    isSolving = true;
    progressLog = [];
    solveProgress = { stage: 'preparing', totalPercent: 0, stagePercent: 0 };

    try {
      // Dual-role characters solve both builds (they share one gem pool, so triage/cutplan can see
      // what each build leverages); single-role solves the active build only.
      const roles: BuildRole[] = profile.dualRole ? ['dps', 'support'] : [profile.activeBuild];
      for (const role of roles) {
        solvingRole = role;
        await solveOne(role);
      }
    } catch (error) {
      console.error(error);
    } finally {
      isSolving = false;
      solvingRole = null;
      if (solveProgress) {
        solverController.onProgress?.({
          ...solveProgress,
          stage: 'finalizing',
          totalPercent: 100,
          stagePercent: 100,
        });
      }
    }
  }
</script>

<div class="panel" class:collapsed={!sectionUI.showOptimization}>
  <div class="title section-title">
    {LTitle}
    <BuildViewSwitch />
    <button
      class="fold-button"
      aria-label={sectionUI.showOptimization
        ? 'Collapse section'
        : 'Expand section'}
      onclick={() => toggleSection('showOptimization')}
    >
      {sectionUI.showOptimization ? '▼' : '▲'}
    </button>
  </div>
  {#if sectionUI.showOptimization}
    <div class="container">
      <div class="core-solve-goal-edit">
        <div class="title goal-title">
          <span>{LSubtitle}</span>
          {#if goalsModified}
            <button class="reset-goals" onclick={resetMinPoints}>↺ Reset</button>
          {/if}
        </div>
        <div class="container">
          {#each Object.values(ArkGridAttrs) as attr}
            {#each Object.values(ArkGridCoreTypes) as ctype}
              <SolveCoreEdit
                {attr}
                {ctype}
                bind:core={profile.builds[profile.activeBuild].cores[attr][ctype]}
              ></SolveCoreEdit>
            {/each}
          {/each}
        </div>
      </div>

      {#if failedSign.order || failedSign.chaos}
        <div class="failed-sign">
          {#if failedSign.order}
            <div class="big">⚠️ {LOrderFailed} ⚠️</div>
          {/if}
          {#if failedSign.chaos}
            <div class="big">⚠️ {LChaosFailed} ⚠️</div>
          {/if}
          <div class="small">{LFailed}</div>
        </div>
      {/if}
      <button class="solve-button" onclick={runSolve} disabled={isSolving}>
        {solveLabel}
      </button>
      {#if solveStale && !isSolving}
        <div class="stale-badge">
          ⟳ Inputs changed since the last optimization — re-run to refresh the results.
        </div>
      {/if}
      <div class="optimize-hint">
        {LOptimizeHint}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span class="tooltip" tabindex="0">
          <i class="fa-solid fa-circle-info info-icon"></i>
          <span class="tooltip-text">{LOptimizeTooltip}</span>
        </span>
      </div>

      {#if solveProgress || progressLog.length > 0}
        <div class="solve-progress">
          <div class="title">{LProgressTitle}</div>
          {#if solveProgress}
            <div class="progress-label">
              <span>{getProgressLabel(solveProgress)}</span>
              <span>{solveProgress.stagePercent}%</span>
            </div>
            <div
              class="progress-bar"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={solveProgress.totalPercent}
            >
              <div class="fill" style={`width: ${solveProgress.totalPercent}%`}></div>
            </div>
          {/if}
          <div class="progress-log">
            {#each progressLog as entry}
              <div class="progress-log-entry">{entry.text}</div>
            {/each}
          </div>
        </div>
      {/if}

      {#if solveAfter}
        <SolveResult {solveAfter}></SolveResult>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel {
    min-height: 60rem;
  }
  .panel.collapsed {
    min-height: 0;
  }
  .solve-button {
    font-size: 1.5rem;
    width: 15rem;
    height: 4rem;
    align-self: center;
  }
  .stale-badge {
    align-self: center;
    max-width: 32rem;
    text-align: center;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.4rem 0.8rem;
    border-radius: 0.4rem;
    color: #b8860b;
    background: rgba(184, 134, 11, 0.12);
    border: 1px solid rgba(184, 134, 11, 0.55);
  }
  :global(.dark-mode) .stale-badge {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
    border-color: rgba(240, 192, 64, 0.55);
  }
  .optimize-hint {
    font-size: 0.85rem;
    color: var(--text-muted, #888);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .solve-progress {
    width: min(32rem, 100%);
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .solve-progress > .title {
    font-size: 1rem;
    font-weight: 600;
  }
  .progress-label {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.95rem;
  }
  .progress-bar {
    width: 100%;
    height: 0.75rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 70%, white);
    overflow: hidden;
  }
  .progress-bar > .fill {
    height: 100%;
    background: linear-gradient(90deg, #2f6fed 0%, #5aa1ff 100%);
    transition: width 160ms ease-out;
  }
  .progress-log {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 10rem;
    overflow: auto;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border);
  }
  .progress-log-entry {
    font-size: 0.9rem;
    color: var(--text-muted, inherit);
    line-height: 1.3;
  }

  .panel > .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
  /* Centered (non-stretched) flex children size to content, not the panel — clamp them so a
     wide child (e.g. a long failure message) can't push the panel into sideways scroll. */
  .panel > .container > * {
    max-width: 100%;
    box-sizing: border-box;
  }
  .core-solve-goal-edit {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 1rem;
  }
  .core-solve-goal-edit > .title {
    font-size: 1.4rem;
    font-weight: 500;
  }
  .goal-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .reset-goals {
    width: auto;
    min-width: 0;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.25rem 0.6rem;
    color: #b8860b;
    border: 1px solid rgba(184, 134, 11, 0.55);
    background: rgba(184, 134, 11, 0.1);
  }
  .core-solve-goal-edit > .container {
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .failed-sign {
    background: var(--card);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
  }
  .failed-sign > .big {
    font-weight: 500;
    font-size: 1.2rem;
  }
  .failed-sign > .small {
    font-size: 1rem;
  }
</style>
