<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';

  let visible = $state(false);

  onMount(() => {
    const onScroll = () => {
      visible = window.scrollY > 400;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  function toTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

{#if visible}
  <button
    class="back-to-top"
    onclick={toTop}
    aria-label="Back to top"
    transition:fade={{ duration: 150 }}
  >
    ↑ Back to top
  </button>
{/if}

<style>
  .back-to-top {
    position: fixed;
    /* Keep clear of the iPhone home-bar / side safe areas. */
    bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
    right: calc(1.5rem + env(safe-area-inset-right, 0px));
    z-index: 1000;
    width: auto;
    min-width: 0;
    padding: 0.5rem 0.9rem;
    border-radius: 2rem;
    font-weight: 700;
    font-size: 0.85rem;
    color: #b8860b;
    background: var(--card);
    border: 1px solid rgba(184, 134, 11, 0.6);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  @media (hover: hover) and (pointer: fine) {
    .back-to-top:hover {
      background: rgba(184, 134, 11, 0.12);
    }
    :global(.dark-mode) .back-to-top:hover {
      background: rgba(240, 192, 64, 0.14);
    }
  }
  :global(.dark-mode) .back-to-top {
    color: #f0c040;
    border-color: rgba(240, 192, 64, 0.6);
  }
</style>
