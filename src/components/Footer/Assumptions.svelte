<script lang="ts">
  import { CUT_COST, RESET_COST, SCORE_PER_DMG_PCT, SUPPORT_VALUE_RATE } from '../../lib/cutplan/cutPlan';
  import { type ArkGridGemOptionName, ArkGridGemOptionTypes } from '../../lib/models/arkGridGems';
  import { DPS_NODE_COEFF, POINT_STEP, SUPPORT_NODE_COEFF, WILLPOWER_STEP } from '../../lib/scoring/gemScore';

  type Row = { label: string; value: string };

  const optLabel = (name: ArkGridGemOptionName) => ArkGridGemOptionTypes[name].name.en_us;

  // Only the options each role actually scores (coefficient > 0), strongest first.
  const activeCoeffs = (coeff: Record<ArkGridGemOptionName, number>): Row[] =>
    (Object.entries(coeff) as [ArkGridGemOptionName, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, v]) => ({ label: optLabel(name), value: v.toFixed(2) }));

  // All values are imported live from the modules below, so this panel can't drift from the solver.
  const scoring: Row[] = [
    { label: 'Willpower step — (4 − req) ×', value: WILLPOWER_STEP.toFixed(2) },
    { label: 'Point step — (point − 4) ×', value: POINT_STEP.toFixed(2) },
  ];
  const dpsCoeffs = activeCoeffs(DPS_NODE_COEFF);
  const supportCoeffs = activeCoeffs(SUPPORT_NODE_COEFF);
  const cutplan: Row[] = [
    { label: 'Score per 1% damage', value: String(SCORE_PER_DMG_PCT) },
    { label: 'Cut cost (gold)', value: CUT_COST.toLocaleString() },
    { label: 'Reset threshold (gold)', value: RESET_COST.toLocaleString() },
    { label: 'Support value rate', value: SUPPORT_VALUE_RATE.toFixed(2) },
  ];
</script>

<details class="assumptions">
  <summary>Assumptions / Tuning</summary>
  <p class="note">
    The constants the optimizer and Cutting Plan are built on, shown read-only. To change behavior,
    edit them in source and rebuild.
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
    <h4>Cutting Plan <span class="src">src/lib/cutplan/cutPlan.ts</span></h4>
    <dl>
      {#each cutplan as r}
        <div class="kv"><dt>{r.label}</dt>
          <dd class="mono">{r.value}</dd>
        </div>
      {/each}
    </dl>
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
