<script lang="ts">
  import { AdvisorController, type AdvisorResult } from '../../lib/advisor/advisorController';
  import { GOLD_PER_DAMAGE, type GoldBracket } from '../../lib/cutplan/types';
  import { type GemRole } from '../../lib/scoring/gemScore';
  import { autoBaselineFromLoadout, effectiveBaseline } from '../../lib/scoring/triage';
  import { sectionUI, toggleSection } from '../../lib/state/appConfig.state.svelte';
  import {
    type CharacterProfile,
    activeBuildState,
  } from '../../lib/state/profile.state.svelte';
  import type { ArkGridGem } from '../../lib/models/arkGridGems';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  // Advice inputs, derived from the active build exactly like the Cutting Plan: the DP ranks against
  // your role (axis), your gold-per-1%-damage bracket, and your equipped-loadout baseline tier.
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

  let controller: AdvisorController | null = null;
  function getController() {
    if (!controller) controller = new AdvisorController();
    return controller;
  }

  let parsing = $state(false);
  let result = $state<AdvisorResult | null>(null);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  const fmtGold = (g: number) =>
    !isFinite(g) ? '-' : Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(Math.round(g));
  const ACTION_LABEL: Record<string, string> = {
    process: 'Process',
    reroll: 'Reroll',
    complete: 'Complete',
    reset: 'Reset',
  };

  async function parseFile(file: File) {
    if (parsing) return;
    parsing = true;
    error = null;
    result = null;
    try {
      const bitmap = await createImageBitmap(file);
      const res = await getController().parseImage(bitmap, {
        baselineGrade,
        gpd: goldPerDamage,
        axis: role,
      });
      if (!res) {
        error = 'Could not read a Processing window from that image.';
      } else {
        result = res;
      }
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

  // The winning action first, then the rest by value.
  let rankedActions = $derived(
    result?.advice
      ? [...result.advice.allActions]
          .filter((a) => isFinite(a.value))
          .sort((a, b) => b.value - a.value)
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
      Drop a screenshot of the in-game gem Processing window and the advisor reads the state, then
      ranks Process / Reroll / Complete / Reset for your {role === 'support' ? 'support' : 'DPS'}
      build. English game client, desktop only.
    </p>

    <div
      class="drop"
      role="button"
      tabindex="0"
      ondragover={(e) => e.preventDefault()}
      ondrop={onDrop}
      onclick={() => fileInput?.click()}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput?.click()}
    >
      {parsing ? 'Reading…' : 'Drop a Processing-window screenshot, or click to choose one.'}
      <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onPick} />
    </div>

    {#if error}
      <p class="advisor-error">{error}</p>
    {/if}

    {#if result}
      <div class="parsed" data-testid="advisor-parsed">
        <div class="parsed-line">
          <strong>Gem</strong>: cost {result.parsed.config.baseCost} · {result.parsed.config.gemType}
          · willpower {result.parsed.config.willpowerLevel} · order {result.parsed.config.orderLevel}
        </div>
        <div class="parsed-line">
          <strong>Effects</strong>: {result.parsed.config.effect1}
          {result.parsed.config.effect1Level} · {result.parsed.config.effect2}
          {result.parsed.config.effect2Level}
        </div>
        <div class="parsed-line">
          <strong>Turn</strong>: {result.parsed.state.currentTurn}/{result.parsed.state.maxTurns} ·
          rerolls {result.parsed.state.rerollsRemaining}{result.parsed.ocrDegraded
            ? ' · (low confidence, please verify)'
            : ''}
        </div>
      </div>

      {#if rankedActions.length}
        <div class="advice" data-testid="advisor-advice">
          <div class="advice-best">
            Best move: <strong>{ACTION_LABEL[result.advice!.bestAction] ?? result.advice!.bestAction}</strong>
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
    {/if}
  {/if}
</div>

<style>
  .advisor-intro {
    opacity: 0.85;
    font-size: 0.9rem;
  }
  .drop {
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    padding: 1.5rem;
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
  .parsed {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
  .advice {
    margin-top: 0.75rem;
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
