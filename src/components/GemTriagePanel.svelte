<script lang="ts">
  import {
    type ArkGridGem,
    ArkGridGemOptionNames,
    ArkGridGemOptionTypes,
  } from '../lib/models/arkGridGems';
  import {
    DPS_NODE_COEFF,
    type GemRole,
    type GemTier,
    POINT_NEUTRAL,
    POINT_STEP,
    SUPPORT_NODE_COEFF,
    type ScoreFactor,
    WILLPOWER_NEUTRAL,
    WILLPOWER_STEP,
    computeGemScore,
    explainGemScore,
  } from '../lib/scoring/gemScore';
  import {
    type TriageAction,
    attrHasUpgradeHeadroom,
    autoBaselineFromLoadout,
    effectiveBaseline,
    equippedFlags,
    reconcileDualBuild,
    triageGem,
  } from '../lib/scoring/triage';
  import { appConfig, toggleUI } from '../lib/state/appConfig.state.svelte';
  import {
    type CharacterProfile,
    activeBuildState,
    buildState,
    otherRole,
  } from '../lib/state/profile.state.svelte';
  import ArkGridGemDetail from './ArkGridGemDetail.svelte';
  import BaselineControl from './BaselineControl.svelte';
  import BuildViewSwitch from './BuildViewSwitch.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  type Row = {
    gem: ArkGridGem;
    score: number;
    tier: GemTier;
    action: TriageAction;
  };

  let worstFirst = $state(true);
  let showHelp = $state(false);

  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);

  // Equipped loadout = the gems the optimizer (Engine A) assigned across the 6 cores.
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let auto: number | null = $derived(autoBaselineFromLoadout(equipped, role));
  let baseline = $derived(effectiveBaseline(auto, build.baselineOverride));

  let rows: Row[] = $derived.by(() => {
    const owned = [...profile.gems.orderGems, ...profile.gems.chaosGems];
    const flags = equippedFlags(owned, equipped);
    const orderHeadroom = attrHasUpgradeHeadroom(build.cores.Order);
    const chaosHeadroom = attrHasUpgradeHeadroom(build.cores.Chaos);

    // Cross-build context (dual-role only): the OTHER build's role, baseline, headroom, and
    // equipped flags. A 'remove' in the active build is downgraded to 'keep' if that build uses it.
    const dual = profile.dualRole;
    const oRole = otherRole(profile.activeBuild);
    const oBuild = buildState(oRole, profile);
    const oEquipped = dual ? (oBuild.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat() : [];
    const oFlags = dual ? equippedFlags(owned, oEquipped) : [];
    const oBaseline = dual
      ? effectiveBaseline(autoBaselineFromLoadout(oEquipped, oRole), oBuild.baselineOverride)
      : 0;
    const oOrderHeadroom = dual ? attrHasUpgradeHeadroom(oBuild.cores.Order) : false;
    const oChaosHeadroom = dual ? attrHasUpgradeHeadroom(oBuild.cores.Chaos) : false;

    const scored = owned.map((gem, i) => {
      const { score, tier } = computeGemScore(gem, role);
      const hasHeadroom = gem.gemAttr === 'Order' ? orderHeadroom : chaosHeadroom;
      let result = triageGem({ score, baseline, isEquipped: flags[i], hasHeadroom });
      if (dual) {
        const oHeadroom = gem.gemAttr === 'Order' ? oOrderHeadroom : oChaosHeadroom;
        const oResult = triageGem({
          score: computeGemScore(gem, oRole).score,
          baseline: oBaseline,
          isEquipped: oFlags[i],
          hasHeadroom: oHeadroom,
        });
        result = reconcileDualBuild(result, oResult, oRole);
      }
      return { gem, score, tier, action: result.action };
    });
    scored.sort((a, b) => (worstFirst ? a.score - b.score : b.score - a.score));
    return scored;
  });

  let equippedCount = $derived(rows.filter((r) => r.action === 'equipped').length);
  let upgradeCount = $derived(rows.filter((r) => r.action === 'upgrade').length);
  let keepCount = $derived(rows.filter((r) => r.action === 'keep').length);
  let removeCount = $derived(rows.filter((r) => r.action === 'remove').length);

  const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  // Plain-text breakdown for the native hover tooltip on each score (clip-free in the scroll list).
  const scoreTitle = (factors: ScoreFactor[], score: number) =>
    [
      ...factors.map((f) => `${f.label}  ${f.detail} = ${f.value >= 0 ? '+' : ''}${r1(f.value)}`),
      `Total = ${r1(score)}`,
    ].join('\n');

  const ACTION_LABEL: Record<TriageAction, string> = {
    equipped: 'Equipped',
    upgrade: 'Upgrade',
    keep: 'Keep',
    remove: 'Remove',
  };
</script>

<div class="panel triage-panel">
  <div class="title section-title">
    Gem Triage
    <button
      class="help-toggle"
      aria-label="How the score is calculated"
      aria-pressed={showHelp}
      onclick={() => (showHelp = !showHelp)}
    >
      <span class="q-circle">?</span> Glossary
    </button>
    <BuildViewSwitch />
    <button
      class="fold-button"
      aria-label={appConfig.current.uiConfig.showGemTriage ? 'Collapse section' : 'Expand section'}
      onclick={() => toggleUI('showGemTriage')}
    >
      {appConfig.current.uiConfig.showGemTriage ? '▼' : '▲'}
    </button>
  </div>

  {#if appConfig.current.uiConfig.showGemTriage}
    {#if showHelp}
      <div class="score-help">
        <div class="sh-title">How the score is calculated</div>
        <p class="sh-eq">Score = Willpower + Chaos Points + Option&nbsp;1 + Option&nbsp;2</p>
        <ul class="sh-list">
          <li>
            <strong>Willpower</strong> = ({WILLPOWER_NEUTRAL} - level) × {WILLPOWER_STEP} - a lower willpower
            requirement scores higher.
          </li>
          <li>
            <strong>Chaos Points</strong> = (level - {POINT_NEUTRAL}) × {POINT_STEP} - more chaos points
            score higher.
          </li>
          <li>
            <strong>Each option</strong> = its level × the node coefficient below (depends on your role).
          </li>
        </ul>
        <table class="sh-coeff">
          <thead>
            {#if role === 'support'}
              <tr><th>Option</th><th class="active-lens">Support</th><th>DPS</th></tr>
            {:else}
              <tr><th>Option</th><th class="active-lens">DPS</th><th>Support</th></tr>
            {/if}
          </thead>
          <tbody>
            {#each ArkGridGemOptionNames as opt}
              <tr>
                <td>{ArkGridGemOptionTypes[opt].name.en_us}</td>
                {#if role === 'support'}
                  <td class="active-lens">{SUPPORT_NODE_COEFF[opt]}</td>
                  <td>{DPS_NODE_COEFF[opt]}</td>
                {:else}
                  <td class="active-lens">{DPS_NODE_COEFF[opt]}</td>
                  <td>{SUPPORT_NODE_COEFF[opt]}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="sh-tiers">
          <span class="tier" data-tier="Priority to Replace">
            <span class="t-name">Priority to Replace</span>
            <span class="t-range">&lt; 5</span>
          </span>
          <span class="tier" data-tier="Good for now">
            <span class="t-name">Good for now</span>
            <span class="t-range">5 - 9.99</span>
          </span>
          <span class="tier" data-tier="Very Good">
            <span class="t-name">Very Good</span>
            <span class="t-range">10 - 14.99</span>
          </span>
          <span class="tier" data-tier="Excellent">
            <span class="t-name">Excellent</span>
            <span class="t-range">≥ 15</span>
          </span>
        </div>
        <p class="sh-hint">
          Tip: <span class="hint-hover">hover</span><span class="hint-tap">tap</span> any score to see
          that gem's exact breakdown.
        </p>
      </div>
    {/if}
    <div class="controls">
      <div class="baseline-slot">
        <BaselineControl {profile} />
      </div>
    </div>

    <div class="summary-row">
      <div class="summary">
        <span>{rows.length} gems scored ({role === 'support' ? 'Support' : 'DPS'} role)</span>
        <span class="breakdown">
          {#if equippedCount > 0}
            <span class="eq">{equippedCount} equipped</span>
          {/if}
          {#if upgradeCount > 0}
            <strong class="up"
              >{upgradeCount} potential upgrade{upgradeCount === 1 ? '' : 's'}</strong
            >
          {/if}
          {#if keepCount > 0}
            <span class="kp">{keepCount} to hold</span>
          {/if}
          {#if removeCount > 0}
            <strong class="rm">{removeCount} removal candidate{removeCount === 1 ? '' : 's'}</strong
            >
          {/if}
          {#if rows.length > 0 && equippedCount === 0 && upgradeCount === 0 && keepCount === 0 && removeCount === 0}
            No upgrades or removal candidates.
          {/if}
        </span>
        {#if keepCount > 0}
          <span class="note">
            Gems below your weakest equipped are kept, not flagged for removal, while their cores
            aren't maxed - a core upgrade could still slot them. Removal only appears once that
            attribute's cores are all Ancient.
          </span>
        {/if}
        {#if profile.dualRole}
          <span class="note">
            Dual-role: a gem your {role === 'support' ? 'DPS' : 'Support'} build still uses is never
            flagged Remove (run the optimizer on both builds first).
          </span>
        {/if}
        {#if role === 'support'}
          <span class="note">
            Note: ArkGrid combat power overstates support value (~2x). Treat tiers as relative, not
            absolute.
          </span>
        {/if}
      </div>
      {#if rows.length > 0}
        <button class="sort-toggle" onclick={() => (worstFirst = !worstFirst)}>
          Sort: {worstFirst ? 'worst first' : 'best first'}
        </button>
      {/if}
    </div>

    {#if rows.length > 0}
      <div class="rows">
        {#each rows as row (row.gem)}
          {@const factors = explainGemScore(row.gem, role)}
          <div
            class="triage-row"
            class:equipped={row.action === 'equipped'}
            class:remove={row.action === 'remove'}
            class:upgrade={row.action === 'upgrade'}
          >
            <div class="gem-cell">
              <ArkGridGemDetail gem={row.gem} showDeleteButton={false} />
            </div>
            <div class="badges">
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <span class="score-pop" tabindex="0" title={scoreTitle(factors, row.score)}>
                <span class="score">{r1(row.score)}</span>
                <span class="tooltip-text score-breakdown">
                  {#each factors as f}
                    <span class="sf">
                      <span>{f.label}</span>
                      <span>{f.detail} = {f.value >= 0 ? '+' : ''}{r1(f.value)}</span>
                    </span>
                  {/each}
                  <span class="sf sf-total">
                    <span>Total</span>
                    <span>{r1(row.score)}</span>
                  </span>
                </span>
              </span>
              <span class="tier" data-tier={row.tier}>{row.tier}</span>
              <span class="action" data-action={row.action}>{ACTION_LABEL[row.action]}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">No astrogems recognized yet - run gem recognition first.</div>
    {/if}
  {/if}
</div>

<style>
  .triage-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  /* "? Glossary" pill sits next to the fold marker on the right, in the gold theme. */
  .help-toggle {
    width: auto;
    min-width: 0;
    /* Don't let a long section title squeeze the pill — wrap the title instead. */
    flex-shrink: 0;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 700;
    font-size: 0.85rem;
    border-radius: 0.5rem;
    color: #b8860b;
    border: 1px solid rgba(184, 134, 11, 0.55);
    background: rgba(184, 134, 11, 0.1);
  }
  .q-circle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    font-size: 0.7rem;
    line-height: 1;
  }
  .help-toggle:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  :global(.dark-mode) .help-toggle {
    color: #f0c040;
    border-color: rgba(240, 192, 64, 0.55);
    background: rgba(240, 192, 64, 0.12);
  }
  :global(.dark-mode) .help-toggle:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  /* Fold marker no longer needs the auto margin (the glossary pill takes it). */
  .fold-button {
    margin-left: 0;
  }
  .score-help {
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--card-inner);
    padding: 0.75rem 1.25rem 1rem;
    font-size: 0.85rem;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .score-help p {
    margin: 0;
  }
  /* Gold key-terms, matching the Cutting Plan glossary. */
  .score-help strong {
    color: #b8860b;
  }
  :global(.dark-mode) .score-help strong {
    color: #f0c040;
  }
  .sh-title {
    font-weight: 700;
    font-size: 1.1rem;
    color: #b8860b;
  }
  :global(.dark-mode) .sh-title {
    color: #f0c040;
  }
  .sh-eq {
    font-weight: 600;
  }
  .sh-list {
    margin: 0;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .sh-coeff {
    border-collapse: collapse;
    width: max-content;
    max-width: 100%;
    font-variant-numeric: tabular-nums;
  }
  .sh-coeff th,
  .sh-coeff td {
    border: 1px solid rgba(140, 140, 160, 0.35);
    padding: 0.25rem 0.7rem;
    text-align: left;
  }
  .sh-coeff th {
    color: #b8860b;
    background: rgba(184, 134, 11, 0.1);
  }
  :global(.dark-mode) .sh-coeff th {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.1);
  }
  .sh-coeff th:not(:first-child),
  .sh-coeff td:not(:first-child) {
    text-align: right;
  }
  /* The active lens's column (shown first) is bolded + tinted so it reads as "your role". */
  .sh-coeff .active-lens {
    font-weight: 700;
    background: rgba(184, 134, 11, 0.18);
  }
  :global(.dark-mode) .sh-coeff .active-lens {
    background: rgba(240, 192, 64, 0.18);
  }
  .sh-tiers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .sh-tiers .tier {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.25;
  }
  .t-range {
    font-weight: 400;
    font-size: 0.75rem;
  }
  .sh-hint {
    opacity: 0.75;
    font-style: italic;
  }
  /* The breakdown shows on hover on desktop and on tap (focus) on touch — word the tip to match the
     device so phones don't read "hover". */
  .hint-tap {
    display: none;
  }
  @media (hover: none) {
    .hint-hover {
      display: none;
    }
    .hint-tap {
      display: inline;
    }
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: flex-end;
  }
  .baseline-slot {
    flex: 1 1 22rem;
    min-width: 18rem;
  }
  .sort-toggle {
    width: auto;
    min-width: 9rem;
    font-weight: 700;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #b8860b;
    border: 1px solid rgba(184, 134, 11, 0.55);
    background: rgba(184, 134, 11, 0.1);
  }
  .sort-toggle:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  :global(.dark-mode) .sort-toggle {
    color: #f0c040;
    border-color: rgba(240, 192, 64, 0.55);
    background: rgba(240, 192, 64, 0.12);
  }
  :global(.dark-mode) .sort-toggle:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  .summary-row {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .summary {
    flex: 1 1 20rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.9rem;
  }
  .summary .breakdown {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.75rem;
  }
  .summary .up {
    color: #2e7d32;
  }
  .summary .eq {
    color: #1565c0;
  }
  .summary .kp {
    opacity: 0.75;
  }
  .summary .rm {
    color: #c62828;
  }
  .summary .note {
    font-style: italic;
    opacity: 0.8;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 39rem;
    overflow-y: auto;
    padding-right: 0.25rem;
  }
  .triage-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.3rem 0.6rem;
  }
  /* The whole row is the card here, so drop ArkGridGemDetail's own border so it doesn't read as a
     box-in-box; the gem detail keeps its internal padding for the icon/text. */
  .gem-cell :global(.gem-box) {
    border: none;
  }
  .triage-row.equipped {
    background: rgba(21, 101, 192, 0.08);
  }
  .triage-row.remove {
    background: rgba(198, 40, 40, 0.08);
  }
  .triage-row.upgrade {
    background: rgba(46, 125, 50, 0.08);
  }
  .gem-cell {
    flex: 1 1 18rem;
    min-width: 15rem;
  }
  .badges {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .badges .score {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 3.5rem;
    text-align: right;
    cursor: help;
  }
  .tier {
    padding: 0.1rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
    color: #fff;
  }
  /* In-game grade colors, so the tier pill never shares a hue with the action pill. */
  .tier[data-tier='Excellent'] {
    background: #ce43fc; /* epic */
  }
  .tier[data-tier='Very Good'] {
    background: #0e7490; /* rare (teal) */
  }
  .tier[data-tier='Good for now'] {
    background: #b8860b; /* original goldenrod */
  }
  .tier[data-tier='Priority to Replace'] {
    background: #c62828;
  }
  .action {
    font-weight: 700;
    min-width: 4.5rem;
    text-align: center;
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .action[data-action='equipped'] {
    color: #fff;
    background: #1565c0;
  }
  .action[data-action='upgrade'] {
    color: #fff;
    background: #2e7d32;
  }
  .action[data-action='keep'] {
    background: var(--bg);
    border: 1px solid var(--border);
  }
  .action[data-action='remove'] {
    color: #fff;
    background: #c62828;
  }
  .empty {
    align-self: center;
    opacity: 0.7;
    padding: 1.5rem 0;
  }
  .score-pop {
    position: relative;
    display: inline-block;
  }
  .score-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-align: left;
    font-variant-numeric: tabular-nums;
  }
  .score-breakdown .sf {
    display: flex;
    justify-content: space-between;
    gap: 1.25rem;
  }
  .score-breakdown .sf-total {
    border-top: 1px solid var(--border);
    margin-top: 0.15rem;
    padding-top: 0.25rem;
    font-weight: 700;
  }
  /* Desktop keeps the native hover title; the styled breakdown popover is for touch (tap to focus).
     Scoped to hover:none so it never double-shows alongside the native title on desktop. */
  @media (hover: none) {
    .score-pop:focus-within .tooltip-text,
    .score-pop:focus .tooltip-text {
      visibility: visible;
      opacity: 1;
    }
  }
</style>
