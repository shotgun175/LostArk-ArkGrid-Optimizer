<script lang="ts">
  import {
    actionLabel,
    bracketLabel,
    getDpsPlan,
    getSupportPlan,
    weeksBand,
  } from '../lib/cutplan/cutPlan';
  import pipelineTableData from '../lib/cutplan/pipelineTable.json';
  import supportData from '../lib/cutplan/supportCutQuality.json';
  import {
    ARCHETYPES,
    type Archetype,
    BUCKETS,
    type BindingMode,
    type CutAction,
    GOLD_BRACKETS,
    type GoldBracket,
    type PipelineTable,
    type SupportCutQuality,
  } from '../lib/cutplan/types';
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import { type GemRole } from '../lib/scoring/gemScore';
  import { autoBaselineFromLoadout, effectiveBaseline } from '../lib/scoring/triage';
  import { appConfig, toggleUI } from '../lib/state/appConfig.state.svelte';
  import {
    type CharacterProfile,
    activeBuildState,
    updateBindingMode,
    updateGoldPer1Pct,
  } from '../lib/state/profile.state.svelte';
  import BaselineControl from './BaselineControl.svelte';
  import BuildViewSwitch from './BuildViewSwitch.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  const table = pipelineTableData as unknown as PipelineTable;

  let showHelp = $state(false);

  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let auto = $derived(autoBaselineFromLoadout(equipped, role));
  // baseline is an integer score; round once here so both integer-keyed lookups stay consistent.
  let baseline = $derived(Math.round(effectiveBaseline(auto, build.baselineOverride)));
  let bracket: GoldBracket = $derived(profile.goldPer1Pct ?? '2_5M');
  let binding: BindingMode = $derived(profile.bindingMode ?? 'nrb');

  let dps = $derived(getDpsPlan(table, bracket, binding, baseline));
  let supportPlan = $derived(getSupportPlan(supportData as unknown as SupportCutQuality, baseline));
  // CP% headroom = how much CP the active build can still gain by cutting better gems (reuses the
  // optimizer's per-build scoreSet, so it's consistent with the Optimization bar). Grid-level.
  let scoreSet = $derived(build.solveInfo.after?.scoreSet);
  let cpHeadroom = $derived(scoreSet ? scoreSet.bestScore - scoreSet.score : null);

  function onBracket(e: Event) {
    updateGoldPer1Pct((e.target as HTMLSelectElement).value as GoldBracket);
  }
  function onBinding() {
    updateBindingMode(binding === 'nrb' ? 'rb' : 'nrb');
  }
  const fmtGold = (g: number | null) =>
    g == null ? '-' : g >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(g);
  // Split the embedded gold string ("X/wk (Y total)") onto two lines so the tile isn't squished.
  // Drop the "/wk" - the tile label already says "Gold / wk".
  const goldLines = (s: string): [string, string] => {
    const i = s.indexOf('(');
    const head = (i < 0 ? s : s.slice(0, i)).replace(/\/wk/i, '').trim();
    const tail = i < 0 ? '' : s.slice(i).trim();
    return [head, tail];
  };

  // Archetype code (UC8 / R9 / E10) → in-game rarity + display label.
  const RARITY = { U: 'uncommon', R: 'rare', E: 'epic' } as const;
  const RARITY_NAME = { U: 'Uncommon', R: 'Rare', E: 'Epic' } as const;
  const rarityKey = (a: Archetype) => a[0] as keyof typeof RARITY;
  const rarityOf = (a: Archetype) => RARITY[rarityKey(a)];
  const archLabel = (a: Archetype) => `${RARITY_NAME[rarityKey(a)]} (${a.replace(/\D/g, '')})`;
  // Compact action label for the in-card pills ("Cut + reset" → "↻ Reset").
  const pillLabel = (a: CutAction) => (a === 'cut-reset' ? '↻ Reset' : actionLabel(a));

  // Pipeline stat tiles (DPS). Tooltips explain each metric.
  const STAT_TIPS = {
    weeks: 'Estimated weeks to fill all 24 grid slots at this gold budget and baseline.',
    directWk: 'Gems per week obtained by directly cutting raw gems to your target.',
    fuseWk: 'Gems per week obtained via fusion (combining lower gems into higher ones).',
    totalWk: 'Total gems per week - direct cuts plus fusions.',
    gold: 'Gold spent per week to sustain this farming rate.',
    avgScore: 'Average score of the gems this pipeline produces at this baseline.',
    totalScore: 'Combined score across all 24 grid slots once filled.',
    cpGain: 'Combat-power % gain from completing this pipeline.',
  };
