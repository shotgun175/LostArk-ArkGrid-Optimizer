// AdvisorController — the Cut Advisor twin of cv/captureController. Owns one advisorWorker, manages
// init, and exposes a single-image parse (upload / paste / one screen-share frame). The parser stack
// lives entirely in the worker; this class is the main-thread message shell with a worker-crash
// backstop, mirroring CaptureController and SolverController.
export interface ParsedAdvisorState {
  config: {
    baseCost: number;
    gemType: string;
    willpowerLevel: number;
    orderLevel: number;
    effect1: string;
    effect1Level: number;
    effect2: string;
    effect2Level: number;
  };
  state: {
    currentTurn: number;
    maxTurns: number;
    rerollsRemaining: number;
    processCostMultiplier: number;
    rosterBound: boolean;
  };
  outcomes: { type: string; target?: string; amount?: number }[];
  confidence?: unknown;
  ocrDegraded?: boolean;
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

  private async grabFrame(): Promise<ImageBitmap | null> {
    if (!this.video || this.video.readyState < 2) return null;
    try {
      return await createImageBitmap(this.video);
    } catch {
      return null;
    }
  }

  // A cheap 48x27 signature of the current frame for change detection.
  private frameSignature(): Uint8ClampedArray | null {
    if (!this.video || this.video.readyState < 2) return null;
    if (!this.sigCanvas) this.sigCanvas = new OffscreenCanvas(48, 27);
    const ctx = this.sigCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(this.video, 0, 0, 48, 27);
    return ctx.getImageData(0, 0, 48, 27).data;
  }
  // Mean per-channel absolute difference (0..255) between two RGBA signatures.
  private static sigDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) {
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    }
    return s / (a.length * 0.75);
  }

  private async watchLoop() {
    const POLL_MS = 400;
    const STABLE_MS = 700; // the frame must hold still this long before we spend a parse
    const CHANGE = 6; // mean per-channel abs diff that counts as "the screen moved"
    let prevSig: Uint8ClampedArray | null = null;
    let parsedSig: Uint8ClampedArray | null = null;
    let stableSince = 0;
    let busy = false;
    while (this.watching) {
      const sig = this.frameSignature();
      if (sig) {
        if (prevSig === null || AdvisorController.sigDiff(sig, prevSig) > CHANGE) {
          stableSince = Date.now(); // moving (or first frame): restart the stability clock
        }
        const stableFor = Date.now() - stableSince;
        const differsFromParsed = !parsedSig || AdvisorController.sigDiff(sig, parsedSig) > CHANGE;
        if (!busy && stableFor >= STABLE_MS && differsFromParsed) {
          busy = true;
          parsedSig = sig;
          const bitmap = await this.grabFrame();
          if (bitmap) {
            const res = await this.parseImage(bitmap, this.watchInputs);
            if (this.watching) this.onAdvice?.(res);
          }
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
}
