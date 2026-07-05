<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    trigger: Snippet;
    content: Snippet;
    label?: string;
  }
  let { trigger, content, label = 'Show details' }: Props = $props();

  let open = $state(false);
  let hoverCapable = $state(true);
  let anchorEl = $state<HTMLElement | null>(null);
  let popEl = $state<HTMLElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  });

  function cancelClose() {
    clearTimeout(closeTimer);
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (open = false), 100);
  }
  function onEnter() {
    if (hoverCapable) {
      cancelClose();
      open = true;
    }
  }
  function onLeave() {
    if (hoverCapable) scheduleClose();
  }
  function onToggle() {
    if (!hoverCapable) open = !open;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  // Position the desktop popover under the anchor, clamped to the viewport.
  $effect(() => {
    if (open && hoverCapable && anchorEl && popEl) {
      const a = anchorEl.getBoundingClientRect();
      const p = popEl.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      let left = a.left;
      let top = a.bottom + 6;
      if (left + p.width > vw - 8) left = Math.max(8, vw - 8 - p.width);
      if (top + p.height > vh - 8) top = Math.max(8, a.top - 6 - p.height);
      pos = { left, top };
    } else {
      pos = null;
    }
  });
</script>

<svelte:window onkeydown={onKey} />

<div
  class="pop-anchor"
  bind:this={anchorEl}
  role="button"
  tabindex="0"
  aria-expanded={open}
  aria-label={label}
  onpointerenter={onEnter}
  onpointerleave={onLeave}
  onclick={onToggle}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open = !open;
    }
  }}
>
  {@render trigger()}
</div>

{#if open}
  {#if hoverCapable}
    <div
      class="pop-float"
      bind:this={popEl}
      style={pos ? `left:${pos.left}px; top:${pos.top}px;` : 'left:-9999px; top:0;'}
      onpointerenter={cancelClose}
      onpointerleave={scheduleClose}
    >
      {@render content()}
    </div>
  {:else}
    <button class="pop-backdrop" aria-label="Close" onclick={() => (open = false)}></button>
    <div class="pop-sheet" role="dialog" aria-label={label}>
      {@render content()}
    </div>
  {/if}
{/if}

<style>
  .pop-anchor {
    display: block;
    cursor: pointer;
  }
  .pop-float {
    position: fixed;
    z-index: 1000;
    max-width: min(92vw, 30rem);
  }
  .pop-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    border: 0;
    background: rgba(0, 0, 0, 0.45);
  }
  .pop-sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1001;
    max-height: 80vh;
    overflow-y: auto;
    border-top-left-radius: 0.8rem;
    border-top-right-radius: 0.8rem;
  }
</style>
