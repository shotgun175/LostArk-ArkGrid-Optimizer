<script lang="ts">
  import { type ArkGridGemOptionName, ArkGridGemOptionTypes } from '../../lib/models/arkGridGems';
  import {
    D_ORDER,
    D_WILLPOWER,
    DPS_EFFECT_D,
    SUPPORT_EFFECT_D,
    SUPPORT_ORDER_D,
    SUPPORT_VALUE_ORDER_D,
    SUPPORT_WILLPOWER_FACTOR,
    sPlusCut,
  } from '../../lib/scoring/gemScore';

  type Row = { label: string; value: string };

  const optLabel = (name: ArkGridGemOptionName) => ArkGridGemOptionTypes[name].name.en_us;

  // Only the options each role actually scores (coefficient > 0), strongest first. Values are
  // per-level % damage (D = 100·ln(multiplier)), so they are shown to 4 decimals.
  const activeCoeffs = (coeff: Record<ArkGridGemOptionName, number>): Row[] =>
    (Object.entries(coeff) as [ArkGridGemOptionName, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, v]) => ({ label: optLabel(name), value: v.toFixed(4) }));

  // All values are imported live from the modules below, so this panel can't drift from the solver.
  // Scoring is real % damage in log space (D = 100·ln(multiplier)).
  const scoring: Row[] = [
    { label: 'Willpower per cost-level (4 − req) ×', value: D_WILLPOWER.toFixed(4) },
    { label: 'Order per point ×', value: D_ORDER.toFixed(4) },
    { label: 'Support order per point ×', value: SUPPORT_ORDER_D.toFixed(4) },
    { label: 'Support order per point (grading value, fitted) ×', value: SUPPORT_VALUE_ORDER_D.toFixed(4) },
    { label: 'Support willpower factor', value: SUPPORT_WILLPOWER_FACTOR.toFixed(3) },
    // Grading: the S+ cut is derived from the model (the axis's perfect 8-cost grade), so a refit
    // of the willpower credit or the support coefficients moves it here automatically.
    { label: 'Grade S+ cut, DPS (perfect 8-cost)', value: sPlusCut('dps').toFixed(1) },
    { label: 'Grade S+ cut, Support (perfect 8-cost)', value: sPlusCut('support').toFixed(1) },
  ];
  const dpsCoeffs = activeCoeffs(DPS_EFFECT_D);
  const supportCoeffs = activeCoeffs(SUPPORT_EFFECT_D);
</script>

<details class="assumptions">
  <summary>Assumptions / Tuning</summary>
  <p class="note">
    The constants the Gem Triage, Cutting Plan, and their internal solver are built on, shown
    read-only. To change behavior, edit them in source and rebuild.
  </p>

  <div class="group">
    <h4>Gem scoring <span class="src">src/lib/scoring/gemScore.ts</span></h4>
    <dl>
      {#each scoring as r}
        <div class="kv"><dt>{r.label}</dt>
          <dd class="mono">{r.value}</dd>
        </div>
      {/each}
    </dl>
    <div class="cols">
      <div>
        <span class="sub">DPS option coefficients</span>
        <dl>
          {#each dpsCoeffs as r}
            <div class="kv"><dt>{r.label}</dt>
              <dd class="mono">{r.value}</dd>
            </div>
          {/each}
        </dl>
      </div>
      <div>
        <span class="sub">Support option coefficients</span>
        <dl>
          {#each supportCoeffs as r}
            <div class="kv"><dt>{r.label}</dt>
              <dd class="mono">{r.value}</dd>
            </div>
          {/each}
        </dl>
      </div>
    </div>
  </div>

  <div class="group">
    <h4>Cutting Plan <span class="src">src/lib/cutplan/pipeline.json</span></h4>
    <p class="note">
      Cut / reset / fuse values come from an exact Bellman-DP pipeline built on shizukaziye's model
      (real % damage), interpolated at your baseline. See the Cutting Plan glossary for the verdict
      bands.
    </p>
  </div>
</details>

<style>
  .assumptions {
    max-width: 48rem;
    margin: 0 auto 1.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card);
    color: var(--text);
    padding: 0 1rem;
    font-size: 0.85rem;
    text-align: left;
  }
  summary {
    cursor: pointer;
    padding: 0.75rem 0;
    font-weight: 600;
  }
  .note {
    margin: 0 0 0.75rem;
    opacity: 0.75;
    font-size: 0.8rem;
  }
  .group {
    padding: 0.5rem 0 0.75rem;
    border-top: 1px solid var(--border);
  }
  .group h4 {
    margin: 0 0 0.35rem;
    font-size: 0.85rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
  }
  .src {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    opacity: 0.6;
    font-weight: 400;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.25rem 1.5rem;
    margin-top: 0.5rem;
  }
  .sub {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    opacity: 0.7;
  }
  dl {
    margin: 0.25rem 0 0;
  }
  .kv {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.15rem 0;
    border-bottom: 1px dashed var(--border);
  }
  .kv dt {
    opacity: 0.85;
  }
  .kv dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
