<script lang="ts">
  import type { OptionLevelRow } from '../../lib/scoring/gridProgress';

  type Props = { rows: OptionLevelRow[] };
  let { rows }: Props = $props();
</script>

{#if rows.length}
  <div class="root">
    <div class="title">Astrogem Options</div>
    <!-- Level sits right next to the name, the way the game itself renders it. Right-aligning it to
         the column edge left a lake of dead space between the two halves of one fact. -->
    <dl class="list">
      {#each rows as row (row.name)}
        <div class="item">
          <dt>{row.name}</dt>
          <dd>Lv. {row.level}</dd>
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
    justify-content: flex-start;
    gap: 0.4rem;
    padding: 0.14rem 0;
    /* 1rem is the page's own body size (measured 16px). Below it the list reads as a subtitle rather
       than as content, which is what it is. */
    font-size: 1rem;
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
    color: #f0b429; /* the gold the game itself uses for the level */
    font-weight: 600;
    white-space: nowrap;
  }
</style>
