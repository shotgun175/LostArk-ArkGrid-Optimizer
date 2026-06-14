<script lang="ts">
  import { LDealer, LSupporter } from '../lib/constants/localization';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import { getCurrentProfile, setActiveBuild } from '../lib/state/profile.state.svelte';

  // Self-sufficient: reads the active profile from global state so it can be dropped into any
  // section header (or the nav) without prop threading. Renders nothing unless the character is
  // dual-role; every instance shares the one `activeBuild`, so flipping it anywhere syncs all.
  // `compact` stacks the label over a full-width segmented control to fit a narrow column (the nav).
  let { compact = false }: { compact?: boolean } = $props();
  let locale = $derived(appLocale.current);
  let profile = $derived(getCurrentProfile());
</script>

{#if profile.dualRole}
  <div class="build-view-switch" class:compact role="group" aria-label="Viewing build">
    <span class="bvs-label">Viewing</span>
    <div class="seg">
      <button
        class="seg-btn"
        class:active={profile.activeBuild === 'dps'}
        onclick={() => setActiveBuild('dps')}
      >
        {LDealer[locale]}
      </button>
      <button
        class="seg-btn"
        class:active={profile.activeBuild === 'support'}
        onclick={() => setActiveBuild('support')}
      >
        {LSupporter[locale]}
      </button>
    </div>
  </div>
{/if}

<style>
  .build-view-switch {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  /* Compact (nav) variant: label on top, full-width segmented control beneath, so it fits a narrow
     fixed-width column without widening it. */
  .build-view-switch.compact {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
  }
  .build-view-switch.compact .seg {
    width: 100%;
  }
  .build-view-switch.compact .seg-btn {
    flex: 1;
    text-align: center;
  }
  .bvs-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #b8860b;
  }
  :global(.dark-mode) .bvs-label {
    color: #f0c040;
  }
  /* Gold segmented pill, matching the role-mode control in the Core panel. */
  .seg {
    display: inline-flex;
    border: 1px solid rgba(184, 134, 11, 0.55);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .seg-btn {
    width: auto;
    min-width: 0;
    border: none;
    border-radius: 0;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    color: #b8860b;
    background: rgba(184, 134, 11, 0.08);
  }
  .seg-btn:not(:last-child) {
    border-right: 1px solid rgba(184, 134, 11, 0.4);
  }
  .seg-btn:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  .seg-btn.active {
    color: #fff;
    background: #b8860b;
  }
  :global(.dark-mode) .seg-btn {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.1);
  }
  :global(.dark-mode) .seg-btn:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  :global(.dark-mode) .seg-btn.active {
    color: #1a1a1a;
    background: #f0c040;
  }
</style>
