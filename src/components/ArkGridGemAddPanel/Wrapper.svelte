<script lang="ts">
  import { toast } from '@zerodevx/svelte-toast';

  import type { AppLocale, ArkGridAttr, LocalizationName } from '../../lib/constants/enums';
  import { LCancel, LConfirm } from '../../lib/constants/localization';
  import type { ArkGridGemName, ArkGridGemOption } from '../../lib/models/arkGridGems';
  import { appConfig, updateUI } from '../../lib/state/appConfig.state.svelte';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import { addGem } from '../../lib/state/profile.state.svelte';
  import DropdownStyle from './DropdownStyle.svelte';
  import RadioStyle from './RadioStyle.svelte';

  type Props = {
    gemAttr: ArkGridAttr;
  };
  let { gemAttr }: Props = $props();

  let locale: AppLocale = $derived(appLocale.current);
  const LButtonTitle: LocalizationName = {
    en_us: 'Add',
  };
  const LGemAddResult: LocalizationName = {
    en_us: 'Astrogem Added',
  };
  let dialog: HTMLDialogElement;

  function open() {
    dialog.showModal();
  }
  function close() {
    dialog.close();
  }
  function confirm() {
    addGem(
      JSON.parse(
        JSON.stringify({
          gemAttr,
          name: gemInput.name,
          req: gemInput.willPower,
          point: gemInput.corePoint,
          option1: gemInput.optionA,
          option2: gemInput.optionB,
        })
      )
    );
    dialog.close();
    toast.push(LGemAddResult[locale]);
  }
  function isInvalidGemInput() {
    return gemInput.optionA.optionType === gemInput.optionB.optionType;
  }
  let newGemAddStyle = $derived<boolean>(appConfig.current.uiConfig.newGemAddStyle);
  $effect(() => {
    updateUI('newGemAddStyle', newGemAddStyle);
  });

  // Prepare the data needed for gem input

  export type GemInput = {
    name: ArkGridGemName;
    willPower: number;
    corePoint: number;
    optionA: ArkGridGemOption;
    optionB: ArkGridGemOption;
  };
  let gemInput: GemInput = $state({
    name: 'Order Astrogem: Stability',
    willPower: 3,
    corePoint: 5,
    optionA: {
      optionType: 'AtkPower',
      value: 1,
    },
    optionB: {
      optionType: 'AddDamage',
      value: 1,
    },
  });
</script>

<button onclick={open}>{LButtonTitle[locale]}</button>
<dialog
  bind:this={dialog}
  aria-label="Add Astrogem"
  onclick={(e) => {
    if (e.target === dialog) close();
  }}
>
  <div class="container">
    <div class="gem-add-style-panel">
      <input id="a" type="radio" bind:group={newGemAddStyle} value={false} />
      <label for="a">A</label>
      <input id="b" type="radio" bind:group={newGemAddStyle} value={true} />
      <label for="b">B</label>
    </div>
    {#if newGemAddStyle}
      <RadioStyle {gemAttr} bind:gemInput {locale}></RadioStyle>
    {:else}
      <DropdownStyle {gemAttr} bind:gemInput {locale}></DropdownStyle>
    {/if}

    <div class="buttons">
      <button onclick={close}>{LCancel[locale]}</button>
      <button onclick={confirm} disabled={isInvalidGemInput()}>{LConfirm[locale]}</button>
    </div>
  </div>
</dialog>

<style>
  /*
  root -
   - title
   - content
    - row
    - row
   - buttons
  */
  .container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .buttons {
    display: flex;
    gap: 1rem;
    justify-content: center;
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
  }
  .gem-add-style-panel {
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
  }

  .gem-add-style-panel label {
    display: inline-block;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    cursor: pointer;
    padding: 0.5rem;
  }

  .gem-add-style-panel input {
    display: none;
  }

  .gem-add-style-panel input:checked + label {
    background-color: var(--title-shadow);
    font-weight: bold;
  }
</style>
