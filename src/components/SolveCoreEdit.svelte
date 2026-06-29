<script lang="ts">
  import { type ArkGridAttr } from '../lib/constants/enums';
  import { formatCoreType } from '../lib/constants/localization';
  import {
    type ArkGridCore,
    type ArkGridCoreType,
    getMaxCorePoint,
  } from '../lib/models/arkGridCores';
  import { appLocale } from '../lib/state/locale.state.svelte';

  interface Props {
    attr: ArkGridAttr;
    ctype: ArkGridCoreType;
    core: ArkGridCore | null;
  }
  let { attr, ctype, core = $bindable() }: Props = $props();

  $effect(() => {
    if (!core) return;
    const maxPoint = getMaxCorePoint(core);
    if (core.goalPoint > maxPoint) {
      core.goalPoint = maxPoint;
    }
  });
  let locale = $derived(appLocale.current);
  const LTitle = $derived(formatCoreType(attr, ctype, locale, true));
  let maxCorePoint = $derived(getMaxCorePoint(core));
</script>

<div class="root">
  <div class="title">{LTitle}</div>
  <div>
    {#if core}
      <select bind:value={core.goalPoint}>
        {#each [20, 19, 18, 17, 14, 10, 0] as targetPoint}
          <option value={targetPoint} disabled={targetPoint > maxCorePoint}>
            {targetPoint}
          </option>
        {/each}
      </select>
    {:else}
      <div>-</div>
    {/if}
  </div>
</div>

<style>
  .root {
    background-color: lightblue;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 1rem;
  }
  .root > .title {
    font-weight: 500;
    font-size: 1.1rem;
  }

  select {
    /* Include the border in the size calculation */
    box-sizing: border-box;
    font-size: 0.9rem;
    width: 3rem;
    text-align: center;
    border: none;
    background: none;
  }
</style>
