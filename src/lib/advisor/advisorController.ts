// AdvisorController — the Cut Advisor twin of cv/captureController. Owns one advisorWorker, manages
// init, and exposes a single-image parse (upload / paste / one screen-share frame). The parser stack
// lives entirely in the worker; this class is the main-thread message shell with a worker-crash
// backstop, mirroring CaptureController and SolverController.
import type { FusionPrior, FusionStatus } from './fusion';

export interface AdvisorConfig {
  baseCost: number;
  gemType: string;
  willpowerLevel: number;
  orderLevel: number;
  effect1: string;
  effect1Level: number;
  effect2: string;
  effect2Level: number;
}
/** One possible-outcome tile, in the shape his snapOutcome emits. */
export interface AdvisorOutcome {
  type: string;
  target?: string;
  amount?: number;
  change?: number; // change_gold_cost (±100) / reroll_increase (+1|+2) live here, NOT amount
  effectName?: string;
  currentEffect?: string;
  description?: string;
}
export interface ParsedAdvisorState {
  config: AdvisorConfig;
  state: {
    currentTurn: number;
    maxTurns: number;
    rerollsRemaining: number;
    resetsRemaining?: number; // his "Reset (x/1)" counter; undefined = unread (assume unused)
    processCost?: number;
    processCostMultiplier: number;
    totalGoldSpent?: number;
    rosterBound: boolean;
  };
  outcomes: AdvisorOutcome[];
  rarity?: string; // uncommon | rare | epic (constraintSnap emits it)
  confidence?: unknown;
  ocrDegraded?: boolean;
  /**
   * On-screen width of the Processing window in the captured frame, in pixels. The best single
   * predictor of read quality: the same client measures 99.7% of fields correct at ~925px and 99.1%
   * at ~677px with about three times the "confirm me" flags (2026-08 re-sync numbers), because Force
   * 21:9 letterboxes the UI and shrinks every glyph with it.
   */
  panelWidth?: number;
  /**
   * The parser's own upscale factor (1 | 2 | 3), picked from the wheel gap BEFORE any pixel is read.
   * Upstream's round-17 measurement over his 472-board corpus: scale-1 and scale-2 captures parse
   * equally well, but the scale-3 tier (the window at about a third of the wanted size) carries 20.4%
   * of ALL flags at 6.8% of boards and never once parses clean. 3 therefore warrants a hard
   * "recapture larger" warning; width is a weaker proxy and stays as the fallback note.
   */
  scaleF?: number;
}

/**
 * A manually-entered / corrected game state, sent to the worker's `advise` path. The worker runs it
 * through his constraintSnap (the same normalize the parser uses) before re-ranking, so callers pass
 * raw human-picked values and let the snap make them legal. `rerollsShownFree` is the FREE-reroll
 * count the game shows; the snap converts it to model units (free + the paid final reroll).
 */
export interface EditedAdvisorState {
  config: AdvisorConfig;
  state: {
    currentTurn: number;
    maxTurns: number;
    rerollsShownFree?: number;
    /**
     * All rerolls gone, including the paid one (the dimmed grey "Charge" button). Needed because
     * `rerollsShownFree` cannot express it: the snap reads 0 free as "0 free + 1 paid" = 1 in model
     * units, so a spent gem round-tripped through `rerollsShownFree` grows a phantom reroll.
     */
    rerollsChargeSpent?: boolean;
    resetsRemaining?: number;
    processCostMultiplier: number;
    rosterBound?: boolean;
  };
  outcomes: AdvisorOutcome[];
  rarity: string;
}

/** One ranked action from the DP (his topLevelAdvice allActions entry). */
export interface AdvisorAction {
  name: string; // Process | Reroll | Complete | Reset
  value: number; // net expected gold value
  expectedScore: number; // expected % damage of the resulting gem
  expectedCost: number; // expected gold spent from here
  aboveBaselineOdds: number; // P(the result clears your baseline)
  description: string;
}
/**
 * One row of the DP's reset-pair table: the net value of a fresh cut landing on this side-effect
 * pair, reset fee included. Present only when Reset is a live consideration (the last turn, or
 * Complete winning), because an in-game reset MAY re-roll the two side effects while the single
 * ranked Reset value assumes they come back unchanged.
 */
