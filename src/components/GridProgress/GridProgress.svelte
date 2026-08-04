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
    <ScoreIndicator {progress} dimmed={stale} />
    <div class:dimmed={stale}><GemOptionStats {rows} /></div>
  {/if}
</section>

<style>
  .grid-progress {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    margin-bottom: 0.9rem;
    border-radius: 6px;
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .title { font-weight: 600; font-size: 0.92rem; }
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
