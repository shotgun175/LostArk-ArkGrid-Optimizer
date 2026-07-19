<script lang="ts">
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import {
    BASELINE_MAX_GRADE,
    BASELINE_MIN_GRADE,
    GRADE_ROWS,
    type GemRole,
    rankFromGrade,
  } from '../lib/scoring/gemScore';
  import { autoBaselineFromLoadout, effectiveBaseline } from '../lib/scoring/triage';
  import {
    type CharacterProfile,
    activeBuildState,
    updateBaselineOverride,
  } from '../lib/state/profile.state.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let auto: number | null = $derived(autoBaselineFromLoadout(equipped, role));
  // Baseline is a 0-100 GRADE on shizukaziye's rank ladder (GRADE_ROWS, C- … S+), shown as a letter
  // tier. Both the Gem Triage split and the Cutting Plan target read this same value.
  let baseline = $derived(effectiveBaseline(auto, build.baselineOverride));
  let baselineTier = $derived(rankFromGrade(baseline));
  let usingOverride = $derived(
    build.baselineOverride !== undefined &&
      build.baselineOverride >= BASELINE_MIN_GRADE &&
      build.baselineOverride <= BASELINE_MAX_GRADE
  );

  // Clear a stale out-of-range override (e.g. a pre-grade-migration % value ≤ 2) so the control and
  // the baseline stay consistent. (effectiveBaseline already ignores it for the value itself.)
  $effect(() => {
    if (
      build.baselineOverride !== undefined &&
      (build.baselineOverride < BASELINE_MIN_GRADE || build.baselineOverride > BASELINE_MAX_GRADE)
    ) {
      updateBaselineOverride(undefined);
    }
  });

  function onSlider(e: Event) {
    updateBaselineOverride(Number((e.target as HTMLInputElement).value));
  }
  function reset() {
    updateBaselineOverride(undefined);
  }
</script>

<div class="baseline-control">
  <div class="bl-label-row">
    <span class="bl-label">Baseline Tier</span>
    <div class="bl-status">
      <span class="bl-rank" data-rank={baselineTier}>{baselineTier}</span>
      <span class="bl-mode">· {usingOverride ? 'manual mode' : 'auto mode'}</span>
      {#if usingOverride}
        <button class="reset-bl" onclick={reset} title="Reset to auto">↺ auto</button>
      {/if}
    </div>
  </div>
  <input
    class="bl-slider"
    type="range"
    aria-label="Baseline tier"
    min={BASELINE_MIN_GRADE}
    max={BASELINE_MAX_GRADE}
    step="5"
    value={baseline}
    oninput={onSlider}
  />
  <div class="slider-ticks">
    {#each GRADE_ROWS as g}
      <button
        type="button"
        class="slider-tick"
        class:active={g === baseline}
        onclick={() => updateBaselineOverride(g)}>{rankFromGrade(g)}</button
      >
    {/each}
  </div>
  <div class="bl-hint">
    {#if auto === null && !usingOverride}
      Use Optimize in Gem Triage to auto-set this from your equipped loadout, or pick a tier to set it manually.
    {:else}
      Gems at tier {baselineTier} or better are upgrades; the Cutting Plan targets this tier.
    {/if}
  </div>
</div>

<style>
  .baseline-control {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
  }
  .bl-label-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.6rem;
  }
  .bl-status {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .bl-label {
    justify-self: start;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
    color: #b8860b; /* gold accent (readable in light mode) */
  }
  :global(.dark-mode) .bl-label {
    color: #f0c040; /* brighter gold in dark mode */
  }
  /* The tier badge uses the same per-grade colors as the Gem Triage rank badges (C green, B blue,
     A purple, S rose, D/F gray) so the baseline reads as a gem grade at a glance. */
  .bl-rank {
    padding: 0.1rem 0.55rem;
    border-radius: 0.5rem;
    font-size: 1.05rem;
    font-weight: 800;
    color: #fff;
    font-variant-numeric: tabular-nums;
    min-width: 2.5rem;
    text-align: center;
    background: #6f747a; /* default: F / D */
  }
  .bl-rank[data-rank^='C'] {
    background: #4f9d5d;
  }
  .bl-rank[data-rank^='B'] {
    background: #3b7fd0;
  }
  .bl-rank[data-rank^='A'] {
    background: #7e5cc0;
  }
  .bl-rank[data-rank^='S'] {
    background: #c95f85;
  }
  .bl-mode {
    font-size: 0.8rem;
    font-weight: 600;
    opacity: 0.75;
  }
  .reset-bl {
    width: auto;
    min-width: 0;
    padding: 0.05rem 0.5rem;
    font-size: 0.75rem;
    color: #b8860b;
    background: rgba(184, 134, 11, 0.1);
    border: 1px solid rgba(184, 134, 11, 0.55);
  }
  .reset-bl:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  :global(.dark-mode) .reset-bl {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
    border-color: rgba(240, 192, 64, 0.55);
  }
  :global(.dark-mode) .reset-bl:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  .bl-slider {
    width: 100%;
    accent-color: #b8860b; /* match the gold label (light mode) */
  }
  :global(.dark-mode) .bl-slider {
    accent-color: #f0c040; /* brighter gold in dark mode */
  }
  .slider-ticks {
    display: flex;
    width: 100%;
  }
  .slider-tick {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    padding: 0;
    font-size: 0.7rem;
    line-height: 1;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    opacity: 0.55;
    cursor: pointer;
  }
  .slider-tick:hover {
    background: none;
    opacity: 1;
  }
  .slider-tick.active {
    opacity: 1;
    font-weight: 700;
    color: #b8860b;
  }
  :global(.dark-mode) .slider-tick.active {
    color: #f0c040;
  }
  .bl-hint {
    font-size: 0.78rem;
    opacity: 0.75;
    text-align: center;
  }
  /* Give the baseline ticks a 44px-tall tap zone on touch screens. The slider above
     already covers the full range, so this just makes precise taps less fiddly. */
  @media (max-width: 767px) {
    .slider-tick {
      min-height: 2.75rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
  }
</style>