export interface AdvisorResetCombo {
  effect1: string;
  effect2: string;
  net: number;
  expectedScore: number;
  /** True for this gem's own current pair. */
  current: boolean;
}
export interface AdvisorAdvice {
  bestAction: string; // lowercased winning action
  allActions: AdvisorAction[];
  currentValue: number;
  resetCost: number | null;
  /** Sorted by net desc (the vendored dp.js builds and sorts it); null/absent when reset isn't live. */
  resetCombos?: AdvisorResetCombo[] | null;
}
export interface AdvisorResult {
  parsed: ParsedAdvisorState;
  advice: AdvisorAdvice | null; // null when no baseline/gpd was supplied
  /** Present on watch-loop parses (and manual advises): the fusion status and the memory
   * to carry into the next frame. Uploads ignore it. */
  fusion?: { status: FusionStatus; nextPrior: FusionPrior };
}
export interface AdviceInputs {
  baselineGrade?: number; // 0-100 grade; the worker converts to the DP's gemValue threshold
  gpd?: number; // gold per 1% damage
  axis?: 'dps' | 'support';
  /**
   * Roster-bound advice: processing gold is treated as committed (astrogems cannot be sold), so the DP
   * optimizes the gem rather than the gold; rerolls and Reset still price their real gold. A market
   * input, not a parsed one: nothing on the Processing screen says it, so it overrides whatever the
   * parse or edit carried in `state.rosterBound`.
   */
  rosterBound?: boolean;
}

// --- Watch-loop re-read gate --------------------------------------------------------------------
// The in-game process animation flashes in TWO phases (the process flash, then the outcome reveal)
// about 700ms apart, dipping to ~38 motion in the lull between. So we wait for no fresh spike for a
// good beat AND require this exact frame to be calm before parsing; otherwise we read a mid-
// animation state and advise on it, which made the recommendation jump then correct itself on the
// next read.
const STABLE_MS = 900; // no fresh spike for this long means the whole animation has finished
const QUIET = 22; // and this exact frame must be calm, not a still-settling ~38-motion frame
// The shared game window animates constantly (the spinning dial, the gem shimmer), moving ~15-35
// downscaled pixels every frame even when nothing happened. A real process / reroll always jumps
// far past that noise floor. Measured live over ~100 idle frames and 14 real events: ambient tops
// out around 35, while a genuine event starts around 41. So we re-read only when a real motion
// spike has fired since the last read (SPIKE) AND the settled frame differs from what we last read
// by more than the ambient ceiling (CONTENT). Ambient trips neither, so a static screen spends zero
// parses.
const SPIKE = 40; // changed pixels vs the previous frame above this = a real in-window event
const CONTENT = 36; // changed pixels vs the last read above this = the gem state actually changed
// ...except 40 was measured on ONE screen. Ambient depends on how much of the share the animated
// game world occupies, and it varies hugely between setups: the owner's 677px window idles at 0-7,
// nowhere near the 15-35 the constant was tuned against. On that screen a reroll peaking at 33 never
// latched (captured live 2026-08-04) while a process at 87-179 did, which is exactly the reported
// "the reroll works most of the time" - the flash straddles a bar sitting in the middle of its
// spread. So the bar tracks the screen instead: it sits a clear margin above recently observed
// ambient, which keeps a static screen at zero parses on a noisy setup while still catching the
// weaker flashes on a quiet one.
const SPIKE_WINDOW = 30; // polls of motion history (~9s at POLL_MS) used to characterise ambient
const SPIKE_MIN_SAMPLES = 10; // below this, keep the field-measured constant rather than guess
const SPIKE_FLOOR = 12; // never let a perfectly still screen drop the bar into compression flicker
// A real event's flash reliably trips SPIKE, but its SETTLED frame can sit under CONTENT when only a
// few small digits (or same-layout text) changed. Measured live on a 677px Force-21:9 window
// (2026-08-04): a full gem swap flashed motion=87 yet settled at content 13-26, and a process step
// flashed 90 and settled at 20-33, so the latched spike never converted and the app sat stale for
// 26s until a manual re-read. A latched spike that stays calm this long is therefore read anyway:
// at worst a transient (a tooltip crossing the share, spike-then-revert) costs one redundant parse,
// which fusion absorbs as a confirmation of the unchanged state. The manual "Re-read now" button
// remains the escape hatch for a change whose flash never trips SPIKE at all.
const SPIKE_SETTLED_MS = 2500; // a spike calm this long re-reads even below the CONTENT bar

