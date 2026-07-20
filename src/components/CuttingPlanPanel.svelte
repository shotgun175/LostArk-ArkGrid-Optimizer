<script lang="ts">
  import {
    actionLabel,
    bracketLabel,
    cellBreakdown,
    effectPair,
    getCutCell,
    getEconomy,
    getFusion,
    headerCut,
    isBlockFuse,
    pipelineBaselineForGrade,
    unopenedFusion,
    weeksBand,
  } from '../lib/cutplan/cutPlan';
  import {
    type BindingMode,
    type BucketKey,
    COSTS,
    type CutAxis,
    GOLD_BRACKETS,
    GOLD_PER_DAMAGE,
    type GoldBracket,
    type PipelineData,
    RARITIES,
    RARITY_LABEL,
    type Rarity,
  } from '../lib/cutplan/types';
  import type { ArkGridGem } from '../lib/models/arkGridGems';
  import { type GemRole } from '../lib/scoring/gemScore';
  import { autoBaselineFromLoadout, effectiveBaseline } from '../lib/scoring/triage';
  import { sectionUI, toggleSection } from '../lib/state/appConfig.state.svelte';
  import {
    type CharacterProfile,
    activeBuildState,
    updateBindingMode,
    updateGoldPer1Pct,
  } from '../lib/state/profile.state.svelte';
  import BaselineControl from './BaselineControl.svelte';
  import BuildViewSwitch from './BuildViewSwitch.svelte';
  import CutplanBreakdown from './CutplanBreakdown.svelte';
  import Popover from './Popover.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  let data = $state<PipelineData | null>(null);
  let loadFailed = $state(false);
  let dataRequested = false;

  // The ~1.3MB cutting-plan dataset is split into its own chunk, so it never bloats the initial
  // bundle. It loads lazily via the $effect below when the Cutting Plan section is open — but that
  // section defaults to expanded (and isn't persisted), so in practice every visitor fetches it
  // shortly after load, not only those who use it. Gating the import on real intent (e.g. the panel
  // scrolling into view) would be needed to actually skip it for visitors who never open it.
  async function loadPipeline() {
    if (dataRequested) return;
    dataRequested = true;
    loadFailed = false;
    try {
      const m = await import('../lib/cutplan/pipeline.json');
      data = m.default as unknown as PipelineData;
    } catch (e) {
      // Realistically this 404s after a redeploy (the content-hashed chunk is gone for tabs opened
      // before the deploy) or on a transient network drop. Without this the rejection is swallowed,
      // the panel shows its empty state forever, and dataRequested blocks any retry until a reload.
      console.error('[cutplan] failed to load pipeline.json', e);
      dataRequested = false; // allow a retry
      loadFailed = true;
    }
  }
  $effect(() => {
    if (sectionUI.showCuttingPlan) void loadPipeline();
  });

  let showHelp = $state(false);

  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);
  let axis: CutAxis = $derived(role);
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let auto = $derived(autoBaselineFromLoadout(equipped, role));
  // Baseline is a GRADE tier (the same value the Gem Triage uses). The DP data is keyed by the % damage
  // each grade anchor was baked at, so convert grade -> baked % (exact key lookup) before reading cells.
  let baseline = $derived(effectiveBaseline(auto, build.baselineOverride));
  // Baselines are per-axis: DPS and support cells are baked at different % scales, so read the
  // axis-matching anchor array (using the shared DPS array for support clamps every cell to 0).
  let baselinePct = $derived(data ? pipelineBaselineForGrade(baseline, data.meta.baselines[axis]) : 0);
  let bracket: GoldBracket = $derived(profile.goldPer1Pct ?? '2_5M');
  let goldPerDamage = $derived(GOLD_PER_DAMAGE[bracket]);
  let binding: BindingMode = $derived(profile.bindingMode ?? 'nrb');

  // Fuse-first (purple) values, computed once per axis/gpd/baseline; only the NRB view fuses
  // (roster-bound gems are always free to cut).
  let fuseFirst = $derived(
    data && binding === 'nrb' ? unopenedFusion(data, axis, goldPerDamage, baselinePct) : null
  );

  // The whole-economy weekly model + fusion/fodder values (both NRB by nature, income/fusion are not
  // roster-bound), read at the current axis / gpd / baseline.
  let economy = $derived(data ? getEconomy(data, axis, goldPerDamage, baselinePct) : null);
  let fusion = $derived(data ? getFusion(data, axis, goldPerDamage, baselinePct) : null);

  // CP% headroom = how much CP the active build can still gain (from the solve's scoreSet).
  let scoreSet = $derived(build.solveInfo.after?.scoreSet);
  let cpHeadroom = $derived(scoreSet ? scoreSet.bestScore - scoreSet.score : null);

  function onBracket(e: Event) {
    updateGoldPer1Pct((e.target as HTMLSelectElement).value as GoldBracket);
  }
  function onBinding() {
    updateBindingMode(binding === 'nrb' ? 'rb' : 'nrb');
  }

  function keepCutplanInView(node: HTMLElement) {
    let timer: ReturnType<typeof setTimeout>;
    const onChange = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.build-view-switch, .baseline-group')) return;
      clearTimeout(timer);
      timer = setTimeout(() => node.scrollIntoView({ block: 'start' }), 150);
    };
    node.addEventListener('click', onChange);
    node.addEventListener('input', onChange);
    return {
      destroy() {
        node.removeEventListener('click', onChange);
        node.removeEventListener('input', onChange);
        clearTimeout(timer);
      },
    };
  }

  const ARCHES: { rarity: Rarity; cost: number; label: string }[] = [];
  for (const rarity of RARITIES)
    for (const cost of COSTS) ARCHES.push({ rarity, cost, label: `${RARITY_LABEL[rarity]} (${cost})` });

  const fmtGold = (g: number | null | undefined) =>
    g == null ? '-' : Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(Math.round(g));
  const pctOf = (n: number) => `${Math.round(n * 100)}%`;
  const statWord = $derived(role === 'support' ? 'support' : 'damage');
  const bucketLabelOf = (bkt: BucketKey) => {
    const lbl = data?.meta.bucketLabels[bkt] ?? bkt;
    return role === 'support' && lbl === '2D' ? '2S' : lbl;
  };
  // Per-bucket hover tooltip: the effect pair + expected % damage + fodder tier split.
  const cellTitle = (cost: number, bkt: BucketKey, cell: ReturnType<typeof getCutCell>) => {
    if (!data || !cell) return '';
    const fodder =
      binding === 'nrb'
        ? ` · fodder L/R/A ${pctOf(cell.fLeg)}/${pctOf(cell.fRelic)}/${pctOf(cell.fAnc)}`
        : '';
    return `${effectPair(data.meta, axis, cost, bkt)} · avg ${cell.expScore.toFixed(2)}% dmg${fodder}`;
  };
