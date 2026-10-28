<script lang="ts">
  // Letter-rank pill (S+ to F-), colored by band like Gem Triage and the Baseline control: F/D gray,
  // C green, B blue, A purple, S pink. Sized in em, so it follows the text it sits in.
  import type { GemRank } from '../lib/scoring/gemScore';

  interface Props {
    rank: GemRank;
  }
  let { rank }: Props = $props();
</script>

<span class="rank-badge" data-rank={rank}>{rank}</span>

<style>
  .rank-badge {
    display: inline-block;
    min-width: 1.9em;
    padding: 0.05em 0.4em;
    border-radius: 0.55em;
    font-family: var(--font-ui);
    font-size: 0.82em;
    font-weight: 700;
    line-height: 1.35;
    text-align: center;
    white-space: nowrap;
    color: #fff;
    font-variant-numeric: tabular-nums;
    background: #6f747a; /* default: F / D */
  }
  .rank-badge[data-rank^='C'] {
    background: #41824d;
  }
  .rank-badge[data-rank^='B'] {
    background: #3076c9;
  }
  .rank-badge[data-rank^='A'] {
    background: #7e5cc0;
  }
  .rank-badge[data-rank^='S'] {
    background: #c24b76;
  }
</style>
