<script lang="ts">
  import { type ArkGridAttr, ArkGridAttrs } from '../../lib/constants/enums';
  import { LChaos, LOrder } from '../../lib/constants/localization';
  import { gemSetPackKey } from '../../lib/solver/utils';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import type {
    AdditionalGemResult,
    NeedLauncherGem,
    SolveAnswer,
  } from '../../lib/state/profile.state.svelte';

  type Props = {
    additionalGemResult: AdditionalGemResult;
    solveAnswer: SolveAnswer;
    needLauncherGem: NeedLauncherGem;
  };
  const { additionalGemResult, solveAnswer, needLauncherGem }: Props = $props();

  let currentKey = $derived<Record<ArkGridAttr, [number, number, number]>>({
    Order: gemSetPackKey(solveAnswer.gemSetPackTuple.gsp1),
    Chaos: gemSetPackKey(solveAnswer.gemSetPackTuple.gsp2),
  });
  const sortedAdditionalGemResult = $derived({
    Order: Object.values(additionalGemResult['Order']).sort((a, b) => b.score - a.score),
    Chaos: Object.values(additionalGemResult['Chaos']).sort((a, b) => b.score - a.score),
  });
  const isEmpty = $derived({
    Order: Object.keys(additionalGemResult['Order']).length === 0,
    Chaos: Object.keys(additionalGemResult['Chaos']).length === 0,
  });

  function prettyCorePoints(attr: ArkGridAttr, v: [number, number, number]) {
    // Display core points along with whether they increased or decreased.
    return [
      {
        value: v[0],
        increased: v[0] > currentKey[attr][0],
        decreased: v[0] < currentKey[attr][0],
      },
      {
        value: v[1],
        increased: v[1] > currentKey[attr][1],
        decreased: v[1] < currentKey[attr][1],
      },
      {
        value: v[2],
        increased: v[2] > currentKey[attr][2],
        decreased: v[2] < currentKey[attr][2],
      },
    ];
  }
  function prettyScoreDiff(v: number, o: number) {
    // Display the combat power %p difference to two decimal places.
    return `${((v - o) * 100).toFixed(2)}%`;
  }

  // i18n
  let locale = $derived(appLocale.current);
  const LTitle = $derived(
    {
      en_us: 'Next Astrogem Preview',
    }[locale]
  );
  const LAttr = { Order: LOrder, Chaos: LChaos };
  const LTitleDesc = $derived(
    {
      en_us:
        'This shows the possible combinations when an additional astrogem is added for users who have not reached 17P. ',
    }[locale]
  );
  const LCurrentPoints = $derived(
    {
      en_us: 'Current Core Points',
    }[locale]
  );
  const LMaximumPoint = $derived(
    {
      en_us: 'Maximum Points Reached.',
    }[locale]
  );
  const LCannotSucceedWithOneGem = $derived(
    {
      en_us: 'You cannot reach the next stage with only one additional astrogem.',
    }[locale]
  );
</script>

<div class="root">
  <div class="title">
    {LTitle}
    <span class="tooltip">
      <i class="fa-solid fa-circle-info info-icon"></i>
      <span class="tooltip-text">{LTitleDesc}</span>
    </span>
  </div>
  {#each Object.values(ArkGridAttrs) as attr}
    <div class="attr-container">
      <div class="title">
        <div class="main">
          {LAttr[attr][locale]}<br />
        </div>
        <div class="sub core-points">
          {LCurrentPoints}
          {#each prettyCorePoints(attr, currentKey[attr]) as cp, i}
            <span class:increased={cp.increased}>{cp.value}</span>
            {#if i < 2}
              <span class="sep">/&nbsp;</span>
            {/if}
          {/each}
        </div>
      </div>
      <div class="scenario-container">
        {#if isEmpty[attr]}
          <!-- Empty for one of two reasons: a single gem cannot reach the next stage, or no launcher gem is needed. -->
          {#if needLauncherGem[attr]}
            {LCannotSucceedWithOneGem}
          {:else}
            {LMaximumPoint}
          {/if}
        {/if}
        {#each sortedAdditionalGemResult[attr] as value}
          <div class="scenario">
            <div class="core-points">
              {#each prettyCorePoints(attr, value.corePointTuple) as cp, i}
                <span class:increased={cp.increased} class:decreased={cp.decreased}>{cp.value}</span
                >
                {#if i < 2}
                  <span class="sep">/&nbsp;</span>
                {/if}
              {/each}
              <span class="cp-diff">
                {prettyScoreDiff(value.score, solveAnswer.gemSetPackTuple.score)}
              </span>
            </div>
            <div class="gem-container">
              {#each value.gems as gem}
                <div class="gem">
                  {gem.req} / {gem.point}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 100%;
  }
  .root > .title {
    font-weight: 500;
    font-size: 1.4em;
  }
  /* Per-attribute container */
  .attr-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .attr-container > .title {
    text-align: center;
    background: linear-gradient(
      to right,
      rgba(0, 0, 0, 0) 0%,
      var(--title-shadow) 30%,
      var(--title-shadow) 70%,
      rgba(0, 0, 0, 0) 100%
    );
  }
  .attr-container > .title > .main {
    font-weight: 500;
    font-size: 1.2em;
  }
  .attr-container > .title > .sub {
    font-size: 1em;
  }

  /* Scenarios possible with an additional gem */
  .scenario-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .scenario {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .scenario .core-points::before {
    content: '‣ ';
  }
  /* Combat power change */
  .cp-diff {
    font-size: 0.85rem;
  }
  .cp-diff::before {
    content: '(+';
  }
  .cp-diff::after {
    content: ')';
  }

  /* Gems that can achieve the scenario */
  .gem-container {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .gem {
    flex: 0 0 auto;
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999em;
    padding: 0.3rem 0.6rem;
    align-items: center;
    justify-content: center;
    background-color: var(--border);
  }
</style>
