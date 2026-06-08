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

  function enforceSingleDigit(v: number, minimum: number, maximum: number) {
    // If a value already exists, typing another digit makes it 10 or more. In that case, use only the last digit.
    if (v > 10) {
      v = v % 10;
    }
    return Math.min(maximum, Math.max(minimum, v));
  }

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

  // Reset if the gem's willpower is out of the allowed range
  $effect(() => {
    if (gemInput.willPower < ArkGridGemSpecs[gemInput.name].req - 5) {
      gemInput.willPower = ArkGridGemSpecs[gemInput.name].req - 5;
    }
    if (gemInput.willPower > ArkGridGemSpecs[gemInput.name].req - 1) {
      gemInput.willPower = ArkGridGemSpecs[gemInput.name].req - 1;
    }
  });
</script>

<div class="content">
  <div class="col">
    <div class="image-wrapper">
      <img src={getGemImage(gemAttr, gemInput.name)} alt={gemInput.name} />
    </div>
    <label>
      <select bind:value={gemInput.name}>
        {#each availableGemSpecs as spec}
          <option value={spec.key}>{spec.spec.name[locale].split(' ').at(-1)}</option>
        {/each}
      </select>
    </label>
  </div>
  <div class="col">
    <div class="row">
      <label>
        <!-- svelte 5 function binding -->
        <input
          bind:value={
            () => gemInput.willPower,
            (v) => (gemInput.willPower = enforceSingleDigit(v, gemSpec.req - 5, gemSpec.req - 1))
          }
          type="number"
          min={gemSpec.req - 5}
          max={gemSpec.req - 1}
        />
      </label>
      <div class="image-wrapper">
        <img src={imgWillPower} alt="Willpower" />
      </div>
    </div>
    <div class="row">
      <label>
        <input
          bind:value={
            () => gemInput.corePoint, (v) => (gemInput.corePoint = enforceSingleDigit(v, 1, 5))
          }
          type="number"
          min="1"
          max="5"
        />
      </label>
      <div class="image-wrapper">
        <img src={imgCorePoint} alt="Points" />
      </div>
    </div>
  </div>
  <div class="col">
    {#each [gemInput.optionA, gemInput.optionB] as gemOption}
      <div class="row">
        <label>
          <select bind:value={gemOption.optionType}>
            {#each Object.values(ArkGridGemOptionNames) as option}
              <option value={option} disabled={!availableGemOptionTypes.some((v) => v === option)}
                >{ArkGridGemOptionTypes[option].name[locale]}</option
              >
            {/each}
          </select>
        </label>
        <label>
          Lv.
          <input
            bind:value={
              () => gemOption.value, (v) => (gemOption.value = enforceSingleDigit(v, 1, 5))
            }
            type="number"
            min="1"
            max="5"
          />
        </label>
      </div>
    {/each}
  </div>
</div>

<style>
  .content {
    display: flex;
    flex-direction: row;
    gap: 1rem;
  }
  /* On phones the three fixed-width columns can't fit the modal side-by-side, so the
     options column gets clipped off the right edge. Stack them vertically instead, which
     also lets the auto-sized dialog shrink back within the viewport. */
  @media (max-width: 767px) {
    .content {
      flex-direction: column;
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    justify-content: center;
    align-items: center;
  }
  .row {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  .image-wrapper {
    display: flex;
    align-items: center; /* vertical center */
    justify-content: center; /* horizontal center (optional) */
  }
  .image-wrapper img {
    margin: auto;
  }

  input,
  option,
  select {
    font-size: 1rem;
    /* Wide enough for the longest option label ("Additional Damage") to clear the dropdown caret
       instead of running under it. */
    width: 10.5rem;
  }

  input[type='number'] {
    width: 2rem;
    min-height: 2.75rem;
  }

  /* Match the inputs' height so the option dropdowns sit on the same line as the willpower/points
     rows instead of riding ~13px high at the top of their flex cell. */
  select {
    min-height: 2.75rem;
  }
</style>
