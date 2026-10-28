<script lang="ts">
  // "A new version is available" bar; lib/state/update.state.svelte.ts decides when it shows. It sits
  // at the top so it never covers the floating Sections / Back to top buttons on phones. The status
  // region is always mounted and only its content changes, which is what screen readers announce.
  import { updateNotice } from '../lib/state/update.state.svelte';
</script>

<div role="status">
  {#if updateNotice.available && !updateNotice.dismissed}
    <div class="update-notice">
      <span class="un-text">A new version of ArkGrid Optimizer is available. Reload to use it.</span>
      <span class="un-actions">
        <button type="button" class="un-reload" onclick={() => location.reload()}>Reload</button>
        <button type="button" class="un-later" onclick={() => (updateNotice.dismissed = true)}>
          Later
        </button>
      </span>
    </div>
  {/if}
</div>

<style>
  .update-notice {
    position: fixed;
    top: calc(0.75rem + env(safe-area-inset-top, 0px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 1003; /* above the floating section nav (1002) */
    box-sizing: border-box;
    width: min(34rem, calc(100vw - 2rem));
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.9rem;
    padding: 0.65rem 0.85rem;
    border-radius: 0.6rem;
    border: 1px solid #3d4659;
    background: #1c2230;
    color: #eef2f8;
    font-size: 0.9rem;
    line-height: 1.35;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .un-actions {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }
  .un-actions button {
    padding: 0.35rem 0.85rem;
    border-radius: 0.4rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .un-reload {
    background: #3076c9; /* 4.6:1 with white text */
    border: 1px solid #3076c9;
    color: #fff;
  }
  .un-later {
    background: transparent;
    border: 1px solid #56607a;
    color: #dfe4ee;
  }
  .un-actions button:focus-visible {
    outline: 2px solid #8ab4ff;
    outline-offset: 2px;
  }
</style>
