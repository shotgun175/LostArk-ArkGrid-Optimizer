<script lang="ts">
  import { toast } from '@zerodevx/svelte-toast';
  import { tick } from 'svelte';

  import { type LocalizationName } from '../../lib/constants/enums';
  import { LChaos, LOrder } from '../../lib/constants/localization';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import {
    type AllGems,
    addGem,
    clearGems,
    getCurrentProfile,
  } from '../../lib/state/profile.state.svelte';
  import ArkGridGemList from '../ArkGridGemList.svelte';

  interface Props {
    gems: AllGems;
  }

  let { gems }: Props = $props();

  let locale = $derived(appLocale.current);
  const LTitle: LocalizationName = {
    en_us: 'Recognized Astrogems',
  };
  const LEmpty: LocalizationName = {
    en_us: 'No astrogems detected',
  };
  const LApply: LocalizationName = {
    en_us: 'Apply to Current Profile',
  };
  const LReset: LocalizationName = {
    en_us: 'Reset',
  };
  const LConfirm: LocalizationName = {
    en_us: 'Astrogems applied',
  };
  const LWarning: LocalizationName = {
    en_us:
      '⚠️ Astrogems already exist in the current profile.\n' +
      'Do you want to delete all existing astrogems and overwrite them?\n' +
      'If you cancel, the recognized astrogems will only be added.',
  };
  let container: ArkGridGemList;
  let orderGems = $derived(gems.orderGems);
  let chaosGems = $derived(gems.chaosGems);
  let scrollPositions = $state<number[]>([0, 0]);

  const LGemTotalCount = $derived({
    en_us: `Astrogems Owned: ${orderGems.length + chaosGems.length} / 100<br>(Order ${orderGems.length}, Chaos ${chaosGems.length} owned)`,
  });
  // Tab state
  let activeTab = $state(0);
  let tabs = $derived([LOrder[locale], LChaos[locale]]);
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

  export function selectTab(index: number) {
    scrollPositions[activeTab] = container?.getScrollTop?.() ?? 0;
    activeTab = index;
    // Restore after the next tick
    queueMicrotask(async () => {
      await tick();
      await new Promise(requestAnimationFrame);

      const pos = scrollPositions[index];
      if (pos != null) {
        container.scrollToPosition(pos);
      }
    });
  }
  export function scroll(command: 'top' | 'bottom') {
    container.scroll(command);
  }

  function applyGemList(overrideGem: boolean) {
    // Overwrite the current profile with the gems collected so far.
    let done = false;
    if (orderGems.length > 0) {
      if (overrideGem) clearGems('Order');
      for (const gem of orderGems) {
        addGem(gem);
      }
      done = true;
    }
    if (chaosGems.length > 0) {
      if (overrideGem) clearGems('Chaos');
      for (const gem of chaosGems) {
        addGem(gem);
      }
      done = true;
    }
    return done;
  }
</script>

<div class="panel">
  <div class="title">{LTitle[locale]}</div>
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
    showDeleteButton={false}
    emptyDescription={LEmpty[locale]}
    bind:this={container}
  ></ArkGridGemList>
  <div class="gem-count">
    {@html LGemTotalCount[locale]}
  </div>
  <div class="buttons">
    <div>
      <button
        disabled={orderGems.length == 0 && chaosGems.length == 0}
        onclick={() => {
          // Warn once if Chaos gems were not recognized
          // if (chaosGems.length == 0) {
          //   if (
          //     !window.confirm(
          //       'Chaos gems were not recognized. Do you want to continue?'
          //     )
          //   )
          //     return;
          // }

          // If the current profile already has gems, ask whether to overwrite.
          const profile = getCurrentProfile();
          let overrideGem = true;

          if (profile.gems.orderGems.length > 0 || profile.gems.chaosGems.length > 0) {
            overrideGem = window.confirm(LWarning[locale]);
          }
          if (applyGemList(overrideGem)) toast.push(LConfirm[locale]);
        }}
      >
        ✅ {LApply[locale]}
      </button>
    </div>
    <div>
      <button
        disabled={orderGems.length == 0 && chaosGems.length == 0}
        onclick={() => {
          orderGems.length = 0;
          chaosGems.length = 0;
        }}>{LReset[locale]}</button
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
  }
  .buttons button {
    /* Auto width but at least 5em */
    width: auto;
    min-width: 5em;
  }
</style>
