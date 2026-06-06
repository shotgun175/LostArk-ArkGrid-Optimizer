<script lang="ts">
  import { tick } from 'svelte';

  import type { ScrollCommand } from '../lib/constants/enums';
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import ArkGridGemDetail from './ArkGridGemDetail.svelte';

  interface Props {
    gems: ArkGridGem[];
    showDeleteButton?: boolean;
    emptyDescription?: string;
  }
  let { gems, showDeleteButton = true, emptyDescription = 'No astrogems owned' }: Props = $props();

  let container: HTMLDivElement;
  let scheduled = false;
  let lastCommand: ScrollCommand = null;

  export function scroll(command: 'top' | 'bottom') {
    // Scroll to the very top or bottom after the DOM update completes
    lastCommand = command;

    if (scheduled) return;

    scheduled = true;

    queueMicrotask(async () => {
      await tick();
      await new Promise(requestAnimationFrame);

      scheduled = false;

      if (!lastCommand) return;

      if (lastCommand === 'top') {
        container.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth',
        });
      }

      lastCommand = null;
    });
  }
  export function getScrollTop() {
    // Return the current scrollTop of the inner container
    return container.scrollTop;
  }

  export function scrollToPosition(top: number) {
    // Immediately scroll to a specific position
    container.scrollTo({
      top,
      behavior: 'auto',
    });
  }
</script>

<div class="gems" bind:this={container}>
  {#if gems.length > 0}
    {#each gems as gem}
      <ArkGridGemDetail {gem} {showDeleteButton} />
    {/each}
  {:else}
    <span class="epmty-description">{emptyDescription} </span>
  {/if}
</div>

<style>
  .gems {
    /* Show 9 items at once, just like in-game */
    height: 39rem;

    /* Borders */
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0.5rem 0.5rem 0;

    /* Inner layout */
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    gap: 0.5rem;
    /* Looks fine, add later... */
    /* scroll-snap-type: y proximity;  */
  }
  .gems > .epmty-description {
    align-self: center;
  }
</style>
