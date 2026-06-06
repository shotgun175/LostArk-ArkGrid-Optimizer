<script lang="ts">
  import { type ArkGridAttr, ArkGridAttrs } from '../../lib/constants/enums';
  import {
    type ArkGridCore,
    type ArkGridCoreType,
    ArkGridCoreTypes,
  } from '../../lib/models/arkGridCores';
  import type { SolveAnswer } from '../../lib/state/profile.state.svelte';
  import CoreGemEquipped from './CoreGemEquipped.svelte';

  type Props = {
    answerCores: Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>;
    solveAnswer: SolveAnswer;
  };
  let { answerCores, solveAnswer }: Props = $props();
</script>

<div class="root">
  {#each Object.values(ArkGridAttrs) as attr, i}
    {#each Object.values(ArkGridCoreTypes) as ctype, j}
      <CoreGemEquipped
        {attr}
        {ctype}
        core={answerCores[attr][ctype]}
        gems={solveAnswer.assignedGems[i * 3 + j]}
      ></CoreGemEquipped>
    {/each}
  {/each}
</div>

<style>
  /* Three columns: Order Sun/Moon/Star on the top row, Chaos Sun/Moon/Star on the bottom row. */
  .root {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 960px) {
    .root {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
