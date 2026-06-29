import type { ArkGridAttr } from '../constants/enums';
import { type ArkGridGem } from '../models/arkGridGems';
import type { CaptureWorkerRequest, CaptureWorkerResponse, OwnedCount } from './types';

/** What recognizeImage resolves with: the gems plus the footer owned-count checksum. */
export type ImageRecognition = { gemAttr: ArkGridAttr; gems: ArkGridGem[]; owned: OwnedCount | null };

const START_CAPTURE_ERROR_TYPES = [
  'recording',
  'worker-init-failed',
  'screen-permission-denied',
  'unknown',
] as const;

type StartCaptureErrorType = (typeof START_CAPTURE_ERROR_TYPES)[number];

export class CaptureController {
  // localStorage key for the per-resolution UI-scale cache (see scale:measured / scale:drop).
  private static readonly SCALE_CACHE_KEY = 'arkgrid:cv-scale-cache';

  private state: 'idle' | 'loading' | 'recording' | 'closing' = 'idle';

  // Screen recording state
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private track: MediaStreamVideoTrack | null = null;

  // web worker
  private worker: Worker | null = null;
  detectionMargin: number = 0;

  // debug
  private drawDebug: boolean = false;
  private debugCanvas: HTMLCanvasElement | null = null;

  // Resolvers for the promises we're awaiting
  private awaitWorkerInitialization: {
    resolve: () => void;
    reject: (reason: StartCaptureErrorType) => void;
  } | null = null;
  private awaitFrameCompletion: (() => void) | null = null;
  // Resolver for an in-flight recognizeImage() call (static-image upload path).
  private awaitImageCompletion: ((result: ImageRecognition | null) => void) | null = null;
  // True once the worker has reported init:done at least once (warmup or a prior call), so
  // recognizeImage() can skip a redundant re-init when the worker is already warm.
  private workerInitialized = false;

  // Externally registered callbacks
  onFrameDone: ((gemAttr: ArkGridAttr, gems: ArkGridGem[]) => void) | null = null; // analysis done
  onLoad: (() => void) | null = null; // worker ready
  onStartCaptureError: ((err: StartCaptureErrorType) => void) | null = null; // worker failed to start
  onReady: (() => void) | null = null; // first frame consumed
  onStop: (() => void) | null = null; // recording stopped
  onImageProgress: ((fraction: number) => void) | null = null; // 0..1 progress of a recognizeImage() call

  constructor(debugCanvas?: HTMLCanvasElement | null) {
    if (debugCanvas) this.debugCanvas = debugCanvas;
  }

  // type-safe wrapper
  private postMessage(msg: CaptureWorkerRequest) {
    if (!this.worker) throw Error('worker is not set');
    this.worker.postMessage(msg);
  }

  private handleWorkerMessage(e: MessageEvent<CaptureWorkerResponse>) {
    const data = e.data;

    switch (data.type) {
      case 'init:done':
        this.workerInitialized = true;
        this.awaitWorkerInitialization?.resolve();
        this.awaitWorkerInitialization = null;
        const onLoad = this.onLoad;
        if (onLoad) {
          queueMicrotask(() => onLoad());
        }
        break;

      case 'image:progress': {
        const onImageProgress = this.onImageProgress;
        if (onImageProgress) queueMicrotask(() => onImageProgress(data.fraction));
        break;
      }

      case 'image:done':
        // Resolve the pending recognizeImage() promise with the gems + owned-count (or null).
        this.awaitImageCompletion?.(
          data.result
            ? { gemAttr: data.result.gemAttr, gems: data.result.gems, owned: data.result.owned }
            : null
        );
        this.awaitImageCompletion = null;
        break;

      case 'frame:done':
        // release lock
        this.awaitFrameCompletion?.();
        this.awaitFrameCompletion = null;

        // Invoke the externally registered callback

        /*
        Code inside queueMicrotask(() => { ... }):

        Does NOT run now.
        Runs AFTER the current call stack finishes.

        TypeScript's reasoning:

        "There's no guarantee that this.onFrameDone or data.result
        won't change before this callback runs."
        */
        if (this.state === 'recording') {
          // Only invoke onFrameDone while recording
          const result = data.result;
          const onFrameDone = this.onFrameDone;
          if (onFrameDone && result) {
            queueMicrotask(() => {
              onFrameDone(result.gemAttr, result.gems);
            });
          }
        }
        break;

      case 'init:error':
        if (this.awaitWorkerInitialization) {
          this.awaitWorkerInitialization.reject('worker-init-failed');
          this.awaitWorkerInitialization = null;
        }
        break;

      case 'scale:measured':
        // Worker measured a UI scale for a resolution; persist it so future sessions skip the sweep.
        this.writeScaleCache(data.key, data.scale);
        break;

      case 'scale:drop':
        // Worker found a persisted scale no longer locates the anchor; forget it.
        this.dropScaleCache(data.key);
        break;

      case 'debug':
        try {
          if (data.message) console.log(data.message);
          if (data.image && this.debugCanvas) {
            if (this.state == 'recording') {
              this.debugCanvas.width = data.image.width;
              this.debugCanvas.height = data.image.height;
              this.debugCanvas.getContext('2d')?.drawImage(data.image, 0, 0);
            }
          }
        } finally {
          if (data.image) data.image.close();
        }
    }
  }

