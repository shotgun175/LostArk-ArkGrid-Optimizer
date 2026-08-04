<script lang="ts">
  import type { OptionLevelRow } from '../../lib/scoring/gridProgress';

  type Props = { rows: OptionLevelRow[] };
  let { rows }: Props = $props();
</script>

{#if rows.length}
  <div class="root">
    <div class="title">Astrogem Options</div>
    <div class="container">
      {#each rows as row (row.name)}
        <div class="item">{row.name} Lv {row.level}</div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .root { display: flex; flex-direction: column; gap: 0.25rem; }
  .title { font-weight: 600; font-size: 0.86rem; }
  .container { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .item {
    padding: 0.16rem 0.45rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    font-size: 0.76rem;
    white-space: nowrap;
  }
</style>
