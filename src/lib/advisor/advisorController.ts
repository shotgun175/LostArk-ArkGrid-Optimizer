// AdvisorController — the Cut Advisor twin of cv/captureController. Owns one advisorWorker, manages
// init, and exposes a single-image parse (upload / paste / one screen-share frame). The parser stack
// lives entirely in the worker; this class is the main-thread message shell with a worker-crash
// backstop, mirroring CaptureController and SolverController.
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
   * predictor of read quality: the same client measures 97.7% of fields correct at ~925px and 95.5%
   * at ~677px, because Force 21:9 letterboxes the UI and shrinks every glyph with it.
   */
  panelWidth?: number;
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
export interface AdvisorAdvice {
  bestAction: string; // lowercased winning action
  allActions: AdvisorAction[];
  currentValue: number;
  resetCost: number | null;
}
export interface AdvisorResult {
  parsed: ParsedAdvisorState;
  advice: AdvisorAdvice | null; // null when no baseline/gpd was supplied
}
export interface AdviceInputs {
  baselineGrade?: number; // 0-100 grade; the worker converts to the DP's gemValue threshold
  gpd?: number; // gold per 1% damage
  axis?: 'dps' | 'support';
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
    if (d.type === 'parse:done') {
      const cb = this.pending.get(d.id);
      if (cb) {
        this.pending.delete(d.id);
        cb(
          d.error
            ? null
            : { parsed: d.result as ParsedAdvisorState, advice: (d.advice ?? null) as AdvisorAdvice | null }
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
  private sigCanvas: OffscreenCanvas | null = null;
  onAdvice: ((r: AdvisorResult | null) => void) | null = null;
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
  }

  /**
   * Grab the current shared frame and re-parse it right now, bypassing the change-gate. Lets the user
   * force a refresh when the auto-detector didn't notice a subtle in-window change (e.g. one process
   * step barely moved the pixels of a small on-screen window).
   */
  async reparseNow(): Promise<void> {
    if (!this.stream) return;
    this.onReading?.(true);
    try {
      const bitmap = await this.grabFrame();
      if (!bitmap) return;
      const res = await this.parseImage(bitmap, this.watchInputs);
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
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 45) n++;
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
        if (typeof localStorage !== 'undefined' && localStorage.getItem('advisorWatchDebug') === '1')
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
    // parses; the manual "Re-read now" button covers any atypically small change.
    const SPIKE = 40; // changed pixels vs the previous frame above this = a real in-window event
    const CONTENT = 36; // changed pixels vs the last read above this = the gem state actually changed
    // Flip on in the console (`localStorage.advisorWatchDebug = '1'` then reload) to log the live
    // change-detection metrics; used to tune the thresholds against a real screen share.
    const debug =
      typeof localStorage !== 'undefined' && localStorage.getItem('advisorWatchDebug') === '1';
    let prevSig: Uint8ClampedArray | null = null;
    let parsedSig: Uint8ClampedArray | null = null;
    let stableSince = 0;
    let spikeSeen = false;
    let busy = false;
    while (this.watching) {
      const sig = this.frameSignature();
      if (sig) {
        const motion = prevSig ? AdvisorController.changedPixels(sig, prevSig) : Infinity;
        if (motion > SPIKE) {
          spikeSeen = true; // latch the event; only an actual re-read clears it
          stableSince = Date.now(); // and restart the settle clock so we parse the settled state
        }
        const stableFor = Date.now() - stableSince;
        const content = parsedSig ? AdvisorController.changedPixels(sig, parsedSig) : Infinity;
        const firstRead = parsedSig === null;
        const willParse =
          !busy &&
          motion <= QUIET && // parse only a calm frame, never one still settling
          stableFor >= STABLE_MS &&
          (firstRead || (spikeSeen && content > CONTENT));
        if (debug)
          console.log(
            `[watch] motion=${motion} content=${content} stableFor=${stableFor} spike=${spikeSeen}${willParse ? ' -> RE-READ' : ''}`
          );
        if (willParse) {
          busy = true;
          parsedSig = sig;
          spikeSeen = false;
          this.onReading?.(true);
          const t0 = Date.now();
          const bitmap = await this.grabFrame();
          if (bitmap) {
            const res = await this.parseImage(bitmap, this.watchInputs);
            if (this.watching) this.onAdvice?.(res);
          }
          if (debug) console.log(`[watch] parse+advise took ${Date.now() - t0}ms`);
          this.onReading?.(false);
          busy = false;
        }
        prevSig = sig;
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
  async parseImage(bitmap: ImageBitmap, inputs: AdviceInputs = {}): Promise<AdvisorResult | null> {
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
          { type: 'parse', id, bitmap, baselineGrade: inputs.baselineGrade, gpd: inputs.gpd, axis: inputs.axis },
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
   */
  async advise(edited: EditedAdvisorState, inputs: AdviceInputs = {}): Promise<AdvisorResult | null> {
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
        });
      });
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
    rarity: p.rarity ?? (p.state.maxTurns <= 5 ? 'uncommon' : p.state.maxTurns <= 7 ? 'rare' : 'epic'),
  };
}

/**
 * How many parsed fields the reader was not confident about (confidence below 0.8 — the same bar the
 * Processing window uses to glow a field amber).
 *
 * These are the fields the user is being asked to confirm, so ranking actions off them without
 * saying so presents a guess as a finding. Counts config fields and outcomes, matching what the
 * window actually highlights; state fields are excluded because they are not highlighted there and a
 * mismatched count would just look like a bug.
 */
export function countUnconfirmed(parsed: ParsedAdvisorState | undefined): number {
  const cf = parsed?.confidence as
    | { config?: Record<string, number>; outcomes?: (number | null)[] }
    | undefined;
  if (!cf) return 0;
  let n = 0;
  for (const v of Object.values(cf.config ?? {})) if ((v ?? 1) < 0.8) n++;
  for (const v of cf.outcomes ?? []) if (v != null && v < 0.8) n++;
  return n;
}
