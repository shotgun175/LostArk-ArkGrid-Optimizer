<script lang="ts">
  import { DEFAULT_PROFILE_NAME } from '../lib/constants/enums';
  import { L_DEFAULT_PROFILE_NAME } from '../lib/constants/localization';
  import { appConfig } from '../lib/state/appConfig.state.svelte';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import {
    type CharacterProfile,
    currentProfileName,
    getCurrentProfile,
    imgRoleCombat,
    imgRoleSupporter,
    setCurrentProfileName,
  } from '../lib/state/profile.state.svelte';

  // Self-sufficient (like BuildViewSwitch): reads the active profile + full list from global state,
  // shows it in the nav rail, and lets the user switch profiles from a click-to-open dropdown.
  let open = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let panelEl = $state<HTMLDivElement | null>(null);
  // Fixed-position coords for the dropdown. The rail is `overflow-y: auto`, which would clip an
  // absolutely-positioned child, so the panel is `position: fixed` and placed from the trigger's
  // viewport rect (same technique as Popover.svelte).
  let pos = $state<{ left: number; top: number; width: number } | null>(null);

  let locale = $derived(appLocale.current);
  let current = $derived(getCurrentProfile());
  let profiles = $derived(appConfig.current.characterProfiles);

  // Place the panel under the trigger, clamped to the viewport; flip above it when there's no room
  // below (this is what makes it open upward inside the ≤960px fixed bottom nav). Ported from
  // Popover.svelte's reposition(), plus the trigger width so the panel is never narrower than it.
  function reposition() {
    if (!triggerEl || !panelEl) return;
    const a = triggerEl.getBoundingClientRect();
    const p = panelEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = a.left;
    let top = a.bottom + 4;
    if (left + p.width > vw - 8) left = Math.max(8, vw - 8 - p.width);
    if (left < 8) left = 8;
    if (top + p.height > vh - 8) top = Math.max(8, a.top - 4 - p.height);
    pos = { left, top, width: a.width };
  }

  // Position on open and keep it attached while the page scrolls/resizes.
  $effect(() => {
    if (open && triggerEl && panelEl) {
      reposition();
      const opts = { capture: true, passive: true } as const;
      window.addEventListener('scroll', reposition, opts);
      window.addEventListener('resize', reposition);
      return () => {
        window.removeEventListener('scroll', reposition, opts);
        window.removeEventListener('resize', reposition);
      };
    }
    pos = null;
  });

  // The nav rail is position:sticky — its own stacking context — so later-painting siblings (the
  // section panels) would cover a dropdown rendered inside it, and its backdrop wouldn't catch
  // click-away over page content. Portal the open menu to <body> so its z-index sits in the root
  // stacking context: above page content, below the ConfirmDialog modal (z 2000).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') open = false;
  }}
/>

{#snippet profileBadge(profile: CharacterProfile)}
  <span class="pns-name">
    {profile.characterName === DEFAULT_PROFILE_NAME
      ? L_DEFAULT_PROFILE_NAME[locale]
      : profile.characterName}
  </span>
  {#if profile.characterName !== DEFAULT_PROFILE_NAME}
    {#if profile.dualRole}
      <span class="role-both" aria-label="DPS and Support (Both) role">
        <img src={imgRoleCombat} alt="" />
        <img src={imgRoleSupporter} alt="" />
      </span>
    {:else}
      <img
        class="pns-role"
        src={profile.activeBuild === 'support' ? imgRoleSupporter : imgRoleCombat}
        alt={profile.activeBuild === 'support' ? 'Support role' : 'DPS role'}
      />
    {/if}
  {/if}
{/snippet}

<div class="pns">
  <div class="pns-heading">Profile</div>
  <button
    class="pns-trigger"
    bind:this={triggerEl}
    aria-haspopup="true"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {@render profileBadge(current)}
    <span class="pns-caret" aria-hidden="true">▾</span>
  </button>
</div>

{#if open}
  <div use:portal>
    <button class="pns-backdrop" aria-label="Close profile menu" onclick={() => (open = false)}
    ></button>
    <div
      class="pns-panel"
      bind:this={panelEl}
      style={pos
        ? `left:${pos.left}px; top:${pos.top}px; min-width:${pos.width}px;`
        : 'left:-9999px; top:0;'}
    >
      {#each profiles as profile}
        <button
          class="pns-row"
          class:active={profile.characterName === currentProfileName.current}
          aria-current={profile.characterName === currentProfileName.current ? 'true' : undefined}
          onclick={() => {
            setCurrentProfileName(profile.characterName);
            open = false;
          }}
        >
          {@render profileBadge(profile)}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Sits between the section links and the VIEWING block, with a divider like .nav-switch. Always
     renders (unlike VIEWING, which collapses for single-role) so "who am I on" is always visible. */
  .pns {
    margin-top: 0.4rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  /* == .nav-heading in SectionNav (gold, uppercase). */
  .pns-heading {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #b8860b;
    padding: 0.1rem 0.4rem 0.35rem;
  }
  :global(.dark-mode) .pns-heading {
    color: #f0c040;
  }
  .pns-trigger {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    /* width:100% + box-sizing keep the trigger from widening the fixed 13rem rail. */
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--card);
    padding: 0.35rem 0.5rem;
    font-size: 0.9rem;
    color: #b8860b;
    cursor: pointer;
  }
  :global(.dark-mode) .pns-trigger {
    color: #f0c040;
  }
  .pns-trigger:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  /* Ellipsis for long names (max 16 chars), like .nav-label. */
  .pns-name {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pns-caret {
    flex: 0 0 auto;
    font-size: 0.7rem;
    opacity: 0.8;
  }
  .pns-role,
  .role-both > img {
    height: 1rem;
    flex: 0 0 auto;
    box-sizing: border-box;
  }
  /* 'Both' role: the two icons overlapped slightly (mirrors ProfileEditor's .role-both). */
  .role-both {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
  }
  .role-both > img:last-child {
    margin-left: -0.3rem;
  }
  /* Invisible full-screen click-catcher; transparent so it doesn't double-dim the mobile nav. */
  .pns-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    border: none;
    border-radius: 0;
    background: transparent;
  }
  /* Fixed so it escapes the rail's overflow clip; above the mobile nav (1002), below ConfirmDialog. */
  .pns-panel {
    position: fixed;
    z-index: 1101;
    max-width: min(15rem, 92vw);
    max-height: min(60vh, 22rem);
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .pns-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    border: none;
    border-left: 2px solid transparent;
    border-radius: 0.4rem;
    background: none;
    padding: 0.4rem 0.5rem;
    font-size: 0.9rem;
    color: #b8860b;
    cursor: pointer;
  }
  :global(.dark-mode) .pns-row {
    color: #f0c040;
  }
  .pns-row:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  /* Blue selection, matching .nav-link.active in the section list. */
  .pns-row.active {
    font-weight: 700;
    border-left-color: #2f6fed;
    background: rgba(47, 111, 237, 0.24);
  }
  :global(.dark-mode) .pns-row.active {
    border-left-color: #5aa1ff;
    background: rgba(90, 161, 255, 0.22);
  }
</style>
