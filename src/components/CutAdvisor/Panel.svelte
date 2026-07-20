<script lang="ts">
  import { AdvisorController, type ParsedAdvisorState } from '../../lib/advisor/advisorController';
  import { sectionUI, toggleSection } from '../../lib/state/appConfig.state.svelte';

  // One controller per panel instance (module-worker owner), created lazily on first use.
  let controller: AdvisorController | null = null;
  function getController() {
    if (!controller) controller = new AdvisorController();
    return controller;
  }

  let parsing = $state(false);
  let parsed = $state<ParsedAdvisorState | null>(null);
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  async function parseFile(file: File) {
    if (parsing) return;
    parsing = true;
    error = null;
    parsed = null;
    try {
      const bitmap = await createImageBitmap(file);
      const result = await getController().parseImage(bitmap);
      if (!result) {
        error = 'Could not read a Processing window from that image.';
      } else {
        parsed = result;
      }
    } catch (e) {
      error = String((e as Error)?.message ?? e);
    } finally {
      parsing = false;
    }
  }

  function onPick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void parseFile(f);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) void parseFile(f);
  }
</script>

<div class="panel advisor-panel">
  <div class="title section-title">
    Cut Advisor
    <button
      class="fold-button"
      aria-label={sectionUI.showAdvisor ? 'Collapse section' : 'Expand section'}
      onclick={() => toggleSection('showAdvisor')}
    >
      {sectionUI.showAdvisor ? '▼' : '▲'}
    </button>
  </div>

  {#if sectionUI.showAdvisor}
    <p class="advisor-intro">
      Drop a screenshot of the in-game gem Processing window and the advisor reads the state, then
      tells you the best move. English game client, desktop only.
    </p>

    <div
      class="drop"
      role="button"
      tabindex="0"
      ondragover={(e) => e.preventDefault()}
      ondrop={onDrop}
      onclick={() => fileInput?.click()}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput?.click()}
    >
      {parsing ? 'Reading…' : 'Drop a Processing-window screenshot, or click to choose one.'}
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        hidden
        onchange={onPick}
      />
    </div>

    {#if error}
      <p class="advisor-error">{error}</p>
    {/if}

    {#if parsed}
      <div class="parsed" data-testid="advisor-parsed">
        <div class="parsed-line">
          <strong>Gem</strong>: cost {parsed.config.baseCost} · {parsed.config.gemType} · willpower
          {parsed.config.willpowerLevel} · order {parsed.config.orderLevel}
        </div>
        <div class="parsed-line">
          <strong>Effects</strong>: {parsed.config.effect1} {parsed.config.effect1Level} · {parsed
            .config.effect2}
          {parsed.config.effect2Level}
        </div>
        <div class="parsed-line">
          <strong>Turn</strong>: {parsed.state.currentTurn}/{parsed.state.maxTurns} · rerolls
          {parsed.state.rerollsRemaining}{parsed.ocrDegraded ? ' · (low confidence)' : ''}
        </div>
        <div class="parsed-line">
          <strong>Outcomes</strong>: {parsed.outcomes.map((o) => o.type).join(', ')}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .advisor-intro {
    opacity: 0.85;
    font-size: 0.9rem;
  }
  .drop {
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    padding: 1.5rem;
    text-align: center;
    cursor: pointer;
    background: var(--card);
  }
  .drop:hover {
    border-color: var(--accent, #b8860b);
  }
  .advisor-error {
    color: #8a3a3a;
  }
  :global(.dark-mode) .advisor-error {
    color: #ef8a8a;
  }
  .parsed {
    margin-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }
</style>
