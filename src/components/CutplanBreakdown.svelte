<script lang="ts">
  import type { CellBreakdown } from '../lib/cutplan/cutPlan';
  import { RARITY_LABEL, type BindingMode, type Rarity } from '../lib/cutplan/types';

  interface Props {
    breakdown: CellBreakdown;
    rarity: Rarity;
    cost: number;
    binding: BindingMode;
  }
  let { breakdown, rarity, cost, binding }: Props = $props();

  const fmtGold = (g: number | null | undefined) =>
    g == null ? '-' : Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(Math.round(g));
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
</script>

<div class="cb">
  <div class="cb-head">
    {RARITY_LABEL[rarity]} · {cost}-cost
    <span class="cb-rs">{binding === 'nrb' ? 'NRB' : 'RB'}</span>
  </div>
  <div class="cb-scroll">
    <table class="cb-tbl">
      <thead>
        <tr>
          <th>Pair</th>
          <th>Cut-EV</th>
          <th>Hit %</th>
          <th>Exp. score</th>
          <th>Exp. spend</th>
        </tr>
      </thead>
      <tbody>
        {#each breakdown.buckets as b (b.key)}
          <tr>
            <td class="cb-pair"><b>{b.label}</b> <span class="cb-dim">{b.description}</span></td>
            <td class="cb-num">{fmtGold(b.cut)}</td>
            <td class="cb-num">{pct(b.pAbove)}</td>
            <td class="cb-num">{b.expScore.toFixed(3)}</td>
            <td class="cb-num">{binding === 'nrb' && b.expSpend ? fmtGold(b.expSpend) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <div class="cb-avg">
    Average value <span class="cb-dim">(1·2D + 2·Op + 2·Sub + 1·No)/6</span>:
    <b>{fmtGold(breakdown.averageCut)}</b>
  </div>
</div>

<style>
  .cb {
    background: var(--card-inner, #fff);
    border: 1px solid var(--border, #ccc);
    border-radius: 0.6rem;
    padding: 0.75rem 0.9rem;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
    font-size: 0.85rem;
    color: inherit;
  }
  .cb-head {
    font-weight: 700;
    margin-bottom: 0.5rem;
    color: #b8860b;
  }
  :global(.dark-mode) .cb-head {
    color: #f0c040;
  }
  .cb-rs {
    font-size: 0.72rem;
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    border: 1px solid var(--border, #ccc);
    opacity: 0.85;
  }
  .cb-scroll {
    overflow-x: auto;
  }
  .cb-tbl {
    width: 100%;
    border-collapse: collapse;
  }
  .cb-tbl th {
    text-align: right;
    font-weight: 600;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    opacity: 0.7;
    padding: 0.2rem 0.35rem;
    white-space: nowrap;
  }
  .cb-tbl th:first-child {
    text-align: left;
  }
  .cb-num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    padding: 0.25rem 0.35rem;
    white-space: nowrap;
  }
  .cb-pair {
    padding: 0.25rem 0.55rem 0.25rem 0.35rem;
  }
  .cb-dim {
    opacity: 0.65;
  }
  .cb-avg {
    margin-top: 0.5rem;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border, #ccc);
  }
</style>