</script>

<div class="panel cutplan-panel">
  <div class="title section-title">
    Cutting Plan: What to Farm Next
    <button
      class="help-toggle"
      aria-label="How to read this table"
      aria-pressed={showHelp}
      onclick={() => (showHelp = !showHelp)}
    >
      <span class="q-circle">?</span> Glossary
    </button>
    <BuildViewSwitch />
    <button
      class="fold-button"
      aria-label={appConfig.current.uiConfig.showCuttingPlan
        ? 'Collapse section'
        : 'Expand section'}
      onclick={() => toggleUI('showCuttingPlan')}
    >
      {appConfig.current.uiConfig.showCuttingPlan ? '▼' : '▲'}
    </button>
  </div>

  {#if appConfig.current.uiConfig.showCuttingPlan}
    {#if showHelp}
      <div class="cutplan-help">
        <div class="ch-title">How to read this table</div>
        <div class="ch-grid">
          <div class="ch-col">
            <section>
              <h4>Baseline</h4>
              <p>
                The score of your weakest equipped astrogem - a new gem must beat it to be an
                upgrade (the same scoring the Gem Triage uses).
              </p>
              <p>
                <strong>Willpower</strong> = (4 - level) × 2.4 · <strong>Chaos Points</strong> =
                (level - 4) × 5.14 · <strong>Options</strong> = level × coefficient.
              </p>
              <p>
                DPS coefficients: <strong>Boss Dmg</strong> ×2.55 · <strong>Add. Dmg</strong> ×1.85
                ·
                <strong>Atk</strong> ×1.
              </p>
              <p>
                Support coefficients: <strong>Ally Atk Enh</strong> ×1.95 · <strong>Brand</strong>
                ×1.36 · <strong>Ally Dmg Enh</strong> ×0.76.
              </p>
            </section>
            <section>
              <h4>Archetype cards</h4>
              <p>
                Each card is a gem type - Uncommon / Rare / Epic at willpower 8 / 9 / 10. The header
                shows its expected gold value (EV). The four rows are the cut outcomes:
              </p>
              <ul>
                <li><strong>2D</strong> - two damage stats</li>
                <li><strong>Op</strong> - best single damage stat</li>
                <li><strong>Sub</strong> - weaker single damage stat</li>
                <li><strong>No</strong> - no damage stat</li>
              </ul>
              <p>Each row's % is the chance a cut clears your baseline.</p>
            </section>
            <section>
              <h4>Actions</h4>
              <ul class="ch-actions">
                <li>
                  <span class="act" data-action="cut-reset">↻ Reset</span> worth cutting; re-roll if
                  the result lands below baseline
                </li>
                <li><span class="act" data-action="cut">Cut</span> worth cutting, don't reset</li>
                <li>
                  <span class="act" data-action="fuse">Fuse first</span> fuse lower gems before cutting
                </li>
                <li><span class="act" data-action="dont-cut">Don't cut</span> not worth cutting</li>
              </ul>
            </section>
            <section>
              <h4>How to use</h4>
              <ol>
                <li>
                  Pick your <strong>Gold / 1% damage</strong> bracket and <strong>Gold Type</strong>
                  (roster-bound or not).
                </li>
                <li>
                  Set your <strong>baseline</strong> (auto = weakest equipped, or drag the slider).
                </li>
                <li>
                  Read each row and follow its action. The pipeline stats estimate weekly output and
                  time to fill all 24 slots.
                </li>
              </ol>
            </section>
          </div>
          <div class="ch-col">
            <section>
              <h4>Pipeline stats</h4>
              <ul>
                <li><strong>Weeks to Fill</strong> - weeks to fill all 24 slots at this budget</li>
                <li><strong>Direct / wk</strong> - above-baseline gems per week from cutting</li>
                <li><strong>Fusion / wk</strong> - above-baseline gems per week from fusion</li>
                <li><strong>Total Gems / wk</strong> - direct + fusion</li>
                <li><strong>Gold / wk</strong> - gold spent per week</li>
                <li><strong>Avg Gem Score</strong> - mean score of the gems produced</li>
                <li><strong>Total Score</strong> - summed score across all 24 slots</li>
                <li><strong>CP% Gain</strong> - combat-power % gain once complete</li>
              </ul>
            </section>
            <section>
              <h4>Pre-cut Fusion</h4>
              <p>
                <strong>3 UC, same cost</strong> → 85% UC / 13.5% Rare / 1.5% Epic. 500g, 50% RB.
              </p>
              <p>
                <strong>1R + 2 UC, optimal cost</strong> → 52% UC / 44% Rare / 4% Epic. 500g, 50% RB.
              </p>
              <p>Purple "Fuse first" cells indicate when fusing beats cutting directly.</p>
            </section>
            <section>
              <h4>Post-cut Fusion (500g each)</h4>
              <p>
                <strong>A + 2L</strong> → 35L / 40R / 25A · <strong>R + 2L</strong> → 73L / 25R / 2A
                ·
                <strong>3L</strong> → 99L / 1R.
              </p>
              <p>Priority: A+2L, then R+2L, then 3L. Below-baseline outputs are recycled.</p>
            </section>
          </div>
        </div>
        <p class="ch-note">
          Week estimates assume vendor + dailies only - not events, paradise, or the F4 shop. Hover
          any pipeline stat for its definition.
        </p>
      </div>
    {/if}
    <div class="controls">
      <div class="control-group">
        <span class="cg-label">Gold / 1% damage</span>
        <select value={bracket} onchange={onBracket}>
          {#each GOLD_BRACKETS as b}
            <option value={b}>{bracketLabel(b)}</option>
          {/each}
        </select>
      </div>
      <div class="control-group">
        <span class="cg-label">Gold Type</span>
        <button class="cg-toggle" onclick={onBinding}>
          {binding === 'nrb' ? 'Non-Roster-Bound' : 'Roster-Bound'}
        </button>
      </div>
      <div class="baseline-group">
        <BaselineControl {profile} />
      </div>
    </div>

    {#if role === 'support'}
      <div class="support-note">
        Single-cut odds + sim-projected scores - relative guidance, not budget-aware. ArkGrid
        overstates support value (~2×); treat as relative.
      </div>
      {#if supportPlan.ranks.length > 0}
        {@const s = supportPlan.summary}
        <div class="gems-grid">
          {#each supportPlan.ranks as r, i}
            <div class="gem-card" data-rarity={rarityOf(r.archetype)} class:top={i === 0}>
              <div class="gem-header">
                <span class="gem-title">{archLabel(r.archetype)}</span>
                <span class="gem-ev">best {r.best}%</span>
              </div>
              <div class="gem-buckets">
                {#each BUCKETS as bkt}
                  {#if r.buckets[bkt] != null}
                    <div class="bucket-row">
                      <span class="bucket-label">{bkt}</span>
                      <span class="bucket-pct">{r.buckets[bkt]}%</span>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        </div>
        <div class="summary-grid">
          <div
            class="stat-box"
            title="Highest single-cut chance to beat your baseline, across all archetypes."
          >
            <div class="stat-label">Best Cut Chance</div>
            <div class="stat-value">{s.bestPct}%</div>
          </div>
          <div
            class="stat-box"
            title="Roughly how many cuts to land one above-baseline gem (100 / best chance)."
          >
            <div class="stat-label">Cuts / Hit</div>
            <div class="stat-value">{s.cutsPerHit ?? '-'}</div>
          </div>
          <div
            class="stat-box"
            title="Expected score of an above-baseline gem from the best target."
          >
            <div class="stat-label">Avg Gem Score</div>
            <div class="stat-value">{s.avgScore ?? '-'}</div>
          </div>
          <div
            class="stat-box"
            title="Projected full-grid astrogem score (avg gem score × 24 slots)."
          >
            <div class="stat-label">Total Score</div>
            <div class="stat-value">{s.totalScore ?? '-'}</div>
          </div>
          <div
            class="stat-box"
            title="Combat power still available from better gems, from the optimizer (max achievable − current). Run the optimizer to populate it."
          >
            <div class="stat-label">CP% Headroom</div>
            <div class="stat-value highlight">
              {cpHeadroom != null ? `+${cpHeadroom.toFixed(2)}%` : 'run optimizer'}
            </div>
          </div>
        </div>
        {#if s.bestTarget}
          <div class="support-hint">
            Best target: {archLabel(s.bestTarget.archetype)}{s.bestTarget.bucket === '2D'
              ? ' with two support lines'
              : ''} (single cut ~{s.bestPct}% to beat baseline {baseline}).
          </div>
        {/if}
      {:else}
        <div class="window-note">
          Baseline {baseline} is past where support cuts reliably beat your grid - it's already very
          strong.
        </div>
      {/if}
    {:else if dps.kind === 'ok'}
      {@const gl = goldLines(dps.row.pipeline.gold)}
      <div class="legend">
        <span class="act" data-action="cut-reset">↻ Reset</span>
        <span class="act" data-action="cut">Cut</span>
        <span class="act" data-action="fuse">Fuse first</span>
        <span class="act" data-action="dont-cut">Don't cut</span>
      </div>
      <div class="gems-grid">
        {#each ARCHETYPES as arch}
          {@const cell = dps.row.archetypes[arch]}
          <div class="gem-card" data-rarity={rarityOf(arch)}>
            <div class="gem-header">
              <span class="gem-title">{archLabel(arch)}</span>
              <span class="gem-ev">EV: {fmtGold(cell.headerEV)}</span>
            </div>
            <div class="gem-buckets">
              {#each BUCKETS as bkt}
                {@const b = cell.buckets[bkt]}
                {#if b}
                  <div class="bucket-row" data-action={b.action}>
                    <span class="bucket-label">{bkt}</span>
                    <span class="bucket-pct">{b.pct == null ? '-' : `${b.pct}%`}</span>
                    <span class="bucket-action" data-action={b.action}>{pillLabel(b.action)}</span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="summary-grid">
        <div class="stat-box" title={STAT_TIPS.weeks}>
          <div class="stat-label">Weeks to Fill</div>
          <div class="stat-value {weeksBand(parseFloat(dps.row.pipeline.weeks))}">
            {dps.row.pipeline.weeks}
          </div>
        </div>
        <div class="stat-box" title={STAT_TIPS.directWk}>
          <div class="stat-label">Direct / wk</div>
          <div class="stat-value">{dps.row.pipeline.directWk}</div>
        </div>
        <div class="stat-box" title={STAT_TIPS.fuseWk}>
          <div class="stat-label">Fusion / wk</div>
          <div class="stat-value">{dps.row.pipeline.fuseWk}</div>
        </div>
        <div class="stat-box" title={STAT_TIPS.totalWk}>
          <div class="stat-label">Total Gems / wk</div>
          <div class="stat-value">{dps.row.pipeline.totalWk}</div>
        </div>
        <div class="stat-box" title={STAT_TIPS.gold}>
          <div class="stat-label">Gold / wk</div>
          <div class="stat-value gold">
            {gl[0]}{#if gl[1]}<br /><span class="gold-total">{gl[1]}</span>{/if}
          </div>
        </div>
        <div class="stat-box" title={STAT_TIPS.avgScore}>
          <div class="stat-label">Avg Gem Score</div>
          <div class="stat-value">{dps.row.pipeline.avgScore}</div>
        </div>
        <div class="stat-box" title={STAT_TIPS.totalScore}>
          <div class="stat-label">Total Score</div>
          <div class="stat-value">{dps.row.pipeline.totalScore}</div>
        </div>
        <div class="stat-box" title={STAT_TIPS.cpGain}>
          <div class="stat-label">CP% Gain</div>
          <div class="stat-value highlight">{dps.row.pipeline.cpGain}</div>
        </div>
      </div>
    {:else if dps.kind === 'below-window'}
      <div class="window-note">
        This gold budget is overkill for baseline {baseline} - pick a cheaper bracket (this bracket starts
        at baseline {dps.minBaseline}).
      </div>
    {:else if dps.kind === 'above-window'}
      <div class="window-note">
        Baseline {baseline} is past the efficient ceiling for this budget (this bracket tops out at baseline
        {dps.maxBaseline}). Your grid is already very strong, or pick a richer bracket.
      </div>
    {:else}
      <div class="window-note">No data for this bracket.</div>
    {/if}
  {/if}
</div>

<style>
  .cutplan-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  /* "? Glossary" pill next to the fold marker (gold theme). */
  .help-toggle {
    width: auto;
    min-width: 0;
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
  .q-circle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    font-size: 0.7rem;
    line-height: 1;
  }
  .fold-button {
    margin-left: 0;
  }
  .cutplan-help {
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
  .ch-title {
    font-weight: 700;
    font-size: 1.1rem;
    color: #b8860b;
  }
  :global(.dark-mode) .ch-title {
    color: #f0c040;
  }
  /* Gold key-terms make the body scannable instead of a wall of white text. */
  .ch-grid strong {
    color: #b8860b;
  }
  :global(.dark-mode) .ch-grid strong {
    color: #f0c040;
  }
  .ch-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2rem;
    align-items: start;
  }
  .ch-col {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .ch-grid h4 {
    margin: 0 0 0.4rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid rgba(184, 134, 11, 0.3);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #b8860b;
  }
  :global(.dark-mode) .ch-grid h4 {
    color: #f0c040;
    border-bottom-color: rgba(240, 192, 64, 0.25);
  }
  .ch-grid p,
  .ch-grid ul,
  .ch-grid ol {
    margin: 0 0 0.4rem;
  }
  .ch-grid ul,
  .ch-grid ol {
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .ch-actions {
    list-style: none;
    padding-left: 0;
  }
  .ch-actions .act {
    margin-right: 0.35rem;
  }
  .ch-note {
    opacity: 0.75;
    font-style: italic;
    margin: 0;
  }
  @media (max-width: 700px) {
    .ch-grid {
      grid-template-columns: 1fr;
    }
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem 2rem;
    align-items: flex-end;
  }
  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .cg-label {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
    color: #b8860b; /* gold accent (readable in light mode) */
  }
  :global(.dark-mode) .cg-label {
    color: #f0c040; /* brighter gold in dark mode */
  }
  .control-group select,
  .cg-toggle {
    width: auto;
    min-width: 12rem;
    padding: 0.6rem 0.85rem;
    border-radius: 0.5rem;
    font-size: 0.95rem;
    color: #b8860b;
    border: 1px solid rgba(184, 134, 11, 0.55);
    background: rgba(184, 134, 11, 0.1);
  }
  .control-group select:hover,
  .cg-toggle:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  .cg-toggle {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  :global(.dark-mode) .control-group select,
  :global(.dark-mode) .cg-toggle {
    color: #f0c040;
    border-color: rgba(240, 192, 64, 0.55);
    background: rgba(240, 192, 64, 0.12);
  }
  :global(.dark-mode) .control-group select:hover,
  :global(.dark-mode) .cg-toggle:hover {
    background: rgba(240, 192, 64, 0.2);
  }
  .baseline-group {
    flex: 1 1 100%;
  }

  /* Legend */
  .legend {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    flex-wrap: wrap;
    font-size: 0.78rem;
  }
  .act {
    padding: 0.05rem 0.4rem;
    border-radius: 0.3rem;
    color: #fff;
  }
  .act[data-action='cut-reset'] {
    background: #2e7d32;
  }
  .act[data-action='cut'] {
    background: #b8860b;
  }
  .act[data-action='fuse'] {
    background: #6a3fa0;
  }
  .act[data-action='dont-cut'] {
    background: #8a3a3a;
  }

  /* Archetype cards */
  .gems-grid {
    display: grid;
    /* Three columns → Uncommon / Rare / Epic each fill their own row (archetypes are in that order). */
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
  }
  @media (max-width: 640px) {
    .gems-grid {
      grid-template-columns: 1fr;
    }
  }
  .gem-card {
    background: var(--card-inner);
    border: 1px solid var(--border);
    border-top: 3px solid var(--border);
    border-radius: 0.6rem;
    overflow: hidden;
  }
  .gem-card[data-rarity='uncommon'] {
    border-top-color: #4ade80;
  }
  .gem-card[data-rarity='rare'] {
    border-top-color: #60a5fa;
  }
  .gem-card[data-rarity='epic'] {
    border-top-color: #c084fc;
  }
  .gem-card.top {
    box-shadow: 0 0 0 1px #4ade80;
  }
  .gem-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .gem-title {
    font-weight: 700;
  }
  .gem-ev {
    font-size: 0.8rem;
    opacity: 0.85;
  }
  .gem-buckets {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.6rem 0.75rem;
  }
  .bucket-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.3rem;
    border-left: 3px solid var(--border);
    background: var(--card);
    font-size: 0.85rem;
  }
  .bucket-row[data-action='cut-reset'] {
    border-left-color: #2e7d32;
    background: rgba(46, 125, 50, 0.14);
  }
  .bucket-row[data-action='cut'] {
    border-left-color: #b8860b;
    background: rgba(184, 134, 11, 0.14);
  }
  .bucket-row[data-action='fuse'] {
    border-left-color: #6a3fa0;
    background: rgba(106, 63, 160, 0.14);
  }
  .bucket-row[data-action='dont-cut'] {
    border-left-color: #8a3a3a;
    background: rgba(138, 58, 58, 0.14);
    opacity: 0.7;
  }
  .bucket-label {
    font-weight: 700;
    width: 2.2rem;
  }
  .bucket-pct {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  /* Action shown as a compact pill, right-aligned at the end of the row. */
  .bucket-action {
    padding: 0.05rem 0.45rem;
    border-radius: 0.3rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
  }
  .bucket-action[data-action='cut-reset'] {
    background: #2e7d32;
  }
  .bucket-action[data-action='cut'] {
    background: #b8860b;
  }
  .bucket-action[data-action='fuse'] {
    background: #6a3fa0;
  }
  .bucket-action[data-action='dont-cut'] {
    background: #8a3a3a;
  }

  /* Pipeline summary tiles */
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }
  .stat-box {
    background: var(--card-inner);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.6rem 0.5rem;
    text-align: center;
  }
  .stat-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    opacity: 0.75;
    margin-bottom: 0.3rem;
  }
  .stat-value {
    font-size: 1.3rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stat-value.gold {
    font-size: 1rem;
    line-height: 1.25;
  }
  .gold-total {
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .stat-value.highlight {
    color: #1565c0;
  }
  .stat-value.fast {
    color: #2e7d32;
  }
  .stat-value.med {
    color: #b8860b;
  }
  .stat-value.slow {
    color: #c62828;
  }

  /* Notes / support */
  .window-note {
    opacity: 0.85;
    padding: 0.75rem 0;
  }
  .support-note {
    font-size: 0.82rem;
    font-style: italic;
    opacity: 0.85;
  }
  .support-hint {
    font-size: 0.9rem;
  }
</style>
