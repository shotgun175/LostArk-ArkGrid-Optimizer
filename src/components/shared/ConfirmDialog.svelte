<script lang="ts">
  import { fade, scale } from 'svelte/transition';

  import { confirmAccept, confirmDismiss, confirmStore } from '../../lib/ui/confirmDialog.svelte';

  let confirmBtn = $state<HTMLButtonElement | null>(null);
  // Split the message on newlines so multi-line confirms read as separate paragraphs.
  let lines = $derived(
    (confirmStore.active?.message ?? '').split('\n').filter((l) => l.length > 0)
  );

  // Move keyboard focus to the confirm button when a dialog opens (entry point for keyboard / SR users).
  $effect(() => {
    if (confirmStore.active) confirmBtn?.focus();
  });

  // Lock body scroll while a dialog is open so the page behind can't move under the backdrop.
  $effect(() => {
    if (!confirmStore.active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      confirmDismiss();
    }
  }
</script>

<svelte:window onkeydown={confirmStore.active ? onKeydown : undefined} />

{#if confirmStore.active}
  <div
    class="confirm-backdrop"
    role="presentation"
    onclick={confirmDismiss}
    transition:fade={{ duration: 120 }}
  >
    <div
      class="confirm-card"
      class:danger={confirmStore.active.tone === 'danger'}
      role="alertdialog"
      aria-modal="true"
      aria-label={confirmStore.active.title ?? 'Confirmation'}
      onclick={(e) => e.stopPropagation()}
      transition:scale={{ duration: 140, start: 0.96 }}
    >
      {#if confirmStore.active.title}
        <h2 class="confirm-title">{confirmStore.active.title}</h2>
      {/if}
      <div class="confirm-body">
        {#each lines as line}
          <p>{line}</p>
        {/each}
      </div>
      <div class="confirm-actions">
        {#if !confirmStore.active.hideCancel}
          <button type="button" class="confirm-cancel" onclick={confirmDismiss}>
            {confirmStore.active.cancelText ?? 'Cancel'}
          </button>
        {/if}
        <button type="button" class="confirm-accept" bind:this={confirmBtn} onclick={confirmAccept}>
          {confirmStore.active.confirmText ?? 'OK'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }
  /* Square corners + gold top-accent, matching the site's heading gold (#b8860b light / #f0c040 dark). */
  .confirm-card {
    --confirm-gold: #b8860b;
    --confirm-accent-ink: #1a1400;
    box-sizing: border-box;
    width: 100%;
    max-width: min(30rem, calc(100vw - 2rem));
    padding: 1.15rem 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--card);
    color: var(--text);
    border: 1px solid var(--border);
    border-top: 3px solid var(--confirm-gold);
    border-radius: 0;
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.4);
  }
  :global(.dark-mode) .confirm-card {
    --confirm-gold: #f0c040;
  }
  /* Destructive actions (delete / reset / overwrite) get a warm red-orange accent + white ink. */
  .confirm-card.danger {
    --confirm-gold: #c0563a;
    --confirm-accent-ink: #fff;
  }
  .confirm-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--confirm-gold);
  }
  .confirm-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .confirm-body p {
    margin: 0;
    line-height: 1.45;
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
    margin-top: 0.35rem;
    flex-wrap: wrap;
  }
  .confirm-actions button {
    border-radius: 0;
    padding: 0.45rem 1.15rem;
    font-weight: 600;
    cursor: pointer;
  }
  .confirm-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }
  .confirm-cancel:hover {
    background: var(--card-inner);
  }
  .confirm-accept {
    background: var(--confirm-gold);
    border: 1px solid var(--confirm-gold);
    color: var(--confirm-accent-ink);
  }
  .confirm-accept:hover {
    filter: brightness(1.08);
  }
</style>
