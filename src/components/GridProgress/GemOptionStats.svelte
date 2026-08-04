<script lang="ts">
  import type { OptionLevelRow } from '../../lib/scoring/gridProgress';

  type Props = { rows: OptionLevelRow[] };
  let { rows }: Props = $props();
</script>

{#if rows.length}
  <div class="root">
    <div class="title">Astrogem Options</div>
    <!-- One row per option, name left and level hard right, so the numbers form a column you can
         scan down. The old wrapped chips put every level at a different x and read as a word jumble. -->
    <dl class="list">
      {#each rows as row (row.name)}
        <div class="item">
          <dt>{row.name}</dt>
          <dd>{row.level}</dd>
        </div>
      {/each}
    </dl>
  </div>
{/if}

<style>
  .root { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .title { font-weight: 600; font-size: 1rem; }
  .list { display: flex; flex-direction: column; margin: 0; }
  .item {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.12rem 0;
    font-size: 0.88rem;
    line-height: 1.4;
  }
  .item + .item { border-top: 1px solid color-mix(in srgb, var(--text) 7%, transparent); }
  dt {
    color: color-mix(in srgb, var(--text) 82%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums; /* keeps the level column straight across rows */
    font-weight: 600;
  }
</style>
