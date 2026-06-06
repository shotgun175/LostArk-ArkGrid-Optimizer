<script lang="ts">
  import { type ArkGridAttr, LostArkGradeTypes, LostArkGrades } from '../lib/constants/enums';
  import { formatCoreType } from '../lib/constants/localization';
  import {
    type ArkGridCoreType,
    getCoreImage,
    getMaxCorePoint,
    resetCoreCoeff,
  } from '../lib/models/arkGridCores';
  import { appConfig } from '../lib/state/appConfig.state.svelte';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import { type WeaponInfo, addCore, getCore, resetCore } from '../lib/state/profile.state.svelte';

  type Props = {
    attr: ArkGridAttr;
    ctype: ArkGridCoreType;
    isSupporter: boolean;
    weapon: WeaponInfo | undefined;
  };
  let { attr, ctype, isSupporter, weapon }: Props = $props();
  // Combination -> image path function

  const coeffKeys = ['p10', 'p14', 'p17', 'p18', 'p19', 'p20'] as const;
  let core = $derived(getCore(attr, ctype));
  let arkGridCoreTierName: Record<ArkGridCoreType, Array<string>> = $derived.by(() => {
    return !isSupporter
      ? {
          Sun: ['Flashy Attack', 'Stable/Swift Attack', 'Others'],
          Moon: ['Smoldering Strike', 'Absorbing/Crushing Strike', 'Others'],
          Star: ['Attack', 'Weapon', 'Others'],
        }
      : {
          Sun: ['Faith Enh.', 'Flowing Magick/Fortitude Enh.', 'Others'],
          Moon: ['Echoing Brand', 'Echoing Death/Steel', 'Others'],
          Star: ['Weapon', 'Life', 'Others'],
        };
  });
  let maxCorePoint = $derived(getMaxCorePoint(core));

  let locale = $derived(appLocale.current);
  const LTitle = $derived(formatCoreType(attr, ctype, locale));
  const LRarity = $derived(
    {
      en_us: 'Rarity',
    }[locale]
  );
  const LCoretypes = $derived(
    {
      en_us: 'Type',
    }[locale]
  );
  const LCoeff = $derived(
    {
      en_us: 'Coeff.',
    }[locale]
  );
</script>

<fieldset class="core-slot">
  <legend class="core-title">
    <div class="core-img-name-tuple">
      <img src={getCoreImage(attr, ctype)} alt="{attr} {ctype}" data-grade={core?.grade} />
      {LTitle}
    </div>
    {#if core}
      <button class="close" aria-label="Close" onclick={() => resetCore(attr, ctype)}>x</button>
    {/if}
  </legend>
  {#if core}
    <div class="row core-grade">
      <span class="title">{LRarity}</span>
      <div class="input-title-tuples">
        {#each Object.values(LostArkGrades) as grade}
          <label class="input-title-tuple">
            <input
              type="radio"
              name="{attr} {ctype} grade"
              bind:group={core.grade}
              onchange={() => {
                resetCoreCoeff(core, isSupporter, weapon);
              }}
              value={grade}
            />
            {LostArkGradeTypes[grade].name[locale]}
          </label>
        {/each}
      </div>
    </div>

    {#if attr == 'Chaos'}
      <div class="row core-tier">
        <span class="title">{LCoretypes}</span>
        <div class="input-title-tuples">
          {#each arkGridCoreTierName[ctype] as tierName, tier}
            <label class="input-title-tuple">
              <input
                type="radio"
                name="{attr} {ctype} tier"
                bind:group={core.tier}
                onchange={() => {
                  resetCoreCoeff(core, isSupporter, weapon);
                }}
                value={tier}
                disabled={isSupporter && attr == 'Chaos' && ctype == 'Star' && tier == 1}
              />
              {tierName}
            </label>
          {/each}
        </div>
      </div>
    {/if}

    {#if appConfig.current.uiConfig.showCoreCoeff}
      <!-- Hidden when coefficients are turned off -->
      <div class="row core-coeffs">
        <span class="title">{LCoeff}</span>
        <div class="input-title-tuples">
          {#each coeffKeys as coeffKey}
            {#if Number(coeffKey.slice(1)) <= maxCorePoint}
              <label class="input-title-tuple">
                {coeffKey.slice(1)}P
                <input
                  type="number"
                  name="{attr} {ctype} {coeffKey}"
                  bind:value={core.coeffs[coeffKey]}
                />
              </label>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  {:else}
    <div class="row">
      <button class="add-button" onclick={() => addCore(attr, ctype)}> + </button>
    </div>
  {/if}
</fieldset>

<style>
  /* Individual core slot */
  .core-slot {
    border-radius: 0.4rem;
    border: 1px solid var(--border);
    padding: 0.75rem;
    min-height: 3rem;

    /* Inner elements */
    display: flex;
    flex-shrink: 0; /* Prevent shrinking */
    flex-direction: column;
    gap: 0.4rem;
  }
  .core-slot > .core-title {
    font-weight: 700;

    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0rem 0.5rem 0rem 0.5rem;
  }
  .core-slot > .core-title > .core-img-name-tuple {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
  }
  .core-slot > .core-title > .core-img-name-tuple > img {
    height: 2.5rem;
    border-radius: 0.5rem;
    padding: 0.1rem;
  }
  .core-slot > .core-title > button.close {
    display: flex;
    align-items: center; /* Vertically centered */
    height: 1.5rem;
  }
  .core-slot > .row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.8rem;
  }

  .core-slot .input-title-tuples {
    /* Container holding input-title-tuple items; wrapping is allowed. */
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }

  .core-slot .input-title-tuples > .input-title-tuple {
    /* Tuple of label + input, nowrap */
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.2em;
    /* white-space: nowrap; */
  }

  .core-slot > .row > .title {
    font-weight: 500;
    min-width: clamp(2rem, 10%, 3rem);
  }
  .core-slot > .core-coeffs input {
    /* Include the border in the size calculation */
    box-sizing: border-box;
    font-size: 0.9rem;
    width: 3rem;
  }
  .core-slot > .row > button.add-button {
    display: flex;
    align-items: center; /* Vertically centered */

    height: 1.5rem;
  }

  /* Official-site core css */
  .core-slot > .core-title > .core-img-name-tuple > img[data-grade='Epic'] {
    background: linear-gradient(135deg, #261331, #480d5d);
  }

  .core-slot > .core-title > .core-img-name-tuple > img[data-grade='Legendary'] {
    background: linear-gradient(135deg, #362003, #9e5f04);
  }

  .core-slot > .core-title > .core-img-name-tuple > img[data-grade='Relic'] {
    background: linear-gradient(135deg, #341a09, #a24006);
  }

  .core-slot > .core-title > .core-img-name-tuple > img[data-grade='Ancient'] {
    background: linear-gradient(135deg, #3d3325, #dcc999);
  }
</style>
