<script lang="ts">
  import type { SolveAfter } from '../../lib/state/profile.state.svelte';
  import AdditionalGemResult from './AdditionalGemResult.svelte';
  import CoreGemEquippedList from './CoreGemEquippedList.svelte';
  import GemOptionStats from './GemOptionStats.svelte';
  import ScoreIndicator from './ScoreIndicator.svelte';
  import SwapGuide from './SwapGuide.svelte';

  type Props = {
    solveAfter: SolveAfter;
  };
  let { solveAfter }: Props = $props();
</script>

<div class="root">
  <div class="title"></div>
  <div class="container">
    <div class="left">
      {#if solveAfter.scoreSet}
        <ScoreIndicator scoreSet={solveAfter.scoreSet}></ScoreIndicator>
      {/if}
      {#if solveAfter.solveAnswer}
        <GemOptionStats solveAnswer={solveAfter.solveAnswer}></GemOptionStats>
      {/if}
      {#if solveAfter.additionalGemResult && solveAfter.solveAnswer && solveAfter.needLauncherGem}
        <AdditionalGemResult
          additionalGemResult={solveAfter.additionalGemResult}
          solveAnswer={solveAfter.solveAnswer}
          needLauncherGem={solveAfter.needLauncherGem}
        ></AdditionalGemResult>
      {/if}
    </div>
    <div class="right">
      {#if solveAfter.answerCores && solveAfter.solveAnswer}
        <CoreGemEquippedList
          answerCores={solveAfter.answerCores}
          solveAnswer={solveAfter.solveAnswer}
        />
        <SwapGuide solveAnswer={solveAfter.solveAnswer} />
      {/if}
    </div>
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  .title {
    text-align: center;
  }
  .container {
    display: flex;
    flex-direction: row;
    gap: 2rem;
    align-items: flex-start;
  }
  .root .title {
    font-size: 1.5rem;
    font-weight: 500;
  }
  .left {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    max-width: 20rem;
  }
  .right {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    flex: 1;
    min-width: 0;
  }
  @media (max-width: 960px) {
    .container {
      flex-direction: column;
    }
  }
</style>