/**
 * The motion a frame must exceed to count as a real in-window event, given what this screen's
 * ambient motion has recently looked like. Pure and exported so tests can replay captured sequences.
 *
 * The 90th percentile is the ambient ceiling (robust to the odd stray frame), and the margin above it
 * is whichever is larger of a fixed 10 or half the ambient, so a quiet screen gets an absolute margin
 * and a noisy one gets a proportional one.
 */
export function spikeBarFor(recentMotion: number[]): number {
  if (recentMotion.length < SPIKE_MIN_SAMPLES) return SPIKE;
  const sorted = [...recentMotion].sort((a, b) => a - b);
  const ambient = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.max(SPIKE_FLOOR, ambient + Math.max(10, ambient * 0.5));
}

/** One polled, downscale-compared frame in the shape {@link watchReadGate} decides on. */
export interface WatchGateFrame {
  busy: boolean; // a parse is already in flight
  motion: number; // changed pixels vs the previous poll's frame
  content: number; // changed pixels vs the last-parsed frame (Infinity before the first read)
  stableFor: number; // ms since the last motion spike
  firstRead: boolean; // nothing parsed yet this watch session
  spikeSeen: boolean; // a spike has fired since the last read
}

/** The watch loop's re-read decision for one polled frame. Pure and exported so tests can replay
 * real captured motion/content sequences against it. */
export function watchReadGate(f: WatchGateFrame): boolean {
  if (f.busy || f.motion > QUIET) return false; // parse only a calm frame, never one still settling
  if (f.stableFor < STABLE_MS) return false;
  if (f.firstRead) return true;
  if (!f.spikeSeen) return false; // ambient alone: a static screen must spend zero parses
  return f.content > CONTENT || f.stableFor >= SPIKE_SETTLED_MS;
}

