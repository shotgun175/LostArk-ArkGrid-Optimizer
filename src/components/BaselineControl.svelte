<script lang="ts">
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import { type GemRole } from '../lib/scoring/gemScore';
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
  let baseline = $derived(Math.round(effectiveBaseline(auto, build.baselineOverride)));
  let usingOverride = $derived(build.baselineOverride !== undefined);

  function onSlider(e: Event) {
    updateBaselineOverride(Number((e.target as HTMLInputElement).value));
  }
  function reset() {
    updateBaselineOverride(undefined);
  }

  const ticks = Array.from({ length: 21 }, (_, i) => i);
</script>

<div class="baseline-control">
  <div class="bl-label-row">
    <span class="bl-label">Baseline Level</span>
    <div class="bl-status">
      <span class="bl-badge" class:manual={usingOverride}>
        <span class="bl-num">{baseline}</span>
        <span class="bl-mode">· {usingOverride ? 'manual mode' : 'auto mode'}</span>
      </span>
      {#if usingOverride}
        <button class="reset-bl" onclick={reset} title="Reset to auto">↺ auto</button>
      {/if}
    </div>
  </div>
  <input
    class="bl-slider"
    type="range"
    aria-label="Baseline Level"
    min="0"
    max="20"
    step="1"
    value={baseline}
    oninput={onSlider}
  />
  <div class="slider-ticks">
    {#each ticks as t}
      <button
        type="button"
        class="slider-tick"
        class:active={t === baseline}
        onclick={() => updateBaselineOverride(t)}>{t}</button
      >
    {/each}
  </div>
  <div class="bl-hint">
    {#if auto === null && !usingOverride}
      Run the optimizer to auto-set this from your equipped loadout, or drag to set it manually.
    {:else}
      Gems scoring above {baseline} are upgrades over your weakest equipped gem.
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
  .bl-badge {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    padding: 0.05rem 0.5rem;
    border-radius: 0.4rem;
    color: #b8860b;
    background: rgba(184, 134, 11, 0.1);
    border: 1px solid rgba(184, 134, 11, 0.55);
  }
  .bl-num {
    font-size: 1.05rem;
  }
  .bl-mode {
    font-size: 0.8rem;
    font-weight: 500;
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
  :global(.dark-mode) .bl-badge,
  :global(.dark-mode) .reset-bl {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
    border-color: rgba(240, 192, 64, 0.55);
  }
  :global(.dark-mode) .reset-bl:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  /* Manual override pops via a solid fill; the default auto state stays the subtle gold outline. */
  .bl-badge.manual {
    color: #fff;
    background: #b8860b;
    border-color: #b8860b;
  }
  :global(.dark-mode) .bl-badge.manual {
    color: #1a1a1a;
    background: #f0c040;
    border-color: #f0c040;
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