  private async requestDisplayMedia() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      if (!stream) {
        throw Error('No stream');
      }
      this.track = stream.getVideoTracks()[0];
      if (!this.track) {
        throw Error('No video track');
      }
      const processor = new MediaStreamTrackProcessor({ track: this.track });
      this.reader = processor.readable.getReader();
    } catch (err: any) {
      throw err;
    }
    return;
  }

  isStartCaptureError(err: unknown): err is StartCaptureErrorType {
    // Is the error one of the StartCaptureErrorType values we throw?
    return (
      typeof err === 'string' && START_CAPTURE_ERROR_TYPES.includes(err as StartCaptureErrorType)
    );
  }

  private classifyCaptureError(err: unknown): StartCaptureErrorType {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') {
        return 'screen-permission-denied';
      }
    }

    if (this.isStartCaptureError(err)) {
      return err; // pass it through as-is
    }

    return 'unknown';
  }

  /**
   * Per-resolution UI-scale cache, persisted in localStorage. The worker measures the scale once
   * (the expensive multi-scale sweep) and reports it via `scale:measured`; we store it keyed by
   * "WxH" and feed it back on the next `init` so the first frame can skip the sweep. Best-effort:
   * a storage failure just means we re-measure, never a broken capture.
   */
  private readScaleCache(): Record<string, number> {
    try {
      if (typeof localStorage === 'undefined') return {};
      const raw = localStorage.getItem(CaptureController.SCALE_CACHE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
    } catch {
      return {};
    }
  }

  private writeScaleCache(key: string, scale: number) {
    try {
      if (typeof localStorage === 'undefined') return;
      const cache = this.readScaleCache();
      cache[key] = scale;
      localStorage.setItem(CaptureController.SCALE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // best-effort; persistence is an optimization, never block capture on it.
    }
  }

  private dropScaleCache(key: string) {
    try {
      if (typeof localStorage === 'undefined') return;
      const cache = this.readScaleCache();
      if (key in cache) {
        delete cache[key];
        localStorage.setItem(CaptureController.SCALE_CACHE_KEY, JSON.stringify(cache));
      }
    } catch {
      // best-effort.
    }
  }

  /**
   * Pre-create the worker and kick off the OpenCV WASM download + compile ahead of time, so the
   * first {@link startCapture} doesn't pay the cold ~5s cost on the user's first "Start" click.
   * Desktop-only caller — the 10.8MB CV chunk must never load on mobile. Fire-and-forget and
   * idempotent: {@link startCapture} reuses the already-created worker. The resulting `init:done`
   * is a harmless no-op here (no `awaitWorkerInitialization` is pending and `onLoad` isn't
   * registered until a real capture starts).
   */
  warmup() {
    if (this.worker) return;
    try {
      this.worker = new Worker(new URL('./captureWorker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.postMessage({ type: 'init', scaleHints: this.readScaleCache() });
    } catch {
      // Best-effort; if worker creation fails here, startCapture() will try again normally.
      this.worker = null;
    }
  }

  /**
   * Recognize gems from a single uploaded / pasted / dropped screenshot. Unlike {@link startCapture}
   * this needs NO screen share (no getDisplayMedia / MediaStreamTrackProcessor), so it works on
   * mobile / Safari / Firefox where live capture is unsupported — it only needs the worker plus
   * OpenCV's matFromImageData. The first call lazily creates the worker, which downloads + compiles
   * the ~10.8MB CV WASM chunk. The bitmap is transferred to the worker (which closes it). Resolves
   * with the recognized gems, or null if nothing was recognized or worker init failed.
   */
  async recognizeImage(bitmap: ImageBitmap): Promise<ImageRecognition | null> {
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('./captureWorker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
      }
      if (!this.workerInitialized) {
        const waitForInit = new Promise<void>((resolve, reject) => {
          this.awaitWorkerInitialization = { resolve, reject };
        });
        this.postMessage({ type: 'init', scaleHints: this.readScaleCache() });
        await waitForInit;
      }
      return await new Promise<ImageRecognition | null>((resolve) => {
        this.awaitImageCompletion = resolve;
        this.worker!.postMessage(
          {
            type: 'image',
            bitmap,
            detectionMargin: this.detectionMargin,
          } satisfies CaptureWorkerRequest,
          [bitmap]
        );
      });
    } catch {
      // Init was rejected (worker-init-failed) or worker creation threw — surface as "no result"
      // so the caller can show a friendly message. The bitmap wasn't transferred yet; release it.
      this.awaitImageCompletion = null;
      try {
        bitmap.close();
      } catch {
        // already closed / transferred
      }
      return null;
    }
  }

  async startCapture(deferDisplayRequest: boolean = false) {
    // Only allowed from the idle state.
    // Starts recording.
    // Creates the worker and loads assets, then asks the user to share their screen.
    // Once both complete, starts the loop.

    try {
      if (this.state !== 'idle') {
        throw 'recording' satisfies StartCaptureErrorType;
      }

      // Switch to loading (lock)
      this.state = 'loading';

      // Register the handler after creating the worker
      if (!this.worker) {
        this.worker = new Worker(new URL('./captureWorker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = this.handleWorkerMessage.bind(this);
      }
      // Create a promise that waits for the worker's init, then send the init request
      // (it may be rejected depending on the worker's response!)
      const waitForInit = new Promise<void>((resolve, reject) => {
        this.awaitWorkerInitialization = { resolve, reject };
      });
      this.postMessage({ type: 'init', scaleHints: this.readScaleCache() });

      if (deferDisplayRequest) {
        await waitForInit;
        await this.requestDisplayMedia();
      } else {
        // Request screen sharing from the user while initializing, and wait for both
        await Promise.all([this.requestDisplayMedia(), waitForInit]);
      }

      // Once done, the reader is set up and readable
      if (!this.reader) {
        throw Error('reader is not ready');
      }

      // Wait until the first frame can be read
      const { value, done } = await this.reader.read();
      if (done) {
        throw Error('Failed to read even a frame');
      }
      value?.close();

      // Call onReady once frames are readable and the worker is ready
      const onReady = this.onReady;
      if (onReady) {
        queueMicrotask(() => {
          onReady();
        });
      }

      // Move to the frame capture-and-send loop
      this.state = 'recording';
      this.loop();
    } catch (err) {
      // If an error occurs during init, classify it and call onStartCaptureError
      const classified = this.classifyCaptureError(err);
      this.onStartCaptureError?.(classified);
    } finally {
      // Back to idle if startup failed
      if (this.state == 'loading') {
        this.state = 'idle';
      }
    }
  }

  private async loop() {
    // While recording, read frames from the reader, send them to the worker, and wait for results.
    // loop() is fired without await, so a rejection escaping here would be unhandled: the track
    // would never stop and the state would stick at 'recording' forever. Catch instead and fall
    // through to the same teardown the normal stop path uses.
    try {
      while (this.state == 'recording') {
        if (!this.reader) {
          throw Error('reader not exists');
        }
        let value: VideoFrame | undefined;
        try {
          if (!this.worker) throw Error('worker not exists');
          const result = await this.reader.read();
          value = result.value;
          const done = result.done;
          if (done) break; // break here when the user stops screen sharing
          if (!value) break;

          // Create a promise that resolves when analysis finishes
          const waitForAnalysis = new Promise<void>((resolve) => {
            this.awaitFrameCompletion = resolve;
          });
          // postMessage the current frame
          this.worker.postMessage(
            {
              type: 'frame',
              frame: value,
              drawDebug: this.drawDebug,
              detectionMargin: this.detectionMargin,
            } satisfies CaptureWorkerRequest,
            [value]
          );
          value = undefined;
          // Note: ownership of value was transferred to the worker, so set it to undefined to avoid touching it
          await waitForAnalysis;
        } finally {
          // If for some reason ownership of value wasn't transferred, close it here in the controller
          value?.close();
        }
      }
    } catch (err) {
      console.error('[capture] loop aborted, tearing down:', err);
    }
    // Once the loop exits, set state to idle
    this.track?.stop();
    this.track = null;
    const onStop = this.onStop;
    if (onStop) {
      queueMicrotask(() => {
        onStop();
      });
    }
    this.state = 'idle';
  }

  async stopCapture() {
    // Promises like read or waitForAnalysis in the loop above can't be cancelled,
    // so ideally we'd race each promise against a cancellation-signal promise from the start.
    // (If the cancellation promise rejects first, the original isn't awaited and bails out, achieving cancellation.)
    // That felt too verbose, so we just end the loop instead...
    if (this.state === 'recording') {
      this.state = 'closing'; // expect to reach idle later, after the loop exits
    }
  }
  isRecording() {
    return this.state == 'recording';
  }
  toggleDrawDebug() {
    this.drawDebug = !this.drawDebug;
    return this.drawDebug;
  }
}
