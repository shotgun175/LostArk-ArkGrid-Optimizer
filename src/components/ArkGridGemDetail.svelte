<script lang="ts">
  import imgCorePoint from '../assets/corepoint.png';
  import imgWillPower from '../assets/willpower.png';
  import type { AppLocale } from '../lib/constants/enums';
  import { type ArkGridGem, ArkGridGemOptionTypes, getGemImage } from '../lib/models/arkGridGems';
  import { appLocale } from '../lib/state/locale.state.svelte';
  import { deleteGem } from '../lib/state/profile.state.svelte';

  interface Props {
    gem: ArkGridGem;
    showDeleteButton?: boolean;
    isReplaced?: boolean;
  }

  let { gem, showDeleteButton = true, isReplaced = false }: Props = $props();
  let locale: AppLocale = $derived(appLocale.current);
</script>

<div class="gem-box" class:is-new={gem.isNew} class:is-replaced={isReplaced}>
  {#if gem.swapIndex !== undefined}
    <div class="swap-badge">{gem.swapIndex}</div>
  {/if}
  <div class="gem" data-locale={locale}>
    <div class="gem-image" data-grade={gem.grade}>
      <img src={getGemImage(gem.gemAttr, gem.name)} alt={gem.name} />
    </div>

    <div class="willPower gem-spec">
      <div class="text">{gem.req}</div>
      <img src={imgWillPower} alt="Willpower" />
    </div>

    <div class="vl"></div>

    <div class="option1 gem-spec">
      <div class="text shrinkable">
        {ArkGridGemOptionTypes[gem.option1.optionType].name[locale]}
      </div>
      <div class="text">
        Lv. {gem.option1.value}
      </div>
    </div>

    <div class="corePoint gem-spec">
      <div class="text">
        {gem.point}
      </div>
      <img src={imgCorePoint} alt="Core Points" />
    </div>

    <div class="option2 gem-spec">
      <div class="text shrinkable">
        {ArkGridGemOptionTypes[gem.option2.optionType].name[locale]}
      </div>
      <div class="text">
        Lv. {gem.option2.value}
      </div>
    </div>
  </div>
  {#if showDeleteButton}
    <div class="edit-button">
      <button onclick={() => deleteGem(gem)}>🗑️</button>
    </div>
  {/if}
</div>

<style>
  .gem-box.is-new {
    border-color: #e6a817;
    box-shadow: 0 0 0 1px #e6a817;
  }
  .gem-box.is-replaced {
    opacity: 0.5;
  }
  .swap-badge {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
    width: 0.85rem;
    height: 0.85rem;
    border-radius: 50%;
    background: var(--bg);
    border: 2px solid #e6a817;
    color: inherit;
    font-size: 0.55rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    z-index: 10;
  }
  .gem-box {
    position: relative;
    container-type: inline-size;
    /* scroll-snap-align: start; */
    border: 1px solid var(--border);
    border-radius: 0.4rem;

    min-width: 15rem;
    max-width: 40rem;
    overflow-x: hidden;

    height: 3rem;
    min-height: 3rem;
    max-height: 3rem;

    display: flex;
    align-items: stretch;
    padding: 0.4rem;
    overflow-y: hidden;
  }
  .gem-box > .edit-button {
    margin-left: auto;
  }

  /* Grid layout */
  .gem {
    /* Inner elements */
    display: grid;
    /* image (2.5rem) willpower (2rem) vertical line (1px) AtkPower Lv.5 (auto) */
    grid-template-columns: 2.5rem 2rem min-content auto;
    grid-template-rows: 1fr 1fr;
    gap: 0 0.7rem;
    height: 100%;
  }
  @container (max-width: 300px) {
    /* CSS specific to CoreGemEquipped */
    /* The English version has more text, so drop the vertical line and add a small margin for symmetry */
    .gem[data-locale='en_us'] {
      column-gap: 0.3rem;
      grid-template-columns: 2.5rem 2rem auto;
    }
    .gem[data-locale='en_us'] > .vl {
      display: none;
      height: 0%;
    }
    .gem[data-locale='en_us'] > .gem-spec {
      margin-left: 0.1rem;
    }
  }
  /* Image and vertical line that each span two rows */
  .gem-image {
    grid-column: 1;
    grid-row: 1 / span 2;
  }
  .gem > .vl {
    grid-column: 3;
    grid-row: 1 / span 2;
    height: 80%;
    margin: auto 0;
    border-left: 1px solid rgb(156, 156, 156);
  }

  /* Every inner div of a gem is a flex box */
  .gem > .gem-spec,
  .gem-image {
    display: flex;
    flex-direction: row;
    gap: 0.3rem;
    /* Vertically centered, aligned to the left */
    align-items: center;
    justify-content: flex-start;
    white-space: nowrap;
    overflow: hidden;
  }
  .gem > .gem-spec > .text {
    /* Text inside gem-spec has leftover space above, so nudge it up slightly */
    transform: translateY(-0.075rem);
  }

  img {
    object-fit: contain;
  }
  .gem-image > img {
    /* Shift the gem image 1px to the right */
    width: 100%;
    transform: translateX(0.05rem);
  }
  .gem-spec > img {
    height: 80%;
  }

  .shrinkable {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  div[data-grade] {
    border-radius: 20%;
  }
  /* Official-site core css */
  div[data-grade='Legendary'] {
    background: linear-gradient(135deg, #4d3000, #bc7d01);
  }

  div[data-grade='Relic'] {
    background: linear-gradient(135deg, #341a09, #a24006);
  }

  div[data-grade='Ancient'] {
    background: linear-gradient(135deg, #3d3325, #dcc999);
  }
</style>