export class AdvisorController {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: AdvisorResult | null) => void>();
  private initialized = false;
  private awaitInit: { resolve: () => void; reject: (e: unknown) => void } | null = null;

  private createWorker(): Worker {
    const w = new Worker(new URL('./advisorWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => this.onMessage(e);
    w.onerror = () => this.onError();
    return w;
  }

  private onMessage(e: MessageEvent) {
    const d = e.data || {};
    if (d.type === 'init:done') {
      this.initialized = true;
      this.awaitInit?.resolve();
      this.awaitInit = null;
      return;
    }
    // The read landed but the DP is still running (it is 85-90% of a re-read's wall time). Surface
    // the state now so the window can confirm the move; the advice follows on parse:done.
    if (d.type === 'parse:state') {
      if (this.pending.has(d.id))
        this.onPartial?.({
          parsed: d.result as ParsedAdvisorState,
          advice: null,
          fusion: d.fusion as AdvisorResult['fusion'],
        });
      return;
    }
    if (d.type === 'parse:done') {
      const cb = this.pending.get(d.id);
      if (cb) {
        this.pending.delete(d.id);
        cb(
          d.error
            ? null
            : {
                parsed: d.result as ParsedAdvisorState,
                advice: (d.advice ?? null) as AdvisorAdvice | null,
                fusion: d.fusion as AdvisorResult['fusion'],
              }
        );
      }
    }
  }

  // A hard worker crash posts no parse:done, so settle every pending promise as "no result".
  private onError() {
    this.awaitInit?.reject(new Error('advisor worker crashed'));
    this.awaitInit = null;
    for (const cb of this.pending.values()) cb(null);
    this.pending.clear();
  }

  /** Pre-create the worker and boot tesseract ahead of the first parse (called on section open). */
  warmup() {
    if (this.worker) return;
    try {
      this.worker = this.createWorker();
      this.worker.postMessage({ type: 'init' });
    } catch {
      this.worker = null;
    }
  }

  // --- live screen watching (change-gated continuous loop) ---------------------------------------
  // The advisor parse is seconds of tesseract, not the ~30fps our OpenCV inventory matcher runs at, so
  // a per-frame loop would thrash. Instead we cheaply poll a tiny downscaled signature of the shared
  // screen; when it has held STILL for a beat (the in-game animation has settled) AND differs from the
  // frame we last parsed, we grab one full frame and re-advise. Net effect: you play a turn and the
  // advice refreshes on its own a moment later, with no button and no wasted parses on a static screen.
  // His parser locates the wheel by its diamond signature and normalizes to gap units, so this is
  // resolution- and aspect-agnostic (verified on 21:9 ultrawide, 16:9, and tight crops) — no per-
  // resolution anchor or 21:9 mode is needed here, unlike the inventory recognition path.
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private watching = false;
  private watchInputs: AdviceInputs = {};
  // The cut in progress, as of the last committed watch-loop parse (or manual correction).
  // Null until the first read of a session; cleared on start/stop so one gem's memory can
  // never leak into another session. See docs spec: temporal fusion.
  private tracker: FusionPrior | null = null;
  // Bumped on every start/stop; invalidates fusion adoption from a parse still in flight from a
  // previous watch session.
  private watchGen = 0;
  private sigCanvas: OffscreenCanvas | null = null;
  onAdvice: ((r: AdvisorResult | null) => void) | null = null;
  /**
   * Fired with the parsed state as soon as the OCR finishes, while the DP is still running, so the
   * Processing window can confirm what was read without waiting for the ranked actions. Its `advice`
   * is always null; the same result arrives again on {@link onAdvice} once the DP lands. Purely a
   * latency affordance: a caller that ignores it still sees everything, just later.
   */
  onPartial: ((r: AdvisorResult) => void) | null = null;
  onShareEnded: (() => void) | null = null;
  // Fired true when a live re-read / manual re-parse starts and false when it finishes, so the UI can
  // show a "reading screen" indicator instead of leaving stale advice looking final.
  onReading: ((busy: boolean) => void) | null = null;

  isSharing() {
    return !!this.stream;
  }

  /**
   * Open the screen picker and start watching; re-advises whenever the shared screen settles on a new
   * state. Live advice inputs (role / gpd / baseline) can be refreshed via {@link updateInputs}.
   */
  async startWatching(inputs: AdviceInputs): Promise<MediaStream> {
    if (this.stream) return this.stream;
    this.watchInputs = inputs;
    this.tracker = null;
    this.watchGen++;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 10 },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('no video track');
    }
    // The user can stop sharing from the browser's own bar; reflect that.
    track.addEventListener('ended', () => {
      this.stopWatching();
      this.onShareEnded?.();
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => {});
    this.stream = stream;
    this.video = video;
    this.watching = true;
    this.warmup();
    void this.watchLoop();
    return stream;
  }

  /** Refresh the advice inputs mid-watch (e.g. the user switched build role or gold bracket). */
  updateInputs(inputs: AdviceInputs) {
    this.watchInputs = inputs;
  }

  stopWatching() {
    this.watching = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.tracker = null;
    this.watchGen++;
  }

  // Only adopt fusion memory from a resolution that still belongs to the current watch session:
  // gen must match watchGen (a stop/restart since this parse was issued invalidates it) and we
  // must still be watching (a manual edit while not watching must not seed the tracker).
  private adoptTracker(gen: number, res: AdvisorResult | null) {
    if (this.watching && gen === this.watchGen && res?.fusion) this.tracker = res.fusion.nextPrior;
  }

  /**
   * Grab the current shared frame and re-parse it right now, bypassing the change-gate. Lets the user
   * force a refresh when the auto-detector didn't notice a subtle in-window change (e.g. one process
   * step barely moved the pixels of a small on-screen window).
   *
   * This cannot reach the watch loop's local spike latch, so a press while a spike is latched may be
   * followed by one redundant auto re-read when the settled-spike fallback matures. Accepted: it is
   * bounded to one (the auto read clears the latch) and fusion absorbs it as a confirmation.
   */
  async reparseNow(): Promise<void> {
    if (!this.stream) return;
    this.onReading?.(true);
    try {
      const bitmap = await this.grabFrame();
      if (!bitmap) return;
      const gen = this.watchGen;
      const res = await this.parseImage(bitmap, this.watchInputs, this.tracker);
      this.adoptTracker(gen, res);
      this.onAdvice?.(res);
    } finally {
      this.onReading?.(false);
    }
  }

  private async grabFrame(): Promise<ImageBitmap | null> {
    if (!this.video || this.video.readyState < 2) return null;
    try {
      return await createImageBitmap(this.video);
    } catch {
      return null;
    }
  }

  // A cheap 96x54 signature of the current frame for change detection.
  private frameSignature(): Uint8ClampedArray | null {
    if (!this.video || this.video.readyState < 2) return null;
    if (!this.sigCanvas) this.sigCanvas = new OffscreenCanvas(96, 54);
    const ctx = this.sigCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0, 96, 54);
    return ctx.getImageData(0, 0, 96, 54).data;
  }
  // Count of pixels whose colour changed "significantly" between two frame signatures. A localized
  // in-window change (a value flips, the 4 outcomes reroll) lights up a cluster of pixels even though
  // it's a tiny fraction of a full-screen share; a MEAN difference dilutes that to nothing, a COUNT
  // does not. The per-pixel threshold ignores compression noise (spread thin, each pixel barely moves).
  private static changedPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >
        45
      )
        n++;
    }
    return n;
  }

  // Stash the exact frame handed to the OCR (captured before it's transferred to the worker) as a PNG
  // on `window.__advisorFrames`, so a misreading live frame can be saved and reproduced offline.
  // Two ways to get one out: the "Save frame" button while watching (`saveFrame()` below), or
  // `__dumpAdvisorFrame()` in the console. This runs on the PARSE path only — once per real state
  // change, not per poll — so the extra draw+encode is negligible next to a multi-second parse.
  private captureDebugFrame(bitmap: ImageBitmap) {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    try {
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0); // read-only draw; does NOT neuter the bitmap before its transfer
      const w = window as unknown as {
        __advisorFrames?: { t: number; url: string }[];
        __dumpAdvisorFrame?: (i?: number) => string;
      };
      if (!w.__advisorFrames) {
        w.__advisorFrames = [];
        w.__dumpAdvisorFrame = (i?: number) => {
          const arr = w.__advisorFrames ?? [];
          const f = arr[i ?? arr.length - 1];
          if (!f?.url) return 'no frames captured yet';
          const a = document.createElement('a');
          a.href = f.url;
          a.download = `advisor-frame-${f.t}.png`;
          a.click();
          return `downloading ${a.download}`;
        };
        if (
          typeof localStorage !== 'undefined' &&
          localStorage.getItem('advisorWatchDebug') === '1'
        )
          console.log(
            '[watch] frame dump armed; run __dumpAdvisorFrame() in the console to save the last parsed frame'
          );
      }
      const arr = w.__advisorFrames;
      const entry: { t: number; url: string } = { t: Date.now(), url: '' };
      arr.push(entry);
      // Blob object URLs (not data URLs) so multi-MB 2K/4K frames download without Chrome silently
      // dropping them; drop the oldest and revoke its URL so the debug ring never leaks memory.
      while (arr.length > 5) {
        const old = arr.shift();
        if (old?.url) URL.revokeObjectURL(old.url);
      }
      c.toBlob((blob) => {
        if (blob) entry.url = URL.createObjectURL(blob);
      }, 'image/png');
    } catch {
      // diagnostic-only; never disturb the parse
    }
  }

  /**
   * Download the most recently parsed frame as a PNG — the exact raster the OCR read, which is what
   * makes it reproducible offline. Returns a short status string for the caller to surface.
   */
  saveFrame(): string {
    if (typeof window === 'undefined') return 'unavailable';
    const w = window as unknown as { __dumpAdvisorFrame?: (i?: number) => string };
    if (!w.__dumpAdvisorFrame) return 'no frame read yet';
    return w.__dumpAdvisorFrame();
  }

  private async watchLoop() {
    const POLL_MS = 300;
    // The thresholds and the parse decision live in watchReadGate (module scope above), so tests can
    // replay real captured motion/content sequences against the exact logic this loop runs.
    // Flip on in the console (`localStorage.advisorWatchDebug = '1'` then reload) to log the live
    // change-detection metrics; used to tune the thresholds against a real screen share.
    const debug =
      typeof localStorage !== 'undefined' && localStorage.getItem('advisorWatchDebug') === '1';
    let prevSig: Uint8ClampedArray | null = null;
    let parsedSig: Uint8ClampedArray | null = null;
    let stableSince = 0;
    let spikeSeen = false;
    let busy = false;
    // Recent motion, oldest first, used to size the spike bar to this screen. Only CALM frames go in:
    // an event's own flash (and the settling frames after it) would otherwise raise the very bar it
    // has to clear, so a run of activity would progressively deafen the detector.
    const ambientWindow: number[] = [];
    while (this.watching) {
      const sig = this.frameSignature();
      if (sig) {
        const motion = prevSig ? AdvisorController.changedPixels(sig, prevSig) : Infinity;
        const spikeBar = spikeBarFor(ambientWindow);
        if (motion > spikeBar) {
          spikeSeen = true; // latch the event; only an actual re-read clears it
          stableSince = Date.now(); // and restart the settle clock so we parse the settled state
        } else if (isFinite(motion)) {
          ambientWindow.push(motion);
          if (ambientWindow.length > SPIKE_WINDOW) ambientWindow.shift();
        }
        const stableFor = Date.now() - stableSince;
        const content = parsedSig ? AdvisorController.changedPixels(sig, parsedSig) : Infinity;
        const firstRead = parsedSig === null;
        const willParse = watchReadGate({ busy, motion, content, stableFor, firstRead, spikeSeen });
        if (debug)
          console.log(
            `[watch] motion=${motion} bar=${spikeBar} content=${content} stableFor=${stableFor} spike=${spikeSeen}${willParse ? ' -> RE-READ' : ''}`
          );
        if (willParse) {
          busy = true;
          parsedSig = sig;
          spikeSeen = false;
          this.onReading?.(true);
          const t0 = Date.now();
          const bitmap = await this.grabFrame();
          if (bitmap) {
            const gen = this.watchGen;
            const res = await this.parseImage(bitmap, this.watchInputs, this.tracker);
            this.adoptTracker(gen, res);
            if (this.watching) this.onAdvice?.(res);
          }
          if (debug) console.log(`[watch] parse+advise took ${Date.now() - t0}ms`);
          this.onReading?.(false);
          busy = false;
          // The parse took seconds, so `sig` is now stale and the next poll's motion would span the
          // whole gap. SPIKE is calibrated for 300ms deltas; ambient drift across a multi-second gap
          // can exceed it, and a falsely latched spike no longer stays inert (the settled-spike
          // fallback would convert it into a redundant parse, recreating the gap, a self-sustaining
          // loop). Resync to a fresh frame, and re-arm the latch only when that frame shows a real
          // mid-parse change against the state just read.
          //
          // That re-arm compares against the ambient bar, NOT the CONTENT bar: a parse takes seconds,
          // so anything the user does during one has to be caught here or not at all, and real events
          // measure 28-51 changed pixels against a CONTENT of 36 — it would miss about half of them.
          // The looser bar can cost one redundant parse when ambient drifts across a long parse, which
          // is now cheap: the state is unchanged, so the DP cache returns the previous answer.
          const fresh = this.frameSignature();
          if (
            fresh &&
            AdvisorController.changedPixels(fresh, parsedSig) > spikeBarFor(ambientWindow)
          ) {
            spikeSeen = true; // a change landed while we were reading; settle, then read it too
            stableSince = Date.now();
          }
          prevSig = fresh ?? sig;
        } else {
          prevSig = sig;
        }
      }
      await AdvisorController.sleep(POLL_MS);
    }
  }
  private static sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  /**
   * Parse one decoded screenshot into a legal game state plus (if baseline/gpd given) the ranked
   * DP advice, or null on failure.
   */
  async parseImage(
    bitmap: ImageBitmap,
    inputs: AdviceInputs = {},
    prior: FusionPrior | null = null
  ): Promise<AdvisorResult | null> {
    try {
      if (!this.worker) this.worker = this.createWorker();
      if (!this.initialized) {
        await new Promise<void>((resolve, reject) => {
          this.awaitInit = { resolve, reject };
          this.worker!.postMessage({ type: 'init' });
        });
      }
      const id = ++this.seq;
      return await new Promise<AdvisorResult | null>((resolve) => {
        this.pending.set(id, resolve);
        this.captureDebugFrame(bitmap); // debug-only: stash the exact frame the OCR is about to read
        this.worker!.postMessage(
          {
            type: 'parse',
            id,
            bitmap,
            baselineGrade: inputs.baselineGrade,
            gpd: inputs.gpd,
            axis: inputs.axis,
            rosterBound: inputs.rosterBound,
            prior,
          },
          [bitmap]
        );
      });
    } catch {
      try {
        bitmap.close();
      } catch {
        // already transferred / closed
      }
      return null;
    }
  }

  /**
   * Re-rank from a manually-entered / corrected state (the dropdown backup on the Processing window).
   * No image: the worker runs the edit through his constraintSnap + DP and returns the snapped state
   * plus fresh advice, exactly as a parse would.
   *
   * `adoptMemory` gates whether this call's fusion result becomes the watch tracker's next prior.
   * constraintSnap treats every field it's handed as authoritative (confidence 1.0), so it must default
   * to false: a market-only re-rank replays the SAME last-seen state (Panel's `lastEdited`) through this
   * path on every gold-bracket / role / baseline change, and adopting that would silently promote all of
   * that frame's sub-0.8 OCR fields to hard memory. Only a genuine user correction should adopt.
   */
  async advise(
    edited: EditedAdvisorState,
    inputs: AdviceInputs = {},
    adoptMemory = false
  ): Promise<AdvisorResult | null> {
    try {
      if (!this.worker) this.worker = this.createWorker();
      if (!this.initialized) {
        await new Promise<void>((resolve, reject) => {
          this.awaitInit = { resolve, reject };
          this.worker!.postMessage({ type: 'init' });
        });
      }
      const id = ++this.seq;
      const gen = this.watchGen;
      const res = await new Promise<AdvisorResult | null>((resolve) => {
        this.pending.set(id, resolve);
        this.worker!.postMessage({
          type: 'advise',
          id,
          config: edited.config,
          state: edited.state,
          outcomes: edited.outcomes,
          rarity: edited.rarity,
          baselineGrade: inputs.baselineGrade,
          gpd: inputs.gpd,
          axis: inputs.axis,
          rosterBound: inputs.rosterBound,
        });
      });
      if (adoptMemory) this.adoptTracker(gen, res);
      return res;
    } catch {
      return null;
    }
  }
}

