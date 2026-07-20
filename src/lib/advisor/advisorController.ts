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

export class AdvisorController {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, (r: ParsedAdvisorState | null) => void>();
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
        cb(d.error ? null : (d.result as ParsedAdvisorState));
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

  /** Parse one decoded screenshot into a legal game state, or null on failure. */
  async parseImage(bitmap: ImageBitmap): Promise<ParsedAdvisorState | null> {
    try {
      if (!this.worker) this.worker = this.createWorker();
      if (!this.initialized) {
        await new Promise<void>((resolve, reject) => {
          this.awaitInit = { resolve, reject };
          this.worker!.postMessage({ type: 'init' });
        });
      }
      const id = ++this.seq;
      return await new Promise<ParsedAdvisorState | null>((resolve) => {
        this.pending.set(id, resolve);
        this.worker!.postMessage({ type: 'parse', id, bitmap }, [bitmap]);
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
