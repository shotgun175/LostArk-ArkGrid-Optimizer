<script lang="ts">
  import { type ArkGridAttr } from '../lib/constants/enums';
  import { formatCoreType } from '../lib/constants/localization';
  import {
    type ArkGridCore,
    type ArkGridCoreCoeffs,
    type ArkGridCoreType,
    getDefaultCoreEnergy,
    getMaxCorePoint,
  } from '../lib/models/arkGridCores';
  import { Core } from '../lib/solver/models';
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

  function buildCoreArray(coeffs: ArkGridCoreCoeffs): number[] {
    const arr = new Array(21).fill(0);
    arr.fill(coeffs.p10, 10, 14);
    arr.fill(coeffs.p14, 14, 17);
    arr[17] = coeffs.p17;
    arr[18] = coeffs.p18;
    arr[19] = coeffs.p19;
    arr[20] = coeffs.p20;
    return arr;
  }
  export function convertToSolverCore(): Core | null {
    if (!core) return null;
    return new Core(getDefaultCoreEnergy(core), core.goalPoint, buildCoreArray(core.coeffs));
  }
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