/**
 * Convert a parse into the edit shape, so a later market-input change can re-advise the same gem.
 *
 * The reroll conversion is the subtle part. `rerollsRemaining` is in MODEL units (free rerolls plus
 * the one paid "Charge" reroll), so the inverse is `model - 1`. Zero is the one value that cannot go
 * back through `rerollsShownFree`, because the snap reads 0 free as "0 free + 1 paid" = 1. A fully
 * spent gem (dimmed grey Charge) must therefore say `rerollsChargeSpent` explicitly, or it grows a
 * phantom reroll on every re-advise and the DP offers a Reroll that the game will not allow.
 */
export function parsedToEdited(p: ParsedAdvisorState): EditedAdvisorState {
  const model = p.state.rerollsRemaining ?? 0;
  return {
    config: { ...p.config },
    state: {
      currentTurn: p.state.currentTurn,
      maxTurns: p.state.maxTurns,
      ...(model <= 0 ? { rerollsChargeSpent: true } : { rerollsShownFree: model - 1 }),
      resetsRemaining: p.state.resetsRemaining,
      processCostMultiplier: p.state.processCostMultiplier ?? 0,
      rosterBound: p.state.rosterBound ?? false,
    },
    outcomes: p.outcomes.map((o) => ({ ...o })),
    rarity:
      p.rarity ?? (p.state.maxTurns <= 5 ? 'uncommon' : p.state.maxTurns <= 7 ? 'rare' : 'epic'),
  };
}

