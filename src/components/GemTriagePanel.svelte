<script lang="ts">
  import {
    type ArkGridGem,
    ArkGridGemOptionNames,
    ArkGridGemOptionTypes,
  } from '../lib/models/arkGridGems';
  import {
    DPS_EFFECT_D,
    D_ORDER,
    D_WILLPOWER,
    type GemRank,
    type GemRole,
    SUPPORT_EFFECT_D,
    type ScoreFactor,
    computeGemScore,
    explainGemScore,
  } from '../lib/scoring/gemScore';
  import {
    type OwnedTriageInput,
    type TriageAction,
    autoBaselineFromLoadout,
    effectiveBaseline,
    triageOwnedGems,
  } from '../lib/scoring/triage';
  import { solveInputSignature } from '../lib/solver/solveSignature';
  import { sectionUI, toggleSection } from '../lib/state/appConfig.state.svelte';
  import {
    type BuildRole,
    type CharacterProfile,
    activeBuildState,
    buildState,
    otherRole,
  } from '../lib/state/profile.state.svelte';
  import { getProgressLabel, runSolve, solveState } from '../lib/state/solve.state.svelte';
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
    grade: number;
    rank: GemRank;
    action: TriageAction;
  };

  // 'default' keeps the Astrogems inventory order; 'high'/'low' sort by score.
  type SortMode = 'default' | 'high' | 'low';
  let sortMode = $state<SortMode>('default');
  let showHelp = $state(false);

  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);

  // Equipped loadout = the gems the internal solver assigned across the 6 cores.
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let auto: number | null = $derived(autoBaselineFromLoadout(equipped, role));
  let baseline = $derived(effectiveBaseline(auto, build.baselineOverride));

  // "Out of sync": a stored solve the triage relies on no longer matches the live cores + gems, so
  // its verdicts (and any withheld removals) are stale until you refresh. For a dual-role profile
  // BOTH builds count, since the refresh button re-solves both. A solve with no signature
  // (pre-feature / never run) never reads as stale.
  let solveStale = $derived.by(() => {
    const buildStaleFor = (r: BuildRole) => {
      const b = buildState(r, profile);
      const s = solveInputSignature(b.cores, profile.gems);
      const after = b.solveInfo.after;
      const endgame = b.solveInfo.endgame;
      return (
        (!!after?.inputSig && after.inputSig !== s) ||
        (!!endgame?.inputSig && endgame.inputSig !== s)
      );
    };
    if (buildStaleFor(profile.activeBuild)) return true;
    return profile.dualRole && buildStaleFor(otherRole(profile.activeBuild));
  });

  // First-run nudge: gems exist but this build has never been solved, so triage has no evidence
  // yet and nothing else on screen says the Optimize button is step 1.
  let neverRun = $derived(
    profile.gems.orderGems.length + profile.gems.chaosGems.length > 0 &&
      !build.solveInfo.after &&
      !build.solveInfo.endgame
  );

  let rows: Row[] = $derived.by(() => {
    const owned = [...profile.gems.orderGems, ...profile.gems.chaosGems];

    const activeBuild = buildState(profile.activeBuild, profile);
    const activeCurrent = activeBuild.solveInfo.after?.solveAnswer?.assignedGems;
    const activeEndgame = activeBuild.solveInfo.endgame;

    const dual = profile.dualRole;
    const oRole = otherRole(profile.activeBuild);
    const oBuild = buildState(oRole, profile);
    const oCurrent = dual ? oBuild.solveInfo.after?.solveAnswer?.assignedGems : undefined;
    const oEndgame = dual ? oBuild.solveInfo.endgame : undefined;

    // Endgame evidence is trustworthy only when its signature still matches the live cores + gems.
    // For hybrids we need BOTH builds fresh before we allow any removals.
    const sig = solveInputSignature(activeBuild.cores, profile.gems);
    const oSig = dual ? solveInputSignature(oBuild.cores, profile.gems) : '';
    const activeFresh = !!activeEndgame && activeEndgame.inputSig === sig;
    const otherFresh = !dual || (!!oEndgame && oEndgame.inputSig === oSig);
    const hasEndgameEvidence = activeFresh && otherFresh;

    // Solves whose usage should KEEP a gem: active endgame + (hybrid) the other build's current & endgame.
    const retainAssignments = [activeEndgame?.assignedGems, oCurrent, oEndgame?.assignedGems];

    const inputs: OwnedTriageInput[] = owned.map((gem) => ({
      gem,
      grade: computeGemScore(gem, role).grade,
    }));
    const results = triageOwnedGems(inputs, {
      activeCurrent,
      retainAssignments,
      baseline,
      hasEndgameEvidence,
    });

    const scored = owned.map((gem, i) => {
      const { score, grade, rank } = computeGemScore(gem, role);
      return { gem, score, grade, rank, action: results[i].action };
    });
    // 'default' leaves the Astrogems inventory order (orderGems then chaosGems) untouched.
    if (sortMode === 'high') scored.sort((a, b) => b.score - a.score);
    else if (sortMode === 'low') scored.sort((a, b) => a.score - b.score);
    return scored;
  });

  let equippedCount = $derived(rows.filter((r) => r.action === 'equipped').length);
  let upgradeCount = $derived(rows.filter((r) => r.action === 'upgrade').length);
  let keepCount = $derived(rows.filter((r) => r.action === 'keep').length);
  let removeCount = $derived(rows.filter((r) => r.action === 'remove').length);

  // Score is real % damage: the headline shows 2 dp + "%", the per-line factors 4 dp.
  const pct = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)}%`;
  const f4 = (n: number) => (Math.round(n * 1e4) / 1e4).toFixed(4);
  // Plain-text breakdown for the native hover tooltip on each score (clip-free in the scroll list).
  const scoreTitle = (factors: ScoreFactor[], score: number) =>
    [
      ...factors.map((f) => `${f.label}  ${f.detail} = ${f.value >= 0 ? '+' : ''}${f4(f.value)}`),
      `Total = ${pct(score)}`,
    ].join('\n');

  const ACTION_LABEL: Record<TriageAction, string> = {
    equipped: 'Equipped',
    upgrade: 'Upgrade',
    keep: 'Keep',
    remove: 'Remove',
  };

  // Lock the row list to exactly one gem per mouse-wheel notch. Mandatory scroll-snap alone lands on
  // the NEAREST snap point, so a notch whose pixel delta exceeds ~1.5 rows skips two gems at once
  // (Chromium ignores scroll-snap-stop for wheel scrolling), so we drive one row-step per notch here.
  let rowsEl = $state<HTMLDivElement>();
  function onRowsWheel(e: WheelEvent) {
    const el = rowsEl;
    if (!el || el.scrollHeight <= el.clientHeight) return; // nothing to scroll — let the page take it
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 40) return; // leave trackpad pixel-scroll to native
    const dir = Math.sign(e.deltaY);
    if (dir === 0) return;
    // At the list's top/bottom edge, let the notch bubble so the page scrolls normally.
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
    if ((dir < 0 && atTop) || (dir > 0 && atBottom)) return;
    e.preventDefault();
    // Snap step = distance between adjacent row tops (row height + gap); measure it live.
    const rowEls = el.querySelectorAll<HTMLElement>('.triage-row');
    const step =
      rowEls.length >= 2
        ? rowEls[1].getBoundingClientRect().top - rowEls[0].getBoundingClientRect().top
        : (rowEls[0]?.getBoundingClientRect().height ?? 0);
    if (step) el.scrollBy({ top: dir * step, behavior: 'smooth' });
  }

  // After a solve finishes (Optimize runs the full solve), snap the row list
  // back to the first gem so the freshly-scored list starts at the top instead of wherever it
  // happened to be scrolled before.
  let wasSolving = false;
  $effect(() => {
    const solving = solveState.isSolving;
    if (wasSolving && !solving && rowsEl) rowsEl.scrollTop = 0;
    wasSolving = solving;
  });
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
      aria-label={sectionUI.showGemTriage ? 'Collapse section' : 'Expand section'}
      onclick={() => toggleSection('showGemTriage')}
    >
      {sectionUI.showGemTriage ? '▼' : '▲'}
    </button>
  </div>

  {#if sectionUI.showGemTriage}
    {#if showHelp}
      <div class="score-help">
        <div class="sh-title">How the score is calculated</div>
        <p class="sh-eq">
          Score (% damage) = Willpower + Order&nbsp;Points + Option&nbsp;1 + Option&nbsp;2
        </p>
        <ul class="sh-list">
          <li>
            Each line is real <strong>% damage</strong> (D = 100·ln of its multiplier), so they add up
            to the gem's approximate total % damage. A perfect gem is ≈ 1.4%.
          </li>
          <li>
            <strong>Willpower</strong> = (4 - req) × {f4(D_WILLPOWER)} per cost-level - a lower willpower
            requirement scores higher.
          </li>
          <li>
            <strong>Order Points</strong> = level × {f4(D_ORDER)} - flat per point.
          </li>
          <li>
            <strong>Each option</strong> = its level × the per-level % damage below (depends on your
            role).
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
                  <td class="active-lens">{f4(SUPPORT_EFFECT_D[opt])}</td>
                  <td>{f4(DPS_EFFECT_D[opt])}</td>
                {:else}
                  <td class="active-lens">{f4(DPS_EFFECT_D[opt])}</td>
                  <td>{f4(SUPPORT_EFFECT_D[opt])}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="sh-eq">Grade &amp; rank</p>
        <ul class="sh-list">
          <li>
            Each gem also gets a <strong>0-100 grade</strong> (0 = worst possible, 100 = a perfect
            gem) and a letter <strong>rank</strong>. Cutoffs: S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40, D ≥
            20, F ≥ 0 - each split into +/·/- thirds (S+, S, S-, A+ …).
          </li>
        </ul>
        <div class="sh-ranks">
          {#each ['S+', 'S', 'A', 'B', 'C', 'D', 'F'] as rk}
            <span class="rank" data-rank={rk}>{rk}</span>
          {/each}
        </div>
        <p class="sh-hint">
          Tip: <span class="hint-hover">hover</span><span class="hint-tap">tap</span> any score to see
          that gem's exact breakdown.
        </p>
      </div>
    {/if}
    <div class="refresh-slot">
      <button
        class="optimize-cta"
        onclick={() => runSolve(profile)}
        disabled={solveState.isSolving}
      >
        {solveState.isSolving ? 'Optimizing...' : 'Optimize'}
      </button>
      <div class="cta-hint">Runs the solver and refreshes all triage verdicts.</div>
      {#if solveState.isSolving}
        <div class="compact-progress">
          <div class="compact-progress-label">
            {Math.round(solveState.progress?.totalPercent ?? 0)}% · {getProgressLabel(
              solveState.progress
            )}
          </div>
          <div
            class="compact-progress-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={solveState.progress?.totalPercent ?? 0}
          >
            <div
              class="compact-fill"
              style={`width: ${solveState.progress?.totalPercent ?? 0}%`}
            ></div>
          </div>
        </div>
      {/if}
      {#if solveStale && !solveState.isSolving}
        <div class="stale-badge">
          ⟳ Inputs changed since the last analysis. Re-run Optimize to update the results.
        </div>
      {/if}
      {#if neverRun && !solveStale && !solveState.isSolving}
        <div class="stale-badge">
          No analysis yet. Optimize to score your gems and find removal candidates.
        </div>
      {/if}
    </div>

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
            Gems below your baseline tier are kept, not flagged for removal, as long as your current
            grid or a fully-maxed (all-Ancient) grid would still slot them. Removal only appears for
            gems no grid — current or maxed — would use.
          </span>
        {/if}
        {#if profile.dualRole}
          <span class="note">
            Dual-role: a gem either build still uses (now or at a maxed grid) is never flagged
            Remove. Use Optimize to analyze both builds first.
          </span>
        {/if}
      </div>
      {#if rows.length > 0}
        <div class="sort-group" role="group" aria-label="Sort order">
          <button
            class="sort-seg"
            class:active={sortMode === 'default'}
            aria-pressed={sortMode === 'default'}
            title="Astrogems inventory order"
            onclick={() => (sortMode = 'default')}
          >
            Default
          </button>
          <button
            class="sort-seg arrow"
            class:active={sortMode === 'high'}
            aria-pressed={sortMode === 'high'}
            aria-label="Highest score first"
            title="Highest score first"
            onclick={() => (sortMode = 'high')}
          >
            ↑
          </button>
          <button
            class="sort-seg arrow"
            class:active={sortMode === 'low'}
            aria-pressed={sortMode === 'low'}
            aria-label="Lowest score first"
            title="Lowest score first"
            onclick={() => (sortMode = 'low')}
          >
            ↓
          </button>
        </div>
      {/if}
    </div>

    {#if rows.length > 0}
      <div class="rows" bind:this={rowsEl} onwheel={onRowsWheel}>
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
                <span class="score">{pct(row.score)}</span>
                <span class="tooltip-text score-breakdown">
                  {#each factors as f}
                    <span class="sf">
                      <span>{f.label}</span>
                      <span>{f.detail} = {f.value >= 0 ? '+' : ''}{f4(f.value)}</span>
                    </span>
                  {/each}
                  <span class="sf sf-total">
                    <span>Total</span>
                    <span>{pct(row.score)}</span>
                  </span>
                </span>
              </span>
              <span class="rank" data-rank={row.rank} title="Grade {row.grade} / 100"
                >{row.rank}</span
              >
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
    /* Establish a container so the row-list can react to the panel's real width (which drives
       whether a row's badges wrap), not the viewport — the side nav shifts that mapping. */
    container-type: inline-size;
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
  .sh-ranks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
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
  .refresh-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }
  /* Primary CTA: the one solver trigger in the app, sized like the retired Run Optimization
     button. Filled gold so it can't be mistaken for the outline pills (Glossary, sort). */
  .optimize-cta {
    width: 15rem;
    max-width: 100%;
    height: 4rem;
    font-size: 1.5rem;
    font-weight: 700;
    border: none;
    border-radius: 0.5rem;
    color: #2a2010;
    background: linear-gradient(90deg, #b8860b 0%, #f0c040 100%);
  }
  /* The global button:hover only swaps background-color, invisible under a gradient image. */
  @media (hover: hover) and (pointer: fine) {
    .optimize-cta:hover:not(:disabled) {
      filter: brightness(1.07);
    }
  }
  .optimize-cta:active {
    filter: brightness(1.07);
  }
  /* Restate the gradient: the global button:disabled shorthand would replace it with var(--muted). */
  .optimize-cta:disabled {
    opacity: 0.6;
    background: linear-gradient(90deg, #b8860b 0%, #f0c040 100%);
  }
  .cta-hint {
    font-size: 0.85rem;
    opacity: 0.75;
    text-align: center;
  }
  /* Gold "inputs changed" badge under the refresh button. */
  .stale-badge {
    align-self: center;
    max-width: 32rem;
    text-align: center;
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.4rem 0.8rem;
    border-radius: 0.4rem;
    color: #b8860b;
    background: rgba(184, 134, 11, 0.12);
    border: 1px solid rgba(184, 134, 11, 0.55);
  }
  :global(.dark-mode) .stale-badge {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
    border-color: rgba(240, 192, 64, 0.55);
  }
  .compact-progress {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.15rem;
    width: min(24rem, 100%);
  }
  .compact-progress-label {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
  }
  .compact-progress-bar {
    width: 100%;
    height: 0.25rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--border) 70%, white);
    overflow: hidden;
  }
  .compact-progress-bar > .compact-fill {
    height: 100%;
    background: linear-gradient(90deg, #b8860b 0%, #f0c040 100%);
    transition: width 160ms ease-out;
  }
  /* Compact three-way sort: Default (inventory order) + up/down arrows for high/low. */
  .sort-group {
    display: inline-flex;
    align-self: flex-start;
    border: 1px solid rgba(184, 134, 11, 0.55);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .sort-seg {
    width: auto;
    min-width: 0;
    border: none;
    border-radius: 0;
    font-weight: 700;
    font-size: 0.9rem;
    padding: 0.4rem 0.7rem;
    color: #b8860b;
    background: rgba(184, 134, 11, 0.1);
  }
  .sort-seg.arrow {
    min-width: 2.2rem;
    font-size: 1.05rem;
    line-height: 1;
  }
  .sort-seg + .sort-seg {
    border-left: 1px solid rgba(184, 134, 11, 0.4);
  }
  .sort-seg:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  .sort-seg.active {
    background: rgba(184, 134, 11, 0.32);
  }
  :global(.dark-mode) .sort-group {
    border-color: rgba(240, 192, 64, 0.55);
  }
  :global(.dark-mode) .sort-seg {
    color: #f0c040;
    background: rgba(240, 192, 64, 0.12);
  }
  :global(.dark-mode) .sort-seg + .sort-seg {
    border-left-color: rgba(240, 192, 64, 0.4);
  }
  :global(.dark-mode) .sort-seg:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  :global(.dark-mode) .sort-seg.active {
    background: rgba(240, 192, 64, 0.34);
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
    /* One triage row = 3rem gem art + 0.8rem gem padding (0.4rem top+bottom) + 0.6rem row
       padding (0.3rem top+bottom) + 2px row border. Kept as a variable so the visible-row cap
       below stays correct if the row's box model ever changes. */
    --triage-row-h: calc(3rem + 0.8rem + 0.6rem + 2px);
    --triage-row-gap: 0.5rem;
    --triage-visible-rows: 9;
    gap: var(--triage-row-gap);
    /* Cap the list at exactly 9 rows (mirrors the in-game inventory column) and never show a
       clipped gem: mandatory scroll snapping lands every scroll on a row's top edge, so scrolling
       never leaves half a gem peeking. Shrinks to content when there are fewer than 9 gems. */
    max-height: calc(
      var(--triage-visible-rows) * var(--triage-row-h) + (var(--triage-visible-rows) - 1) *
        var(--triage-row-gap)
    );
    overflow-y: auto;
    scroll-snap-type: y mandatory;
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
    scroll-snap-align: start;
  }
  /* When the panel gets narrow enough that a row's badges wrap under the gem, rows grow taller
     and a fixed 9-row cap would clip the bottom row. Below that width, let the list flow with the
     page instead of capping it — nothing is clipped, and the 9-row/in-game framing is a desktop
     concept anyway. Container-width (not viewport) so it tracks the actual wrap point: rows go
     single-line above ~34.25rem of panel content width, so switch just above that. */
  @container (max-width: 34.5rem) {
    .rows {
      max-height: none;
      scroll-snap-type: none;
    }
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
  /* Letter-rank badge, colored by band (F/D gray, C green, B blue, A purple, S pink). */
  .rank {
    padding: 0.1rem 0.5rem;
    border-radius: 0.5rem;
    font-size: 0.8rem;
    font-weight: 800;
    white-space: nowrap;
    min-width: 2.5rem;
    text-align: center;
    color: #fff;
    font-variant-numeric: tabular-nums;
    background: #6f747a; /* default: F / D */
  }
  .rank[data-rank^='C'] {
    background: #4f9d5d;
  }
  .rank[data-rank^='B'] {
    background: #3b7fd0;
  }
  .rank[data-rank^='A'] {
    background: #7e5cc0;
  }
  .rank[data-rank^='S'] {
    background: #c95f85;
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
