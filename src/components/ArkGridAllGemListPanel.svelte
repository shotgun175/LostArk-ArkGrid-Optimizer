<script lang="ts">
  import { toast } from '@zerodevx/svelte-toast';
  import { tick } from 'svelte';

  import { type ArkGridAttr } from '../lib/constants/enums';
  import { LChaos, LOrder } from '../lib/constants/localization';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import { type AllGems, clearGems } from '../lib/state/profile.state.svelte';
  import Wrapper from './ArkGridGemAddPanel/Wrapper.svelte';
  import ArkGridGemList from './ArkGridGemList.svelte';

  interface Props {
    gems: AllGems;
  }

  let { gems }: Props = $props();
  let showDeleteButton = $state(false);

  $effect(() => {
    gems;
    showDeleteButton = false;
  });

  // Tab state
  let locale = $derived(appLocale.current);
  let activeTab = $state(0);
  let tabs = $derived([LOrder[locale], LChaos[locale]]);
  let container: ArkGridGemList;
  let scrollPositions = $state<number[]>([0, 0]);

  function selectTab(index: number) {
    scrollPositions[activeTab] = container?.getScrollTop?.() ?? 0;
    activeTab = index;
    // Restore scroll position after the next tick
    queueMicrotask(async () => {
      await tick();
      await new Promise(requestAnimationFrame);

      const pos = scrollPositions[index];
      if (pos != null) {
        container.scrollToPosition(pos);
      }
    });
  }

  // reactive variable
  let currentGems = $derived.by(() => {
    switch (activeTab) {
      case 0:
        return gems.orderGems;
      case 1:
        return gems.chaosGems;
      default:
        return [];
    }
  });
  let currentAttr: ArkGridAttr = $derived(activeTab == 0 ? 'Order' : 'Chaos');

  function clearGemWithConfirm() {
    if (!window.confirm(LResetConfirm)) return;
    clearGems();
    toast.push(LResetDone);
  }
  const LTitle = $derived(
    {
      en_us: 'Astrogems',
    }[locale]
  );
  const LGemTotalCount = $derived(
    {
      en_us: `Astrogems Owned: ${gems.orderGems.length + gems.chaosGems.length} / 100<br>(Order ${gems.orderGems.length}, Chaos ${gems.chaosGems.length} owned)`,
    }[locale]
  );
  const LEmpty = $derived(
    {
      en_us: 'No astrogems owned',
    }[locale]
  );
  const LDeleteGem = $derived(
    {
      en_us: 'Delete',
    }[locale]
  );
  const LReset = $derived(
    {
      en_us: 'Reset',
    }[locale]
  );
  const LResetConfirm = $derived(
    {
      en_us: 'This will delete all astrogems in the current profile. Do you want to proceed?',
    }[locale]
  );
  const LResetDone = $derived(
    {
      en_us: 'Astrogems reset',
    }[locale]
  );
</script>

<div class="panel">
  <div class="title">{LTitle}</div>
  <div class="tab-container">
    {#each tabs as tab, i}
      <button class="tab {activeTab === i ? 'active' : ''}" onclick={() => selectTab(i)}>
        {#if activeTab === i}
          &gt
        {/if}
        {tab}
      </button>
    {/each}
  </div>
  <ArkGridGemList
    gems={currentGems}
    bind:this={container}
    {showDeleteButton}
    emptyDescription={LEmpty}
  ></ArkGridGemList>
  <div class="gem-count">
    {@html LGemTotalCount}
  </div>
  <div class="buttons">
    <div class="left">
      <Wrapper gemAttr={currentAttr}></Wrapper>
    </div>
    <div class="right">
      <button
        disabled={gems.orderGems.length == 0 && gems.chaosGems.length == 0}
        onclick={() => (showDeleteButton = !showDeleteButton)}
      >
        {LDeleteGem}
      </button>
      <button
        disabled={gems.orderGems.length == 0 && gems.chaosGems.length == 0}
        onclick={() => clearGemWithConfirm()}>{LReset}</button
      >
    </div>
  </div>
</div>

<style>
  .tab-container {
    display: flex;
    gap: 0.3em;
  }

  .tab {
    border: 1px solid #ccc;
    cursor: pointer;
  }

  .tab.active {
    background-color: var(--card);
    font-weight: bold;
  }
  .gem-count {
    align-self: center;
    text-align: center;
  }

  /* Button group */
  .buttons {
    display: flex;
    gap: 0.4rem;
    justify-content: space-between;
    /* Pin the button group to the bottom of the panel */
    margin-top: auto;
  }
  .buttons button {
    /* Auto width, but at least 5em */
    width: auto;
    min-width: 5em;
  }
</style>