export interface AdviceMargin {
  best: string;
  runnerUp: string;
  /** Gold EV by which the best action beats the runner-up. */
  margin: number;
  /** Plain-English reading of why the winner wins (a summary of the DP numbers, not their source). */
  clause: string;
}
const MARGIN_CLAUSES: Record<string, string> = {
  Process: 'keep processing while the expected gain outweighs the per-turn gold.',
  Reroll: 'reroll while a fresh board is worth more than processing this one.',
  Reset: 'pay for a fresh cut; this board is not worth finishing.',
  Complete: 'stop here; neither processing nor rerolling pays for itself.',
};

/**
 * The margin one-liner under the verdict: best action vs runner-up, from the ranked actions the DP
 * already returned (allActions arrives sorted by value desc; non-finite rows are actions the game
 * state rules out). Null when fewer than two actions are rankable.
 */
export function adviceMargin(advice: AdvisorAdvice | null): AdviceMargin | null {
  const ranked = (advice?.allActions ?? []).filter((a) => isFinite(a.value));
  if (ranked.length < 2) return null;
  const [best, runnerUp] = ranked;
  return {
    best: best.name,
    runnerUp: runnerUp.name,
    margin: best.value - runnerUp.value,
    clause: MARGIN_CLAUSES[best.name] ?? MARGIN_CLAUSES.Complete,
  };
}

/**
 * How many parsed fields the reader was not confident about (confidence below 0.8 — the same bar the
 * Processing window uses to glow a field amber).
 *
 * These are the fields the user is being asked to confirm, so ranking actions off them without
 * saying so presents a guess as a finding. Counts config fields, outcomes, and the processing cost,
 * matching exactly what the window highlights; the remaining state fields are excluded because they
 * have no highlight target there and a count that exceeds what is highlighted looks like a bug.
 *
 * The cost earns its place: when it cannot be read the snap does not leave a hole, it substitutes the
 * 900 base, so an unread cost looks identical to a confident one while every gold figure in the
 * advice is computed from it.
 */
export function countUnconfirmed(parsed: ParsedAdvisorState | undefined): number {
  const cf = parsed?.confidence as
    | {
        config?: Record<string, number>;
        state?: Record<string, number>;
        outcomes?: (number | null)[];
      }
    | undefined;
  if (!cf) return 0;
  let n = 0;
  for (const v of Object.values(cf.config ?? {})) if ((v ?? 1) < 0.8) n++;
  for (const v of cf.outcomes ?? []) if (v != null && v < 0.8) n++;
  if ((cf.state?.processCostMultiplier ?? 1) < 0.8) n++;
  return n;
}
