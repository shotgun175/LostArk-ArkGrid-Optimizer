<script lang="ts">
  import { toast } from '@zerodevx/svelte-toast';
  import { tick } from 'svelte';

  import { type LocalizationName } from '../../lib/constants/enums';
  import { LChaos, LOrder } from '../../lib/constants/localization';
  import { type AssemblyResult } from '../../lib/cv/stitch';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import {
    type AllGems,
    addGem,
    clearGems,
    getCurrentProfile,
  } from '../../lib/state/profile.state.svelte';
  import { confirmDialog } from '../../lib/ui/confirmDialog.svelte';
  import ArkGridGemList from '../ArkGridGemList.svelte';

  interface Props {
    gems: AllGems;
    /** Per-attr count-checksum from the multi-file upload assembler (null on live/import paths). */
    assembly?: { order: AssemblyResult | null; chaos: AssemblyResult | null };
    onReset?: () => void;
  }

  let { gems, assembly, onReset }: Props = $props();

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

  // Count-checksum footer (multi-file upload). Shows captured-vs-target per attribute with an
  // actionable tail. A fragments>1 assembly is NEVER truly complete (a screenshot didn't connect)
  // even if the longest fragment's length coincidentally equals the target — so the gap check
  // precedes the complete check. With no readable target it still surfaces the gap / "count not read".
  function attrLine(label: string, len: number, a: AssemblyResult | null | undefined): string {
    if (!a) return `${label}: ${len} owned`;
    const s = a.status;
    if (s.overcount) return `⚠ ${label}: ${len} / ${s.target}, possible duplicate. Reset and re-upload.`;
    if (a.fragments > 1) {
      const tgt = s.target != null ? ` / ${s.target}` : '';
      return `${label}: ${len}${tgt} shown, but the screenshots did not all link. Overlap them by a few gems or include the footer count to verify nothing is missing or duplicated.`;
    }
    if (a.method === 'relaxed' && s.target == null)
      return `${label}: ${len} owned (linked by minimal overlap; add the footer count to verify)`;
    if (s.target == null) return `${label}: ${len} owned (count not read; linked by overlap only)`;
    if (s.complete) return `${label}: ${len} / ${s.target} complete`;
    return `${label}: ${len} / ${s.target} · ${s.remaining} more to capture`;
  }
  function attrState(a: AssemblyResult | null | undefined): 'complete' | 'over' | 'partial' | 'none' {
    if (!a) return 'none';
    const s = a.status;
    if (s.overcount) return 'over';
    if (a.fragments > 1 || s.target == null) return 'partial';
    return s.complete ? 'complete' : 'partial';
  }
  // Rich checksum footer whenever uploads happened (an assembly exists for either attribute), even
  // when the count couldn't be read — so a gap is never hidden behind the plain "/ 100" line.
  let hasChecksum = $derived(assembly != null && (assembly.order != null || assembly.chaos != null));
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
  <div class="title rec-title">
    <span>{LTitle[locale]}</span>
  </div>
  <div class="rec-content">
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
      {#if hasChecksum}
        {#if assembly?.order || orderGems.length > 0}
          <div class="attr-line" data-state={attrState(assembly?.order)}>
            {attrLine(LOrder[locale], orderGems.length, assembly?.order)}
          </div>
        {/if}
        {#if assembly?.chaos || chaosGems.length > 0}
          <div class="attr-line" data-state={attrState(assembly?.chaos)}>
            {attrLine(LChaos[locale], chaosGems.length, assembly?.chaos)}
          </div>
        {/if}
      {:else}
        {@html LGemTotalCount[locale]}
      {/if}
    </div>
    <div class="buttons">
      <div>
        <button
          disabled={orderGems.length == 0 && chaosGems.length == 0}
          onclick={async () => {
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
              overrideGem = await confirmDialog({
                message: LWarning[locale],
                confirmText: 'Overwrite',
                cancelText: 'Add only',
                tone: 'danger',
              });
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
            if (onReset) onReset();
            else {
              orderGems.length = 0;
              chaosGems.length = 0;
            }
          }}>{LReset[locale]}</button
        >
      </div>
    </div>
  </div>
</div>

<style>
  .rec-title {
    display: flex;
    align-items: center;
  }
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
  .attr-line {
    line-height: 1.5;
  }
  .attr-line[data-state='complete'] {
    color: #2e7d32;
    font-weight: 700;
  }
  .attr-line[data-state='over'] {
    color: #8a3a3a;
    font-weight: 700;
  }
  .attr-line[data-state='partial'] {
    opacity: 0.9;
  }
  :global(.dark-mode) .attr-line[data-state='complete'] {
    color: #4ade80;
  }
  :global(.dark-mode) .attr-line[data-state='over'] {
    color: #ef8a8a;
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
