<script lang="ts">
  import { ArkGridAttrs, type LocalizationName } from '../lib/constants/enums';
  import { LDealeer, LSupporter } from '../lib/constants/localization';
  import { ArkGridCoreTypes } from '../lib/models/arkGridCores';
  import { appConfig, toggleUI } from '../lib/state/appConfig.state.svelte';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import {
    type BuildRole,
    type CharacterProfile,
    imgRoleCombat,
    imgRoleSupporter,
    isActiveSupporter,
    setActiveBuild,
    setDualRole,
  } from '../lib/state/profile.state.svelte';
  import ArkGridCoreEditElement from './ArkGridCoreEditElement.svelte';
  import BuildViewSwitch from './BuildViewSwitch.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  let locale = $derived(appLocale.current);
  const LTitle: LocalizationName = {
    en_us: 'Core Setting',
  };
  const LShowCoeff: LocalizationName = {
    en_us: 'Display Core Coeff.',
  };
  const LHideCoeff: LocalizationName = {
    en_us: 'Hide Core Coeff.',
  };
  const LRole: LocalizationName = { en_us: 'Role' };
  const LBoth: LocalizationName = { en_us: 'Both' };

  const attrs = Object.values(ArkGridAttrs);
  const ctypes = Object.values(ArkGridCoreTypes);

  let isSupporter = $derived(isActiveSupporter(profile));
  // 'both' when the character plays both roles; otherwise the single active role.
  type RoleMode = BuildRole | 'both';
  let roleMode: RoleMode = $derived(profile.dualRole ? 'both' : profile.activeBuild);

  function selectRoleMode(mode: RoleMode) {
    // Non-destructive in every direction: each build's stored cores are preserved regardless of
    // mode. 'Both' just marks the character dual-role; the single options pick the live role.
    if (mode === 'both') {
      setDualRole(true);
    } else {
      setDualRole(false);
      setActiveBuild(mode);
    }
  }
</script>

<div class="panel">
  <div class="title-row">
    <div class="title">
      {LTitle[locale]}
      <img src={isSupporter ? imgRoleSupporter : imgRoleCombat} alt="role" />
    </div>
    <div class="role-mode" role="group" aria-label={LRole[locale]}>
      <span class="rm-label">{LRole[locale]}</span>
      <div class="seg">
        <button
          class="seg-btn"
          class:active={roleMode === 'dps'}
          onclick={() => selectRoleMode('dps')}
        >
          {LDealeer[locale]} only
        </button>
        <button
          class="seg-btn"
          class:active={roleMode === 'support'}
          onclick={() => selectRoleMode('support')}
        >
          {LSupporter[locale]} only
        </button>
        <button
          class="seg-btn"
          class:active={roleMode === 'both'}
          onclick={() => selectRoleMode('both')}
        >
          {LBoth[locale]}
        </button>
      </div>
    </div>
  </div>
  <div class="cs-view-row"><BuildViewSwitch /></div>
  {#each attrs as attr}
    {#each ctypes as ctype}
      <ArkGridCoreEditElement {attr} {ctype} {isSupporter} weapon={profile.weapon}
      ></ArkGridCoreEditElement>
    {/each}
  {/each}
  <div class="buttons">
    <button
      onclick={() => {
        toggleUI('showCoreCoeff');
      }}
    >
      {appConfig.current.uiConfig.showCoreCoeff ? LHideCoeff[locale] : LShowCoeff[locale]}
    </button>
  </div>
</div>

<style>
  .panel {
    position: relative; /* Positioning context for the overlay */
  }

  /* Button group */
  .buttons {
    /* Pin the button group to the bottom of the panel */
    margin-top: auto;
    display: flex;
    gap: 0.4rem;
    justify-content: right;
  }
  .buttons > button {
    /* Auto width, but at least 5em */
    width: auto;
    min-width: 5em;
  }
  .title-row {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem 1rem;
  }
  /* View switch sits centered beneath the title row. */
  .cs-view-row {
    display: flex;
    justify-content: center;
  }
  .title {
    display: flex;
    flex-direction: row;
    gap: 0.3rem;
    align-items: center;
    font-size: 1.4rem;
    font-weight: 700;
  }
  .title > img {
    height: 1.4rem;
    transform: translateY(1px);
  }
  /* Role-mode selector sits at the right of the title row; view switch is its own row below. */
  .role-mode {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .rm-label {
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #b8860b;
  }
  :global(.dark-mode) .rm-label {
    color: #f0c040;
  }
  /* Segmented pill group (gold theme, matching the rest of the app). */
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
    font-size: 0.85rem;
    font-weight: 700;
    padding: 0.25rem 0.7rem;
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
