<script lang="ts">
  import {
    type AdviceInputs,
    type AdvisorAdvice,
    AdvisorController,
    type AdvisorResult,
    type EditedAdvisorState,
    type ParsedAdvisorState,
    countUnconfirmed,
    parsedToEdited,
  } from '../../lib/advisor/advisorController';
  import { bracketLabel } from '../../lib/cutplan/cutPlan';
  import { GOLD_BRACKETS, GOLD_PER_DAMAGE, type GoldBracket } from '../../lib/cutplan/types';
  import type { ArkGridGem } from '../../lib/models/arkGridGems';
  import { type GemRole } from '../../lib/scoring/gemScore';
  import { autoBaselineFromLoadout, effectiveBaseline } from '../../lib/scoring/triage';
  import { sectionUI, toggleSection } from '../../lib/state/appConfig.state.svelte';
  import {
    type CharacterProfile,
    activeBuildState,
    updateAdvisorRosterBound,
    updateGoldPer1Pct,
  } from '../../lib/state/profile.state.svelte';
  import BaselineControl from '../BaselineControl.svelte';
  import BuildViewSwitch from '../BuildViewSwitch.svelte';
  import ProcessingWindow from './ProcessingWindow.svelte';

  interface Props {
    profile: CharacterProfile;
  }
  let { profile }: Props = $props();

  // Advice inputs, derived from the active build exactly like the Cutting Plan.
  let build = $derived(activeBuildState(profile));
  let role: GemRole = $derived(profile.activeBuild);
  let equipped: ArkGridGem[] = $derived(
    (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat()
  );
  let baselineGrade = $derived(
    effectiveBaseline(autoBaselineFromLoadout(equipped, role), build.baselineOverride, role)
  );
  let bracket: GoldBracket = $derived(profile.goldPer1Pct ?? '2_5M');
  let goldPerDamage = $derived(GOLD_PER_DAMAGE[bracket]);
  // Roster-bound advice (default ON, like upstream since 2026-08-10): the gem cannot be sold, so the
  // solve treats processing gold as already committed and optimizes the gem; rerolls and Reset still
  // price their real gold. Off = classic gold-EV advice. Persisted per profile.
  let rosterBound = $derived(profile.advisorRosterBound ?? true);
  let inputs: AdviceInputs = $derived({
    baselineGrade,
    gpd: goldPerDamage,
    axis: role,
    rosterBound,
  });

  // Live screen watching needs getDisplayMedia (desktop Chromium); mobile / Safari use Upload.
  const captureSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  let controller: AdvisorController | null = null;
  function getController() {
    if (controller) return controller;
    controller = new AdvisorController();
    controller.onAdvice = (res) => {
      // Keep the last good advice if a frame briefly can't be read (window off-screen mid-animation).
      if (res) {
        result = res;
        liveAdvice = res.advice;
        lastEdited = parsedToEdited(res.parsed);
        error = null;
        engaged = true; // a live read counts as engaging, so market changes re-rank it afterwards
      }
    };
    // The read is done but the DP is still running (it is the large majority of a re-read's wall
    // time). Repaint the window from the fresh state now so the move is visibly confirmed, and leave
    // the ranked actions showing "Updating advice…" until onAdvice lands. Deliberately does NOT touch
    // liveAdvice: stale numbers next to a fresh gem would be worse than an honest pending state.
    controller.onPartial = (res) => {
      result = res;
      lastEdited = parsedToEdited(res.parsed);
      error = null;
      engaged = true;
      stateLanded = true; // the screen is read; what remains is the DP
      // A gem the reader has no history for — a new cut, or one it lost track of. Its ranked actions
      // are still several seconds away (a fresh gem is turn 1 of 9, the DEEPEST and slowest search),
      // and leaving the previous cut's numbers on screen next to it reads as the advisor being stuck
      // on the old gem. Clear them so the panel shows an honest pending state instead. A normal
      // in-cut step keeps its numbers: they are one action stale, not a different gem entirely.
      if (res.fusion?.status === 'desync' || res.fusion?.status === 'seeded') liveAdvice = null;
    };
    controller.onShareEnded = () => {
      watching = false;
    };
    controller.onReading = (b) => {
      reading = b;
      if (b) stateLanded = false; // a new read starts: back to "Reading screen…"
    };
    return controller;
  }

  // A legal default gem so the window (an interactive input form) is visible before any screenshot,
  // you can build a gem by hand, and an upload / live frame replaces it.
  const DEFAULT_PARSED: ParsedAdvisorState = {
    config: {
      baseCost: 9,
      gemType: 'chaos',
      willpowerLevel: 1,
      orderLevel: 1,
      effect1: 'Attack Power',
      effect1Level: 1,
      effect2: 'Boss Damage',
      effect2Level: 1,
    },
    state: {
      currentTurn: 1,
      maxTurns: 9,
      rerollsRemaining: 3,
      processCost: 900,
      processCostMultiplier: 0,
      rosterBound: false,
    },
    outcomes: [
      { type: 'do_nothing' },
      { type: 'do_nothing' },
      { type: 'do_nothing' },
      { type: 'do_nothing' },
    ],
    rarity: 'epic',
  };
  const DEFAULT_EDITED: EditedAdvisorState = {
    config: DEFAULT_PARSED.config,
    state: {
      currentTurn: 1,
      maxTurns: 9,
      rerollsShownFree: 2,
      resetsRemaining: 1,
      processCostMultiplier: 0,
      rosterBound: false,
    },
    outcomes: DEFAULT_PARSED.outcomes,
    rarity: 'epic',
  };
  let parsing = $state(false);
  // `result.parsed` seeds the window ONCE per fresh parse (upload / live frame / default). Manual
  // edits never touch it, the window renders from its own local state, so the visual stays instant.
  let result = $state<AdvisorResult | null>({ parsed: DEFAULT_PARSED, advice: null });
  let liveAdvice = $state<AdvisorAdvice | null>(null);
  let advisePending = $state(0);
  let advising = $derived(advisePending > 0);
  let reading = $state(false); // a live re-read / manual re-parse is in flight (set by the controller)
  // Set once a re-read's OCR half has landed (the window is already repainted) while its DP half is
  // still running, so the status line can stop claiming the screen is being read.
  let stateLanded = $state(false);
  let readingScreen = $derived((reading && !stateLanded) || parsing); // a NEW screen is being read
  let computing = $derived(reading || parsing || advising); // any advice recompute in flight
  let error = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let watching = $state(false);
  let dragOver = $state(false);
  let frameMsg = $state('');
  let frameMsgTimer: ReturnType<typeof setTimeout>;
  // The gem currently shown (default / parsed / hand-edited); re-advised when the market inputs change.
  let lastEdited = $state<EditedAdvisorState>(DEFAULT_EDITED);

  // Keep the running watch loop's advice inputs in sync with the active build.
  $effect(() => {
    if (watching) controller?.updateInputs(inputs);
  });

  // First time the user hovers / focuses / touches the advisor: build the worker so the first real
  // read isn't paying for a cold start. Deliberately does NOT rank anything — the gem on screen is
  // still the placeholder, and advising it presents invented numbers as if they were the user's cut.
  // Advice starts only once there's a real gem: a parse (screen share / upload) or a manual edit.
  let engaged = false;
  function engage() {
    if (engaged || !sectionUI.showAdvisor) return;
    getController().warmup();
  }
  // Re-rank when a market input (role / gold bracket / baseline) changes. The effect only DETECTS the
  // change by reading `inputs`; the async worker call is deferred to a debounced macrotask so the
  // effect never writes reactive state during the flush. (Calling the worker synchronously from an
  // effect ping-ponged the reactive graph and froze the tab — that was the DPS/Support hang.) Skipped
  // until first engagement so a market tweak never spins up the worker on its own.
  let reAdviseTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const snapshot = inputs; // capture the FRESH inputs here (a $derived read in a detached macrotask
    if (!engaged) return; //    can come back stale), and pass it into the deferred re-advise.
    clearTimeout(reAdviseTimer);
    // adoptMemory: false — this replays the last-seen gem, it is not a new user correction.
    reAdviseTimer = setTimeout(() => void onManualEdit(lastEdited, snapshot, false), 200);
  });

  const fmtGold = (g: number) =>
    !isFinite(g) ? '-' : Math.abs(g) >= 1000 ? `${(g / 1000).toFixed(1)}k` : String(Math.round(g));

  async function startWatch() {
    if (!captureSupported) return;
    error = null;
    try {
      await getController().startWatching(inputs);
      watching = true;
    } catch (e) {
      const name = (e as DOMException)?.name;
      error =
        name === 'NotAllowedError'
          ? 'Screen sharing was denied.'
          : String((e as Error)?.message ?? e);
      watching = false;
    }
  }
  function stopWatch() {
    getController().stopWatching();
    watching = false;
  }
  function warm() {
    if (captureSupported) getController().warmup();
  }
  // Saves the exact raster the reader last parsed. Useful when a value comes out wrong: the saved
  // frame reproduces the misread offline, which a fresh screenshot of the same state does not.
  function saveFrame() {
    frameMsg = getController().saveFrame();
    clearTimeout(frameMsgTimer);
    frameMsgTimer = setTimeout(() => (frameMsg = ''), 3000);
  }

  async function parseFile(file: File) {
    if (parsing) return;
    parsing = true;
    error = null;
    try {
      const bitmap = await createImageBitmap(file);
      const res = await getController().parseImage(bitmap, inputs);
      if (!res) error = 'Could not read a Processing window from that image.';
      else {
        result = res;
        liveAdvice = res.advice;
        lastEdited = parsedToEdited(res.parsed);
        engaged = true; // an uploaded read counts as engaging, so market changes re-rank it afterwards
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
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void parseFile(f);
  }

  // Manual edit on the Processing window: re-rank from the hand-set state (no image). Update ONLY the
  // advice, the window already repainted from its own local state, so we never touch `result.parsed`
  // (that would reseed the window and stomp the edit). The DP is ~0.5-2s; the visual doesn't wait on it.
  //
  // `adoptMemory` defaults true because ProcessingWindow's `onEdit` calls this with just `edited` — a
  // genuine hand correction should update the watch tracker. The market-recalc effect below is the one
  // other caller, and it replays the SAME `lastEdited` on every gold-bracket / role / baseline change
  // (not a real edit), so it passes false explicitly to keep that re-rank from adopting the frame.
  async function onManualEdit(
    edited: EditedAdvisorState,
    adviceInputs: AdviceInputs = inputs,
    adoptMemory = true
  ) {
    engaged = true; // an edit (or a market change on an already-read gem) counts as engaging
    lastEdited = edited;
    advisePending++;
    try {
      // $state.snapshot strips Svelte reactive proxies; a raw proxy throws DataCloneError in the
      // worker's postMessage (structured clone can't clone it), which silently killed the re-advise.
      const res = await getController().advise(
        $state.snapshot(edited) as EditedAdvisorState,
        adviceInputs,
        adoptMemory
      );
      if (res) {
        liveAdvice = res.advice;
        error = null;
      }
    } finally {
      advisePending--;
    }
  }

  const onBracket = (e: Event) =>
    updateGoldPer1Pct((e.target as HTMLSelectElement).value as GoldBracket);
  const onRosterBound = () => updateAdvisorRosterBound(!rosterBound);

  // Recommended-action panel: all four actions in a fixed order, the best one highlighted.
  const ACTION_ORDER = ['Process', 'Reroll', 'Complete', 'Reset'] as const;
  let actionByName = $derived(
    Object.fromEntries((liveAdvice?.allActions ?? []).map((a) => [a.name, a]))
  );
  // Fields the reader was not sure about. Ranking actions off them without saying so presents a guess
  // as a finding — the misread that produced a wrong recommendation was flagged on screen at the time.
  let unconfirmed = $derived(countUnconfirmed(result?.parsed));
  // Below this the Processing window is small enough that glyph reads measurably degrade: after the
  // 2026-08 parser re-sync, 99.1% of fields vs 99.7% and about three times the "confirm me" flags per
  // frame (harness, c219 vs the standard-aspect corpora). The usual cause is the game's Force 21:9
  // setting, which letterboxes the UI.
  const READABLE_PANEL_PX = 800;
  let smallPanel = $derived(
    result?.parsed?.panelWidth != null && result.parsed.panelWidth < READABLE_PANEL_PX
      ? result.parsed.panelWidth
      : null
  );
  let hasAdvice = $derived(
    !!liveAdvice && (liveAdvice.allActions ?? []).some((a) => isFinite(a.value))
  );
  // Fusion lost the thread of the cut (gem switch, missed frames, an off-screen action):
  // this frame was read fresh, so it may carry more amber flags than usual.
  let fusionDesync = $derived(watching && result?.fusion?.status === 'desync');
  function naReason(name: string): string {
    const st = lastEdited.state;
    const turn = st.currentTurn ?? 1;
    const attemptsLeft = (st.maxTurns ?? 9) - turn + 1;
    const free = st.rerollsShownFree ?? 0;
    if (name === 'Reroll')
      return turn <= 1 ? 'process once first' : free <= 0 ? 'no rerolls left' : 'not ranked here';
    if (name === 'Complete') return turn <= 1 ? 'process once first' : 'not ranked here';
    if (name === 'Reset') return attemptsLeft > 1 ? 'last turn only' : 'not worth it';
    return 'not ranked here';
  }
</script>

<div class="panel advisor-panel">
  <div class="title section-title">
    Cut Advisor
    <span
      class="wip-badge"
      title="Screen-reading is best-effort on smaller monitors; double-check highlighted values."
    >
      Work in progress
    </span>
    <button
      class="fold-button"
      aria-label={sectionUI.showAdvisor ? 'Collapse section' : 'Expand section'}
      onclick={() => toggleSection('showAdvisor')}
    >
      {sectionUI.showAdvisor ? '▼' : '▲'}
    </button>
  </div>

  {#if sectionUI.showAdvisor}
    {#if error}
      <p class="advisor-error">{error}</p>
    {/if}

    {#if result}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="advisor-layout" onpointerenter={engage} onfocusin={engage}>
        <!-- LEFT: the interactive visualizer -->
        <div class="advisor-window">
          <ProcessingWindow parsed={result.parsed} onEdit={onManualEdit} />
        </div>

        <!-- RIGHT: capture -> market -> recommended action -->
        <div class="advisor-side">
          <!-- 1. your market (same inputs as Gem Triage / Cutting Plan) -->
          <div class="side-panel">
            <div class="side-title">Your market</div>
            {#if profile.dualRole}
              <div class="market-row"><BuildViewSwitch /></div>
            {:else}
              <div class="market-row">
                <span class="mk-label">Build</span>
                <span class="mk-static">{role === 'support' ? 'Support' : 'DPS'}</span>
              </div>
            {/if}
            <label class="market-row">
              <span class="mk-label">Gold / 1% damage</span>
              <select value={bracket} onchange={onBracket}>
                {#each GOLD_BRACKETS as b (b)}<option value={b}>{bracketLabel(b)}</option>{/each}
              </select>
            </label>
            <div class="market-row">
              <span class="mk-label">Processing gold</span>
              <button
                type="button"
                class="mk-toggle"
                aria-pressed={rosterBound}
                title={rosterBound
                  ? 'Roster-bound: the gem cannot be sold, so processing gold counts as spent and the advice optimizes the gem. Rerolls and Reset still cost gold. Click for classic gold-value advice.'
                  : 'Gold value: every action is weighed against its gold cost. Click to treat processing gold as committed (roster-bound).'}
                onclick={onRosterBound}
              >
                {rosterBound ? 'Roster-bound' : 'Gold value'}
              </button>
            </div>
            <div class="market-row"><BaselineControl {profile} /></div>
          </div>

          <!-- 2. recommended action -->
          <div class="side-panel actions-panel" data-testid="advisor-advice">
            <div class="side-title">Recommended action</div>
            {#if computing}
              <div class="rec-reading" role="status" aria-live="polite">
                <span>{readingScreen ? 'Reading screen…' : 'Updating advice…'}</span>
                <div class="rec-progress"><div class="rec-progress-bar"></div></div>
              </div>
            {/if}
            {#if hasAdvice && unconfirmed > 0}
              <div class="rec-unconfirmed" role="status">
                Based on {unconfirmed} value{unconfirmed > 1 ? 's' : ''} the reader wasn't sure of. Check
                the highlighted field{unconfirmed > 1 ? 's' : ''} on the gem first — correcting one can
                change which action wins.
              </div>
            {/if}
            {#if hasAdvice}
              <div class="rec-cards" class:stale={computing} class:unconfirmed={unconfirmed > 0}>
                {#each ACTION_ORDER as name (name)}
                  {@const a = actionByName[name]}
                  {@const isBest = name.toLowerCase() === liveAdvice?.bestAction}
                  <div class="rec-card" class:best={isBest} class:na={!(a && isFinite(a.value))}>
                    <div class="rc-name">
                      {name}
                      {#if isBest}<span class="rc-pill">Recommended</span>{/if}
                    </div>
                    {#if a && isFinite(a.value)}
                      <div class="rc-metrics">
                        <span class="rc-metric">
                          <b class="rc-ev {a.value >= 0 ? 'good' : 'bad'}">{fmtGold(a.value)}</b>
                          <small>net value</small>
                        </span>
                        <span class="rc-metric">
                          <b>{Math.round(a.aboveBaselineOdds * 100)}%</b>
                          <small>above baseline</small>
                        </span>
                        <span class="rc-metric">
                          <b>{fmtGold(a.expectedCost)}</b>
                          <small>exp. spend</small>
                        </span>
                      </div>
                    {:else}
                      <div class="rc-na">{naReason(name)}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <div class="rec-empty">
                Build your gem on the left (click any field) or read a screenshot, and the ranked
                advice appears once there's a gem to weigh.
              </div>
            {/if}
          </div>

          <!-- 3. read your screen -->
          <div class="side-panel">
            <div class="side-title">Read your screen</div>
            <div class="advisor-buttons">
              {#if captureSupported}
                {#if !watching}
                  <button class="primary" onclick={startWatch} onpointerenter={warm} onfocus={warm}>
                    🖥️ Start watching
                  </button>
                {:else}
                  <button class="primary active" onclick={stopWatch}>⏹ Stop watching</button>
                  <button
                    onclick={() => void getController().reparseNow()}
                    title="Force a re-read of the current screen"
                  >
                    🔄 Re-read now
                  </button>
                  <button
                    onclick={saveFrame}
                    title="Download the exact frame the reader last parsed, as a PNG"
                  >
                    💾 Save frame
                  </button>
                {/if}
              {/if}
              {#if !watching}
                <button onclick={() => fileInput?.click()}>📷 Upload screenshot</button>
              {/if}
              <input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onPick} />
            </div>
            {#if smallPanel}
              <div class="small-panel-note">
                The Processing window is only {smallPanel}px wide in this capture, which makes the
                small level digits harder to read. If your game has
                <strong>Force 21:9 Aspect Ratio</strong>
                turned on, switching it off makes the window noticeably bigger and reads more accurate.
              </div>
            {/if}
            {#if fusionDesync}
              <div class="small-panel-note" role="status">
                Lost track of the cut, reading this frame fresh. If a value looks off, correct it on
                the gem and the reader re-syncs from there.
              </div>
            {/if}
            {#if watching}
              <div class="watch-status">
                {frameMsg || "Watching… the window on the left confirms what's being read."}
              </div>
            {:else}
              <div
                class="drop"
                class:dragging={dragOver}
                role="button"
                tabindex="0"
                ondragover={(e) => {
                  e.preventDefault();
                  dragOver = true;
                }}
                ondragleave={() => (dragOver = false)}
                ondrop={onDrop}
                onclick={() => fileInput?.click()}
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput?.click()}
              >
                {parsing
                  ? 'Reading…'
                  : dragOver
                    ? 'Drop to read this gem'
                    : 'Drop a Processing screenshot here'}
              </div>
            {/if}
            <p class="advisor-intro">
              Share your screen (desktop Chromium, English client) and it re-reads the Processing
              window each time it changes. No screen share? Drop a screenshot, or just build the gem
              by hand on the left.
            </p>
            <p class="advisor-intro advisor-note">
              Screen-reading is best-effort: on smaller monitors the tiny level and point digits can
              be misread, so double-check any highlighted values before acting. A dropped screenshot
              reads more reliably than a live share.
            </p>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .advisor-intro {
    margin: 0.6rem 0 0;
    font-size: 0.82rem;
    line-height: 1.5;
    color: #9aa7bd;
  }
  .advisor-note {
    color: #b0812f;
  }
  :global(.dark-mode) .advisor-note {
    color: #d9b25a;
  }
  .wip-badge {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.08rem 0.5rem;
    border-radius: 999px;
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    vertical-align: middle;
    color: #8a6d1f;
    background: #f5e3b0;
    border: 1px solid #e6cd7a;
  }
  :global(.dark-mode) .wip-badge {
    color: #f0d894;
    background: #3a3320;
    border-color: #5c4f28;
  }
  .advisor-error {
    color: #8a3a3a;
  }
  :global(.dark-mode) .advisor-error {
    color: #ef8a8a;
  }

  .advisor-layout {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    margin-top: 0.75rem;
  }
  .advisor-window {
    flex: 2 1 460px;
    min-width: 300px;
    max-width: 620px;
  }
  .advisor-side {
    flex: 1 1 300px;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* ---- side panels ---- */
  /* All three share the same dark, game-styled frame so the section reads as one system. The shared
     market controls colour their tick/hint text with var(--text); override it light here so they stay
     readable on the dark panel in the app's LIGHT theme too (they already handle dark mode). */
  .side-panel {
    --text: #dfe4ee;
    background: radial-gradient(120% 100% at 50% 0%, #12213a 0%, #0a1120 65%, #05070e 100%);
    border: 1px solid #2a3350;
    border-radius: 0.55rem;
    padding: 0.65rem 0.75rem;
    color: #cfd6e2;
  }
  .side-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #d8c891;
    margin-bottom: 0.55rem;
  }

  /* ---- capture ---- */
  .advisor-buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.55rem;
  }
  .advisor-buttons button {
    padding: 0.4rem 0.7rem;
    border-radius: 0.4rem;
    cursor: pointer;
    background: linear-gradient(180deg, #2a303c, #1b2028);
    border: 1px solid #3d4450;
    color: #e5e9f0;
  }
  .advisor-buttons button:hover {
    filter: brightness(1.12);
  }
  .advisor-buttons button.primary.active {
    background: #8a3a3a;
    border-color: #a85a5a;
    color: #fff;
  }
  .watch-status {
    color: #4ade80;
    font-weight: 600;
    font-size: 0.82rem;
  }
  .drop {
    border: 2px dashed #3a4459;
    border-radius: 0.5rem;
    padding: 0.9rem;
    text-align: center;
    font-size: 0.85rem;
    cursor: pointer;
    color: #b9c2d0;
    background: rgba(255, 255, 255, 0.02);
    transition:
      border-color 0.12s ease,
      background 0.12s ease,
      color 0.12s ease;
  }
  .drop:hover {
    border-color: #c9a24a;
    color: #e7d9b0;
  }
  /* Gold highlight while a file is dragged over the intake. */
  .drop.dragging {
    border-color: #e6c266;
    border-style: solid;
    background: rgba(230, 194, 102, 0.16);
    color: #ffe08a;
    font-weight: 600;
  }

  /* ---- market ---- */
  .market-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .market-row:last-child {
    margin-bottom: 0;
  }
  .mk-label {
    font-size: 0.85rem;
    color: #b9c2d0;
  }
  .mk-static {
    font-weight: 600;
    font-size: 0.85rem;
    color: #e5e9f0;
  }
  .market-row select {
    padding: 0.3rem 0.4rem;
    border-radius: 0.35rem;
    max-width: 60%;
    background: #182035;
    color: #e6ecf7;
    border: 1px solid #33405f;
  }
  .mk-toggle {
    padding: 0.3rem 0.6rem;
    border-radius: 0.35rem;
    background: #182035;
    color: #e6ecf7;
    border: 1px solid #33405f;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .mk-toggle[aria-pressed='true'] {
    border-color: #5b8def;
    color: #cfe0ff;
  }
  .mk-toggle:focus-visible {
    outline: 2px solid #5b8def;
    outline-offset: 2px;
  }

  /* ---- recommended action (game-styled, like the buttons in the visual) ---- */
  .rec-cards {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    transition: opacity 0.12s ease;
  }
  .rec-cards.stale {
    opacity: 0.5;
  }
  .rec-reading {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
    margin-bottom: 0.55rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: #e6c266;
  }
  .rec-progress {
    height: 3px;
    border-radius: 3px;
    background: rgba(230, 194, 102, 0.16);
    overflow: hidden;
  }
  .rec-progress-bar {
    height: 100%;
    width: 40%;
    border-radius: 3px;
    background: #e6c266;
    animation: rec-progress-slide 1.1s ease-in-out infinite;
  }
  @keyframes rec-progress-slide {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(360%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .rec-progress-bar {
      animation: none;
      width: 100%;
      opacity: 0.55;
    }
  }
  .rec-card {
    border-radius: 0.45rem;
    padding: 0.5rem 0.7rem;
    color: #cfd6e2;
    background: linear-gradient(180deg, #2a303c, #1b2028);
    border: 1px solid #3d4450;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .rec-card.na {
    opacity: 0.5;
  }
  .rec-card.best {
    border-color: #e6c266;
    background: linear-gradient(180deg, #3a3320, #241d0e);
    box-shadow:
      0 0 0 1px rgba(230, 194, 102, 0.5),
      0 3px 12px rgba(0, 0, 0, 0.45);
  }
  .rc-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: 'Cinzel', Georgia, serif;
    font-weight: 600;
    font-size: 1.02rem;
    color: #e5e9f0;
  }
  .rec-card.best .rc-name {
    color: #ffe08a;
  }
  .rc-pill {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: #e6c266;
    color: #3a2c08;
    padding: 1px 7px;
    border-radius: 999px;
  }
  .rc-metrics {
    display: flex;
    gap: 0.9rem;
    margin-top: 0.3rem;
    font-variant-numeric: tabular-nums;
  }
  .rc-metric {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
  }
  .rc-metric b {
    font-size: 0.9rem;
    font-weight: 700;
    color: #eef2f8;
  }
  .rc-metric small {
    font-size: 0.6rem;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .rc-ev.good {
    color: #5fc94f;
  }
  .rc-ev.bad {
    color: #e0533f;
  }
  .rc-na {
    margin-top: 0.2rem;
    font-size: 0.78rem;
    opacity: 0.7;
  }
  .small-panel-note {
    margin: 8px 0 0;
    padding: 7px 9px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent, #6aa9e9) 10%, transparent);
    color: color-mix(in srgb, var(--text) 80%, transparent);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .small-panel-note strong {
    color: var(--text);
  }
  .rec-unconfirmed {
    margin: 0 0 8px;
    padding: 7px 9px;
    border: 1px solid color-mix(in srgb, var(--warn, #d9a441) 55%, transparent);
    border-left-width: 3px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--warn, #d9a441) 12%, transparent);
    color: var(--text);
    font-size: 0.82rem;
    line-height: 1.35;
  }
  /* the ranking is still shown, just not presented as settled while inputs are unconfirmed */
  .rec-cards.unconfirmed {
    opacity: 0.92;
  }
  .rec-empty {
    font-size: 0.85rem;
    line-height: 1.5;
    color: #b9c2d0;
  }
</style>
