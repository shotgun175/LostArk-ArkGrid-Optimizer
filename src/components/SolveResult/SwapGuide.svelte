<script lang="ts">
  import { type ArkGridAttr, ArkGridAttrs } from '../../lib/constants/enums';
  import { formatCoreType } from '../../lib/constants/localization';
  import { type ArkGridCoreType, ArkGridCoreTypes } from '../../lib/models/arkGridCores';
  import type { ArkGridGem } from '../../lib/models/arkGridGems';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import type { SolveAnswer } from '../../lib/state/profile.state.svelte';
  import ArkGridGemDetail from '../ArkGridGemDetail.svelte';

  type SwapEntry = {
    attr: ArkGridAttr;
    ctype: ArkGridCoreType;
    oldGem: ArkGridGem;
    newGem: ArkGridGem;
  };

  type Props = { solveAnswer: SolveAnswer };
  let { solveAnswer }: Props = $props();
  let locale = $derived(appLocale.current);

  const swapData = $derived.by(() => {
    const entries: SwapEntry[] = [];
    const attrs = Object.values(ArkGridAttrs);
    const ctypes = Object.values(ArkGridCoreTypes);
    attrs.forEach((attr, i) => {
      ctypes.forEach((ctype, j) => {
        const slotGems = solveAnswer.assignedGems[i * 3 + j] ?? [];
        for (const gem of slotGems) {
          if (gem.isNew && gem.replaces) {
            entries.push({ attr, ctype, oldGem: gem.replaces, newGem: gem });
          }
        }
      });
    });
    return entries;
  });

  const LTitle = $derived({ en_us: 'Swap Guide' }[locale]);
  const LRemove = $derived({ en_us: 'Remove' }[locale]);
  const LEquip = $derived({ en_us: 'Equip' }[locale]);
</script>

{#if swapData.length > 0}
  <div class="root">
    <div class="title">{LTitle}</div>
    <div class="list">
      {#each swapData as entry}
        <div class="entry">
          <div class="core-name">{formatCoreType(entry.attr, entry.ctype, locale)}</div>
          <div class="pair">
            <div class="side">
              <span class="label remove">{LRemove}</span>
              <ArkGridGemDetail gem={entry.oldGem} showDeleteButton={false} isReplaced={true} />
            </div>
            <span class="arrow">→</span>
            <div class="side">
              <span class="label equip">{LEquip}</span>
              <ArkGridGemDetail gem={entry.newGem} showDeleteButton={false} />
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .root {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }
  .title {
    font-weight: 500;
    font-size: 1.4em;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .core-name {
    font-size: 0.85rem;
    font-weight: 500;
    opacity: 0.65;
  }
  .pair {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1;
    min-width: 15rem;
    max-width: 22rem;
  }
  .label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  .label.remove {
    color: #c0392b;
  }
  .label.equip {
    color: #27ae60;
  }
  .arrow {
    font-size: 1.2rem;
    opacity: 0.4;
    flex-shrink: 0;
  }
</style>
