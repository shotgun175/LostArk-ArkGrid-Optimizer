<script lang="ts">
  import { computeGridProgress, sumOptionLevels } from '../../lib/scoring/gridProgress';
  import { type CharacterProfile, activeBuildState } from '../../lib/state/profile.state.svelte';
  import { isSolveNeverRun, isSolveStale } from '../../lib/state/solveStale';
  import GemOptionStats from './GemOptionStats.svelte';
  import ScoreIndicator from './ScoreIndicator.svelte';

  type Props = { profile: CharacterProfile };
  let { profile }: Props = $props();

  let after = $derived(activeBuildState(profile).solveInfo.after);
  let progress = $derived(computeGridProgress(after?.scoreSet));
  let rows = $derived(sumOptionLevels(after?.solveAnswer));
  // Never-run is checked first: "show it marked stale" only applies when there is something to show.
  let neverRun = $derived(isSolveNeverRun(profile) || !progress);
  let stale = $derived(!neverRun && isSolveStale(profile));
</script>

<section class="grid-progress">
  {#if neverRun}
    <div class="title">Ark Grid Combat Power</div>
    <div class="empty">Run Optimize to see how close your grid is to its ceiling.</div>
  {:else if progress}
    {#if stale}
      <div class="stale" role="status">Out of date: your cores or gems changed. Re-run Optimize.</div>
    {/if}
    <div class="cols">
      <ScoreIndicator {progress} dimmed={stale} />
      <div class:dimmed={stale}><GemOptionStats {rows} /></div>
    </div>
  {/if}
</section>

<style>
  .grid-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    margin: 0 auto 0.9rem;
    border-radius: 6px;
    background: color-mix(in srgb, var(--text) 4%, transparent);
    /* Centred, and capped only so the two columns cannot drift apart on a very wide display.
       width: 100% is load-bearing: this is a FLEX ITEM, so auto margins with no explicit width make
       it shrink to its content instead of filling, which collapsed the bar to half its length and
       read as congested. With the width set, the auto margins only have free space to absorb once
       the cap actually binds. */
    width: 100%;
    max-width: 78rem;
    /* with width: 100% the horizontal padding would otherwise push the panel past its container and
       put a scrollbar on the page at phone width */
    box-sizing: border-box;
  }
  /* Gauge left, options right. Side by side the bar stops stretching the full panel (which was what
     made it hard to read) and the two blocks share the vertical space instead of stacking. minmax(0,
     ...) lets both columns actually shrink, otherwise the option names refuse to ellipsis. */
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
    gap: 0.4rem 1.4rem;
    align-items: start;
  }
  /* One column below the breakpoint: two columns at phone width would leave the bar too short to
     read a percentage off, which defeats the point of the gauge. */
  @media (max-width: 640px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.6rem;
    }
  }
  .title { font-weight: 600; font-size: 1rem; }
  .empty { font-size: 0.8rem; color: color-mix(in srgb, var(--text) 70%, transparent); }
  .stale {
    padding: 0.3rem 0.5rem;
    border-radius: 4px;
    background: rgba(240, 180, 41, 0.14);
    color: #f0b429;
    font-size: 0.76rem;
  }
  .dimmed { opacity: 0.55; }
</style>
