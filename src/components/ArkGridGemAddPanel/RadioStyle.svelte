<script lang="ts">
  import imgCorePoint from '../../assets/corepoint.png';
  import imgWillPower from '../../assets/willpower.png';
  import type { AppLocale, ArkGridAttr } from '../../lib/constants/enums';
  import {
    type ArkGridGemName,
    ArkGridGemOptionNames,
    ArkGridGemOptionTypes,
    ArkGridGemSpecs,
    getGemImage,
  } from '../../lib/models/arkGridGems';
  import type { GemInput } from './Wrapper.svelte';

  type Props = {
    gemAttr: ArkGridAttr;
    gemInput: GemInput;
    locale: AppLocale;
  };
  let { gemAttr, gemInput = $bindable(), locale }: Props = $props();

  // Get the gemSpecs available for the current gemAttr
  let availableGemSpecs = $derived(
    Object.entries(ArkGridGemSpecs)
      .filter(([, spec]) => spec.attr === gemAttr)
      .map(([key, spec]) => ({
        key: key as ArkGridGemName,
        spec,
      }))
  );
  $effect(() => {
    // If the current name is not an available name, reset to the first one (Stability, Erosion)
    if (!availableGemSpecs.some((v) => v.key === gemInput.name)) {
      gemInput.name = availableGemSpecs[0]?.key;
    }
  });

  // 2. Get the options available for the current gemSpec
  let gemSpec = $derived(ArkGridGemSpecs[gemInput.name]);
  let availableGemOptionTypes = $derived(gemSpec.availableOptions);

  $effect(() => {
    // If the current option is not available, initialize it to an available option.
    // When initializing, ensure it does not match the opposite option.
    if (!availableGemOptionTypes.some((v) => v === gemInput.optionA.optionType)) {
      gemInput.optionA.optionType =
        gemInput.optionB.optionType === availableGemOptionTypes[0]
          ? availableGemOptionTypes[1]
          : availableGemOptionTypes[0];
      gemInput.optionA.value = 1;
    }
    if (!availableGemOptionTypes.some((v) => v === gemInput.optionB.optionType)) {
      // For B, initialize to an option that does not overlap with A.
      gemInput.optionB.optionType =
        gemInput.optionA.optionType === availableGemOptionTypes[0]
          ? availableGemOptionTypes[1]
          : availableGemOptionTypes[0];
      gemInput.optionB.value = 1;
    }
  });

  // If the gem's willpower is out of the allowed range
  $effect(() => {
    if (gemInput.willPower < ArkGridGemSpecs[gemInput.name].req - 5) {
      gemInput.willPower = ArkGridGemSpecs[gemInput.name].req - 5;
    }
    if (gemInput.willPower > ArkGridGemSpecs[gemInput.name].req - 1) {
      gemInput.willPower = ArkGridGemSpecs[gemInput.name].req - 1;
    }
  });
</script>

<div class="root">
  <!-- Gem type -->
  <fieldset class="grid large">
    {#each availableGemSpecs as spec}
      <label class="radio-card">
        <input type="radio" bind:group={gemInput.name} value={spec.key} />
        <div class="card">
          <img src={getGemImage(gemAttr, spec.key)} alt={gemInput.name} />
          <span>{spec.spec.name[locale].split(' ').at(-1)}</span>
        </div>
      </label>
    {/each}
  </fieldset>

  <!-- Willpower -->
  <fieldset class="grid small">
    <div class="card">
      <img src={imgWillPower} alt="Willpower" />
    </div>
    {#each [3, 4, 5, 6, 7, 8, 9] as willPower}
      <label class="radio-card">
        <input
          bind:group={gemInput.willPower}
          type="radio"
          value={willPower}
          disabled={willPower < gemSpec.req - 5 || willPower > gemSpec.req - 1}
        />
        <div class="card">{willPower}</div>
      </label>
    {/each}
  </fieldset>

  <!-- Points -->
  <fieldset class="grid small">
    <div class="card">
      <img src={imgCorePoint} alt="Points" />
    </div>
    {#each [1, 2, 3, 4, 5] as corePoint}
      <label class="radio-card">
        <input bind:group={gemInput.corePoint} type="radio" value={corePoint} />
        <div class="card">{corePoint}</div>
      </label>
    {/each}
  </fieldset>

  <!-- Sub-options -->
  {#each [gemInput.optionA, gemInput.optionB] as gemOption}
    <fieldset class="grid large">
      {#each Object.values(ArkGridGemOptionNames) as optionName}
        <label class="radio-card">
          <input
            bind:group={gemOption.optionType}
            type="radio"
            value={optionName}
            disabled={!availableGemOptionTypes.some((v) => v === optionName)}
          />
          <div class="card">
            {ArkGridGemOptionTypes[optionName].name[locale]}
          </div>
        </label>
      {/each}
    </fieldset>
    <fieldset class="grid small">
      <div class="card label">Lv.</div>
      {#each [1, 2, 3, 4, 5] as optionPoint}
        <label class="radio-card">
          <input bind:group={gemOption.value} type="radio" value={optionPoint} />
          <div class="card">{optionPoint}</div>
        </label>
      {/each}
    </fieldset>
  {/each}
</div>

<style>
  .root {
    /* Cap to the viewport, leaving room for the dialog's own padding/border so the
       whole modal (not just this body) fits a phone screen. */
    width: min(40rem, 100vw - 4rem);
    max-width: 100%;
    overflow-x: auto;
    user-select: none;
  }
  /* Hide the radio button */
  .radio-card input {
    display: none;
  }

  .radio-card .card {
    padding: 8px;
    cursor: pointer;
    white-space: nowrap;
    border: 1px var(--border) solid;
  }

  /* Selected state */
  .radio-card input:checked + .card {
    border-color: var(--primary);
    background-color: var(--title-shadow);
    font-weight: bold;
  }

  fieldset.grid {
    display: grid;
    gap: 8px;
    border: none;
    /* border: 1px var(--border) solid; */
  }

  /* For numbers (tight) */
  fieldset.grid.small {
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  }
  fieldset.grid.small .card {
    display: flex;
    align-items: center; /* vertical center */
    justify-content: center; /* horizontal center */
    text-align: center;
  }

  /* For text (wide) */
  fieldset.grid.large {
    grid-template-columns: repeat(3, 1fr);
  }
  .grid.large .card {
    display: flex;
    flex-direction: column; /* text below the image */
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .radio-card input:disabled + .card {
    opacity: 0.5;
    cursor: auto;
    background-color: var(--muted);
  }
  /* Lv. only */
  .card.label {
    font-weight: bold;
    background: transparent;
    border: none;
  }

  /* On narrow phones, let the wide (text) grids drop to two columns so cards fit. */
  @media (max-width: 480px) {
    fieldset.grid.large {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
