<script lang="ts">
  import { fade } from 'svelte/transition';

  import { getCurrentProfile } from '../lib/state/profile.state.svelte';
  import { runSolve, solveState } from '../lib/state/solve.state.svelte';
  import { isSolveNeverRun, isSolveStale } from '../lib/state/solveStale';

  // Self-sufficient (like ProfileNavSwitcher): reads global state so SectionNav stays layout-only.
  // Appear-on-need: the button renders only when a run would change something (inputs stale, or
  // gems exist but nothing was ever solved) or while a solve is in flight. Its presence IS the
  // "re-run needed" signal; absence means up to date. Runs the same full both-builds solve as Gem
  // Triage's CTA, which keeps the rich feedback (hint, bar, nudges).
  let profile = $derived(getCurrentProfile());
  let stale = $derived(isSolveStale(profile));
  let neverRun = $derived(isSolveNeverRun(profile));
  let visible = $derived(solveState.isSolving || stale || neverRun);
  let percent = $derived(Math.round(solveState.progress?.totalPercent ?? 0));
  // Shown as a visible caption: title-attribute tooltips never surface on touch devices and need
  // a hover-and-wait on desktop.
  let reason = $derived(
    stale ? 'Inputs changed since last run' : neverRun ? 'No analysis yet' : undefined
  );
</script>

{#if visible}
  <div class="onb" transition:fade={{ duration: 150 }}>
    <button class="onb-btn" onclick={() => runSolve(profile)} disabled={solveState.isSolving}>
      {solveState.isSolving ? `Optimizing... ${percent}%` : 'Optimize'}
    </button>
    {#if !solveState.isSolving && reason}
      <div class="onb-hint">{reason}</div>
    {/if}
  </div>
{/if}

<style>
  /* Sits at the bottom of the rail with the same divider treatment as the Profile block. */
  .onb {
    margin-top: 0.4rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  /* Compact version of GemTriagePanel's .optimize-cta gold gradient. */
  .onb-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.45rem 0.5rem;
    border: none;
    border-radius: 0.4rem;
    font-size: 0.9rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #2a2010;
    background: linear-gradient(90deg, #b8860b 0%, #f0c040 100%);
  }
  /* The global button:hover only swaps background-color, invisible under a gradient image. */
  @media (hover: hover) and (pointer: fine) {
    .onb-btn:hover:not(:disabled) {
      filter: brightness(1.07);
    }
  }
  .onb-btn:active {
    filter: brightness(1.07);
  }
  /* Restate the gradient: the global button:disabled shorthand would replace it with var(--muted). */
  .onb-btn:disabled {
    opacity: 0.6;
    background: linear-gradient(90deg, #b8860b 0%, #f0c040 100%);
  }
  /* Why the button appeared; gold like the rail text (== .cta-hint's role in the triage panel). */
  .onb-hint {
    margin-top: 0.3rem;
    text-align: center;
    font-size: 0.72rem;
    color: #b8860b;
    opacity: 0.8;
  }
  :global(.dark-mode) .onb-hint {
    color: #f0c040;
  }
</style>
