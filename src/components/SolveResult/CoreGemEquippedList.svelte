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
  /* Three columns when there's room (Order Sun/Moon/Star on the top row, Chaos on the bottom), but
     reflow to fewer columns as the column narrows. Each card needs ~18rem to stay readable; auto-fit
     drops to 2 or 1 columns rather than letting fixed-width cards overflow and overlap each other. */
  .root {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 960px) {
    .root {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
