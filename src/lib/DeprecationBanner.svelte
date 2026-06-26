<script lang="ts">
  import { DEPRECATION } from './deprecation';

  // Session-scoped dismissal: hiding the banner lasts only for the current browsing
  // session — sessionStorage survives in-tab refreshes but clears when the tab/window
  // closes — so the heads-up returns on each new visit as a recurring reminder,
  // without nagging users who refresh repeatedly in one sitting. Keyed by status so
  // the later retirement notice isn't pre-dismissed by an earlier pending dismissal.
  // Client-only app (mount(), no SSR), so storage is available synchronously and
  // there's no flash-then-hide.
  const KEY = `arkgrid:deprecation-dismissed:${DEPRECATION.status}`;

  let dismissed = $state(DEPRECATION.dismissible && readDismissed());

  function readDismissed(): boolean {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  function dismiss(): void {
    dismissed = true;
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      // Private mode / storage disabled — the banner just won't stay dismissed.
    }
  }
</script>

{#if DEPRECATION.show && !dismissed}
  <div
    class="dep-banner"
    class:retired={DEPRECATION.status === 'retired'}
    role={DEPRECATION.status === 'retired' ? 'alert' : 'status'}
  >
    <svg class="dep-banner__icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <p class="dep-banner__text">{DEPRECATION.message}</p>
    {#if DEPRECATION.dismissible}
      <button class="dep-banner__close" onclick={dismiss} aria-label="Dismiss notice">×</button>
    {/if}
  </div>
{/if}

<style>
  .dep-banner {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 2.75rem;
    border: 1px solid rgba(240, 185, 77, 0.45);
    border-left: 4px solid #f0b94d;
    border-radius: 10px;
    background: #14172a;
    color: #ece8df;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  /* Retirement (final) state reads warmer/redder than the amber heads-up. */
  .dep-banner.retired {
    border-color: rgba(224, 122, 95, 0.5);
    border-left-color: #e07a5f;
  }
  .dep-banner__icon {
    flex: 0 0 auto;
    color: #f0b94d;
  }
  .dep-banner.retired .dep-banner__icon {
    color: #e07a5f;
  }
  .dep-banner__text {
    margin: 0;
    flex: 0 1 auto;
    text-align: center;
  }
  .dep-banner__close {
    position: absolute;
    right: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    appearance: none;
    border: none;
    background: transparent;
    color: #aab0d2;
    font-size: 1.4rem;
    line-height: 1;
    padding: 0 4px;
    cursor: pointer;
    border-radius: 6px;
  }
  .dep-banner__close:hover {
    color: #ece8df;
  }
  .dep-banner__close:focus-visible {
    outline: 2px solid #54d8d2;
    outline-offset: 2px;
  }
</style>
