<script lang="ts">
  import {
    AdvisorController,
    type AdviceInputs,
    type AdvisorResult,
  } from '../../lib/advisor/advisorController';
  import { GOLD_PER_DAMAGE, type GoldBracket } from '../../lib/cutplan/types';
  import { type GemRole } from '../../lib/scoring/gemScore';
  import { autoBaselineFromLoadout, effectiveBaseline } from '../../lib/scoring/triage';
  import { sectionUI, toggleSection } from '../../lib/state/appConfig.state.svelte';
  import { type CharacterProfile, activeBuildState } from '../../lib/state/profile.state.svelte';
  import type { ArkGridGem } from '../../lib/models/arkGridGems';
  import ProcessingWindow from './ProcessingWindow.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  // Advice inputs, derived from the active build exactly like the Cutting Plan.
  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let baselineGrade = $derived(
    effectiveBaseline(autoBaselineFromLoadout(equipped, role), build.baselineOverride)
  );
  let bracket: GoldBracket = $derived(profile.goldPer1Pct ?? '2_5M');
  let goldPerDamage = $derived(GOLD_PER_DAMAGE[bracket]);
  let inputs: AdviceInputs = $derived({ baselineGrade, gpd: goldPerDamage, axis: role });

  // Live screen watching needs getDisplayMedia (desktop Chromium); mobile / Safari use Upload.
  const captureSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  let controller: AdvisorController | null = null;
  function getController() {
    if (controller) return controller;
    controller = new AdvisorController();
    controller.onAdvice = (res) => {
      // Keep the last good advice if a frame briefly can't be read (window off-screen mid-animation).
      if (res) {
        result = res;
        error = null;
      }
    };
    controller.onShareEnded = () => {
      watching = false;
    };
    return controller;
  }

  let parsing = $state(false);
  let result = $state<AdvisorResult | null>(null);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let watching = $state(false);

  // Keep the running watch loop's advice inputs in sync with the active build.
  $effect(() => {
    if (watching) controller?.updateInputs(inputs);
  });

  const fmtGold = (g: number) =>
    !isFinite(g) ? '-' : Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(Math.round(g));
  const ACTION_LABEL: Record<string, string> = {
    process: 'Process',
    reroll: 'Reroll',
    complete: 'Complete',
    reset: 'Reset',
  };

  async function startWatch() {
    if (!captureSupported) return;
    error = null;
    try {
      await getController().startWatching(inputs);
      watching = true;
    } catch (e) {
      const name = (e as DOMException)?.name;
      error =
        name === 'NotAllowedError' ? 'Screen sharing was denied.' : String((e as Error)?.message ?? e);
      watching = false;
    }
  }
  function stopWatch() {
    getController().stopWatching();
    watching = false;
  }
  function warm() {
    if (captureSupported) getController().warmup();
  }

  async function parseFile(file: File) {
    if (parsing) return;
    parsing = true;
    error = null;
    try {
      const bitmap = await createImageBitmap(file);
      const res = await getController().parseImage(bitmap, inputs);
      if (!res) error = 'Could not read a Processing window from that image.';
      else result = res;
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    } finally {
      parsing = false;
    }
  }
  function onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void parseFile(f);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) void parseFile(f);
  }

  let rankedActions = $derived(
    result?.advice
      ? [...result.advice.allActions].filter((a) => isFinite(a.value)).sort((a, b) => b.value - a.value)
      : []
  );
</script>

<div class="panel advisor-panel">
  <div class="title section-title">
    Cut Advisor
    <button
      class="fold-button"
      aria-label={sectionUI.showAdvisor ? 'Collapse section' : 'Expand section'}
      onclick={() => toggleSection('showAdvisor')}
    >
      {sectionUI.showAdvisor ? '▼' : '▲'}
    </button>
  </div>

  {#if sectionUI.showAdvisor}
    <p class="advisor-intro">
      Share your game screen and the advisor watches the Processing window live, re-ranking Process /
      Reroll / Complete / Reset for your {role === 'support' ? 'support' : 'DPS'} build every time the screen
      changes. English game client, desktop only. No screen share? Drop a screenshot instead.
    </p>

    <div class="advisor-buttons">
      {#if captureSupported}
        {#if !watching}
          <button class="primary" onclick={startWatch} onpointerenter={warm} onfocus={warm}>
            🖥️ Start watching
          </button>
        {:else}
          <button class="primary active" onclick={stopWatch}>⏹ Stop watching</button>
          <span class="watch-status">Watching… the window below confirms what's being read</span>
        {/if}
      {/if}
      <button onclick={() => fileInput?.click()}>📷 Upload screenshot</button>
      <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onPick} />
    </div>

    {#if !watching}
      <div
        class="drop"
        role="button"
        tabindex="0"
        ondragover={(e) => e.preventDefault()}
        ondrop={onDrop}
        onclick={() => fileInput?.click()}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput?.click()}
      >
        {parsing ? 'Reading…' : 'Or drop a Processing-window screenshot here.'}
      </div>
    {/if}

    {#if error}
      <p class="advisor-error">{error}</p>
    {/if}

    {#if result}
      <div class="advisor-layout">
        <ProcessingWindow parsed={result.parsed} />

        {#if rankedActions.length}
          <div class="advice" data-testid="advisor-advice">
          <div class="advice-best">
            Best move:
            <strong>{ACTION_LABEL[result.advice!.bestAction] ?? result.advice!.bestAction}</strong>
          </div>
          <table class="advice-table">
            <thead>
              <tr><th>Action</th><th>Net value</th><th>P(above)</th><th>Exp. spend</th></tr>
            </thead>
            <tbody>
              {#each rankedActions as a (a.name)}
                <tr class:winner={a.name.toLowerCase() === result.advice!.bestAction}>
                  <td>{a.name}</td>
                  <td>{fmtGold(a.value)}</td>
                  <td>{Math.round(a.aboveBaselineOdds * 100)}%</td>
                  <td>{fmtGold(a.expectedCost)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .advisor-intro {
    opacity: 0.85;
    font-size: 0.9rem;
  }
  .advisor-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .advisor-buttons button {
    padding: 0.4rem 0.8rem;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .advisor-buttons button.primary.active {
    background: #8a3a3a;
    color: #fff;
  }
  .watch-status {
    color: #2e7d32;
    font-weight: 600;
    font-size: 0.85rem;
  }
  :global(.dark-mode) .watch-status {
    color: #4ade80;
  }
  .advisor-layout {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    margin-top: 0.75rem;
  }
  .advisor-layout .advice {
    flex: 1 1 260px;
    min-width: 240px;
  }
  .drop {
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    padding: 1.25rem;
    text-align: center;
    cursor: pointer;
    background: var(--card);
  }
  .drop:hover {
    border-color: var(--accent, #b8860b);
  }
  .advisor-error {
    color: #8a3a3a;
  }
  :global(.dark-mode) .advisor-error {
    color: #ef8a8a;
  }
  .advice-best {
    font-size: 1.05rem;
    margin-bottom: 0.4rem;
  }
  .advice-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .advice-table th,
  .advice-table td {
    text-align: right;
    padding: 0.2rem 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .advice-table th:first-child,
  .advice-table td:first-child {
    text-align: left;
  }
  .advice-table tr.winner {
    font-weight: 700;
    background: rgba(46, 125, 50, 0.12);
  }
</style>