</script>

<div class="panel cutplan-panel" use:keepCutplanInView>
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
      aria-label={sectionUI.showCuttingPlan ? 'Collapse section' : 'Expand section'}
      onclick={() => toggleSection('showCuttingPlan')}
    >
      {sectionUI.showCuttingPlan ? '▼' : '▲'}
    </button>
  </div>

  {#if sectionUI.showCuttingPlan}
    {#if data}
      {#if showHelp}
        <div class="cutplan-help">
          <div class="ch-title">How to read this table</div>
          <div class="ch-grid">
            <div class="ch-col">
              <section>
                <h4>Baseline (tier)</h4>
                <p>
                  The letter tier you're targeting — one rank above your stronger 3rd-lowest equipped
                  astrogem (the same baseline the Gem Triage uses). A fresh cut must reach this tier to
                  be an upgrade; step it with the slider to plan more or less aggressively.
                </p>
              </section>
              <section>
                <h4>Archetype cards</h4>
                <p>
                  Each card is a gem rarity (Uncommon / Rare / Epic) at a base cost (8 / 9 / 10). The
                  four rows are the effect-pair buckets, the gem's archetype:
                </p>
                <ul>
                  <li><strong>{role === 'support' ? '2S' : '2D'}</strong>: both effects are {statWord}</li>
                  <li><strong>Op</strong>: the better single {statWord} effect</li>
                  <li><strong>Sub</strong>: the weaker single {statWord} effect</li>
                  <li><strong>No</strong>: no {statWord} effect (worthless)</li>
                </ul>
                <p>
                  Each row shows the <strong>cut value</strong> (expected gold from optimally cutting
                  a fresh gem of that archetype) and <strong>P(above)</strong>, the chance the cut
                  clears your baseline.
                </p>
              </section>
              <section>
                <h4>Actions</h4>
                <ul class="ch-actions">
                  <li>
                    <span class="act" data-action="cut-reset">↻ Reset</span> high value (≥ 20k), reset
                    if it lands below baseline
                  </li>
                  <li><span class="act" data-action="cut">Cut</span> worth cutting, don't reset</li>
                  <li>
                    <span class="act" data-action="dont-cut">Don't cut</span> not worth cutting at this
                    baseline
                  </li>
                  <li>
                    <span class="act" data-action="fuse">⚜ Fuse first</span> 3-into-1 rarity-upgrade
                    fusion beats opening these gems individually
                  </li>
                </ul>
              </section>
            </div>
            <div class="ch-col">
              <section>
                <h4>Weekly economy (non-roster-bound)</h4>
                <p>
                  A whole-account model of one week at this budget: daily gem income plus any gem
                  boxes worth buying, cut with the plan above, below-baseline gems reset (≥ 20k) or
                  recycled through fusion.
                </p>
                <ul>
                  <li><strong>Keepers / week</strong>: above-baseline gems produced (direct cuts + fusion chain)</li>
                  <li><strong>Weeks</strong>: to fill all 24 slots at this rate</li>
                  <li><strong>Gold spent / week</strong>: boxes + cutting + 20k resets + fusion fees (and the total to finish)</li>
                  <li><strong>Combat power</strong>: the % a full run adds to the loadout</li>
                </ul>
              </section>
              <section>
                <h4>Fusion / fodder</h4>
                <p>
                  A cut that ends <em>below</em> baseline is fodder, recycled 3-into-1. The table
                  shows, per fodder tier, its <strong>value as fusion material</strong> and the
                  <strong>expected value of the fused output</strong> (cost-weighted, at your budget).
                  Mixes: <strong>3L</strong> → 99L/1R, <strong>R+2L</strong> → 73L/25R/2A,
                  <strong>A+2L</strong> → 35L/40R/25A (500g each).
                </p>
              </section>
              <section>
                <h4>How to use</h4>
                <ol>
                  <li>Pick your <strong>Gold / 1% damage</strong> bracket and <strong>Gold Type</strong>.</li>
                  <li>Set your <strong>baseline tier</strong> (auto = one rank above your 3rd-lowest equipped gem, or pick a tier).</li>
                  <li>Read each bucket and follow its action.</li>
                </ol>
              </section>
            </div>
          </div>
          <p class="ch-note">
            Values are shizukaziye's exact Bellman-DP pipeline (real % damage), interpolated at your
            baseline.
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

      <div class="legend">
        <span class="act" data-action="cut-reset">↻ Reset</span>
        <span class="act" data-action="cut">Cut</span>
        <span class="act" data-action="dont-cut">Don't cut</span>
        <span class="act" data-action="fuse">⚜ Fuse first</span>
      </div>

      <div class="gems-grid">
        {#each ARCHES as arch}
          {@const best = headerCut(data, axis, arch.rarity, arch.cost, binding, goldPerDamage, baselinePct)}
          {@const bd = cellBreakdown(data, axis, arch.rarity, arch.cost, binding, goldPerDamage, baselinePct)}
          {@const blockFuse = isBlockFuse(data, axis, arch.rarity, arch.cost, binding, goldPerDamage, baselinePct, fuseFirst)}
          <div class="gem-card" data-rarity={arch.rarity}>
            {#if bd}
              <Popover label={`${arch.label} breakdown`}>
                {#snippet trigger()}
                  <div class="gem-header gem-header-trigger">
                    <span class="gem-title">{arch.label} <span class="gem-info" aria-hidden="true">i</span></span>
                    <span class="gem-ev">Best: {fmtGold(best)}</span>
                  </div>
                {/snippet}
                {#snippet content()}
                  <CutplanBreakdown breakdown={bd} rarity={arch.rarity} cost={arch.cost} {binding} />
                {/snippet}
              </Popover>
            {:else}
              <div class="gem-header">
                <span class="gem-title">{arch.label}</span>
                <span class="gem-ev">Best: {fmtGold(best)}</span>
              </div>
            {/if}
            <div class="gem-buckets">
              {#each data.meta.buckets as bkt}
                {@const cell = getCutCell(data, axis, arch.rarity, arch.cost, bkt, binding, goldPerDamage, baselinePct, blockFuse)}
                {#if cell}
                  <div class="bucket-row" data-action={cell.action} title={cellTitle(arch.cost, bkt, cell)}>
                    <span class="bucket-label">{bucketLabelOf(bkt)}</span>
                    <span class="bucket-cut" data-verdict={cell.verdict}>{fmtGold(cell.cut)}</span>
                    <span class="bucket-pct">{pctOf(cell.pAbove)}</span>
                    <span class="bucket-action" data-action={cell.action}>
                      {cell.action === 'cut-reset'
                        ? '↻ Reset'
                        : cell.action === 'fuse'
                          ? '⚜ Fuse first'
                          : actionLabel(cell.action)}
                    </span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>

      {#if economy}
        <div class="econ">
          <div class="econ-title">Weekly economy at this budget (non-roster-bound)</div>
          <div class="econ-grid">
            <div class="econ-cell">
              <span class="ec-val">≈ {economy.totalPerWk.toFixed(1)}<span class="ec-unit">/wk</span></span>
              <span class="ec-lab">Keepers / week ({economy.directPerWk.toFixed(1)} cut + {economy.fusePerWk.toFixed(1)} fused)</span>
            </div>
            <div class="econ-cell">
              <span class="ec-val {economy.weeks == null ? 'slow' : weeksBand(economy.weeks)}"
                >{economy.weeks == null ? '∞' : economy.weeks.toFixed(1)}<span class="ec-unit"> wks</span></span
              >
              <span class="ec-lab">To fill 24 slots</span>
            </div>
            <div class="econ-cell">
              <span class="ec-val">{fmtGold(economy.goldPerWk)}<span class="ec-unit"> g/wk</span></span>
              <span class="ec-lab">Gold spent / week{economy.goldTotal != null ? ` · ${fmtGold(economy.goldTotal)} total` : ''}</span>
            </div>
            <div class="econ-cell">
              <span class="ec-val">+{(economy.cpPct * 100).toFixed(1)}%</span>
              <span class="ec-lab">Combat power from a full run</span>
            </div>
          </div>
          <div class="econ-boxes">
            Buy this week:
            {#if economy.buyVendor || economy.buyMat || economy.buyEpic}
              {[
                economy.buyVendor ? '10x vendor' : '',
                economy.buyMat ? '20x mat' : '',
                economy.buyEpic ? '1x epic' : '',
              ]
                .filter(Boolean)
                .join(' · ')} gem boxes
            {:else}
              no boxes worth it at this baseline
            {/if}
          </div>
        </div>
      {/if}

      {#if fusion}
        <div class="fusion">
          <div class="fusion-title">Fusion / fodder value (per gem, cost-weighted)</div>
          <table class="fusion-table">
            <thead>
              <tr><th></th><th>Legendary</th><th>Relic</th><th>Ancient</th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="fl">Fodder value</td>
                <td>{fmtGold(fusion.fodder.leg)}</td>
                <td>{fmtGold(fusion.fodder.relic)}</td>
                <td>{fmtGold(fusion.fodder.anc)}</td>
              </tr>
              <tr>
                <td class="fl">Fused-output EV</td>
                <td>{fmtGold(fusion.tierEV.leg)}</td>
                <td>{fmtGold(fusion.tierEV.relic)}</td>
                <td>{fmtGold(fusion.tierEV.anc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      {/if}

      <div class="cp-callout" title="Combat power still available from better gems (best possible minus current).">
        CP% headroom:
        <strong>{cpHeadroom != null ? `+${cpHeadroom.toFixed(2)}%` : 'refresh Gem Triage first'}</strong>
      </div>
    {:else if loadFailed}
      <div class="cutplan-loading">
        Couldn't load the cutting-plan data.
        <button class="cutplan-retry" onclick={() => void loadPipeline()}>Retry</button>
      </div>
    {:else}
      <div class="cutplan-loading">Loading cutting plan…</div>
    {/if}
  {/if}
</div>

<style>
  .cutplan-loading {
    padding: 1rem;
    opacity: 0.7;
  }
  .cutplan-retry {
    width: auto;
    min-width: 0;
    margin-left: 0.5rem;
    padding: 0.25rem 0.75rem;
    border-radius: 0.4rem;
    font-weight: 600;
    color: #b8860b;
    border: 1px solid rgba(184, 134, 11, 0.55);
    background: rgba(184, 134, 11, 0.1);
  }
  .cutplan-retry:hover {
    background: rgba(184, 134, 11, 0.18);
  }
  :global(.dark-mode) .cutplan-retry {
    color: #f0c040;
    border-color: rgba(240, 192, 64, 0.55);
    background: rgba(240, 192, 64, 0.12);
  }
  .cutplan-panel {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .help-toggle {
    width: auto;
    min-width: 0;
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
    flex-shrink: 0;
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
    color: #b8860b;
  }
  :global(.dark-mode) .cg-label {
    color: #f0c040;
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
  .act[data-action='dont-cut'] {
    background: #8a3a3a;
  }
  .act[data-action='fuse'] {
    background: #7e5cc0;
  }

  .gems-grid {
    display: grid;
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
  .gem-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .gem-header-trigger {
    cursor: pointer;
  }
  .gem-header-trigger:hover .gem-info {
    opacity: 1;
  }
  /* Circled "i" in the panel's gold accent, mirroring the Glossary button's .q-circle so the
     affordance reads as info. CSS-drawn so it never depends on a font's ⓘ character. */
  .gem-info {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.95rem;
    height: 0.95rem;
    border: 1px solid currentColor;
    border-radius: 50%;
    font-size: 0.62rem;
    font-style: normal;
    font-weight: 700;
    line-height: 1;
    color: #b8860b;
    opacity: 0.75;
    vertical-align: text-bottom;
    margin-left: 0.25rem;
  }
  :global(.dark-mode) .gem-info {
    color: #f0c040;
  }
  .gem-title {
    font-weight: 700;
  }
  .gem-ev {
    font-size: 0.8rem;
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
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
  .bucket-row[data-action='dont-cut'] {
    border-left-color: #8a3a3a;
    background: rgba(138, 58, 58, 0.14);
    opacity: 0.7;
  }
  .bucket-row[data-action='fuse'] {
    border-left-color: #7e5cc0;
    background: rgba(126, 92, 192, 0.14);
  }
  .bucket-label {
    font-weight: 700;
    width: 2.2rem;
  }
  /* Cut value, tinted by his verdict band (green / yellow ramp / red). */
  .bucket-cut {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    min-width: 3rem;
    text-align: right;
  }
  .bucket-cut[data-verdict='green'] {
    color: #2e7d32;
  }
  .bucket-cut[data-verdict='yellow-hi'] {
    color: #b8860b;
  }
  .bucket-cut[data-verdict='yellow-mid'],
  .bucket-cut[data-verdict='yellow-lo'] {
    color: #a07d18;
    opacity: 0.92;
  }
  .bucket-cut[data-verdict='yellow-dim'] {
    color: #8a7320;
    opacity: 0.8;
  }
  .bucket-cut[data-verdict='red'] {
    color: #8a3a3a;
  }
  .bucket-cut[data-verdict='purple'] {
    color: #6d4bbf;
  }
  :global(.dark-mode) .bucket-cut[data-verdict='green'] {
    color: #4ade80;
  }
  :global(.dark-mode) .bucket-cut[data-verdict='yellow-hi'] {
    color: #f0c040;
  }
  :global(.dark-mode) .bucket-cut[data-verdict='red'] {
    color: #ef8a8a;
  }
  :global(.dark-mode) .bucket-cut[data-verdict='purple'] {
    color: #b79ce6;
  }
  .bucket-pct {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
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
  .bucket-action[data-action='dont-cut'] {
    background: #8a3a3a;
  }
  .bucket-action[data-action='fuse'] {
    background: #7e5cc0;
  }
  /* Whole-economy weekly summary (replaces the legacy per-card throughput row). */
  .econ {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: var(--card);
  }
  .econ-title {
    font-weight: 700;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
  }
  .econ-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.6rem;
  }
  @media (max-width: 560px) {
    .econ-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .econ-cell {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .ec-val {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .ec-val.fast {
    color: #2e7d32;
  }
  .ec-val.med {
    color: #b8860b;
  }
  .ec-val.slow {
    color: #8a3a3a;
  }
  :global(.dark-mode) .ec-val.fast {
    color: #4ade80;
  }
  :global(.dark-mode) .ec-val.med {
    color: #f0c040;
  }
  :global(.dark-mode) .ec-val.slow {
    color: #ef8a8a;
  }
  .ec-unit {
    font-size: 0.8rem;
    font-weight: 600;
    opacity: 0.7;
  }
  .ec-lab {
    font-size: 0.72rem;
    opacity: 0.8;
  }
  .econ-boxes {
    margin-top: 0.6rem;
    font-size: 0.78rem;
    opacity: 0.9;
  }
  .fusion {
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: var(--card);
  }
  .fusion-title {
    font-weight: 700;
    font-size: 0.85rem;
    margin-bottom: 0.4rem;
  }
  .fusion-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
    font-variant-numeric: tabular-nums;
  }
  .fusion-table th,
  .fusion-table td {
    text-align: right;
    padding: 0.25rem 0.5rem;
  }
  .fusion-table th:first-child,
  .fusion-table td.fl {
    text-align: left;
    opacity: 0.85;
  }
  .cp-callout {
    align-self: flex-start;
    font-size: 0.9rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
    width: 100%;
  }
  .cp-callout strong {
    color: #b8860b;
  }
  :global(.dark-mode) .cp-callout strong {
    color: #f0c040;
  }
</style>
