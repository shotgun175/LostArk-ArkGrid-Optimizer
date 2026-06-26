import type { CV } from '@techstark/opencv-js';

import type { GemRecognitionLocale } from '../constants/enums';
import { getCv, initOpenCv } from './cvRuntime';
import { loadGemAsset } from './matStore';
import { multiScaleAnchorMatch } from './matcher';
import { type RecognizeResult, extractNineGems, findBest, recognizeGems } from './recognize';
import { buildScaleLadder, rawScaleToResolutionScale, snapResolutionScale } from './scaleDetection';
import type { CaptureWorkerRequest, CaptureWorkerResponse, CvMat } from './types';

class FrameProcessor {
  // init
  private loadedAsset: Awaited<ReturnType<typeof loadGemAsset>> | null = null;
  private initPromise: Promise<void> | null = null;

  // debug
  debugCanvas: OffscreenCanvas = new OffscreenCanvas(0, 0);
  private frameTimes: number[] = [];

  // frame
  private canvas: OffscreenCanvas = new OffscreenCanvas(0, 0);
  private ctx: OffscreenCanvasRenderingContext2D;
  private cv: CV | null = null;
  private previousInfo: {
    locale: GemRecognitionLocale;
    anchorLoc: { x: number; y: number };
    resolutionScale: number;
  } | null = null;
  // The measured UI scale is fixed for a whole screen-share session (the captured surface can't
  // change resolution mid-session). Cache it independently of previousInfo so that losing the
  // anchor for a frame (Order<->Chaos switch, fast scroll) does NOT re-trigger the expensive
  // multi-scale sweep — we just re-find the anchor LOCATION at the already-known scale.
  private cachedResolutionScale: number | null = null;
  // Per-resolution UI scales measured in earlier sessions (persisted on the main thread, seeded via
  // `init`). A hit lets the first frame skip the expensive multi-scale sweep — the single biggest
  // first-capture cost — and reuse the known scale instead.
  private scaleHints = new Map<string, number>();
  // Consecutive frames the persisted scale failed to find the anchor. A lone miss is usually a
  // startup/black frame before the gem screen is up; only abandon the hint after a sustained streak
  // (which also recovers from a genuinely stale scale after an in-game UI-scale change).
  private hintMissStreak = 0;
  private static readonly HINT_MISS_LIMIT = 20;
  private thresholdSet = {
    anchor: 0.95,
    gemAttr: 0.8,
    gemImage: 0.8,
    willPower: 0.8,
    corePoint: 0.8,
    optionName: 0.8,
    optionLevel: 0.8,
  };
  // Candidate UI-scale factors (on-screen anchor size / FHD template size).
  // ~0.5x covers small windows; ~2x covers 4K. Refined from real samples.
  private anchorScaleLadder = buildScaleLadder(0.5, 2.5, 0.05);
  constructor() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context not available!');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  async init() {
    if (this.initPromise) {
      return this.initPromise;
    }
    // Q. What if two flows reach here at the same time?
    // A. JS/Worker is single-threaded, and the synchronous code before the
    //    first await runs atomically without being interrupted.
    this.initPromise = (async () => {
      await initOpenCv();
      this.cv = getCv();
      if (!this.loadedAsset) {
        this.loadedAsset = await loadGemAsset();
      }
      this.warmUpCv();
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  resetDetection() {
    // Clear the cached anchor LOCATION so the next frame re-finds it (e.g. after the on-screen
    // view changes). The measured resolution scale is preserved (cachedResolutionScale) — it
    // doesn't change mid-session, so we never re-pay the multi-scale sweep just to re-lock.
    this.previousInfo = null;
  }

  resetSession() {
    // Full reset for a NEW screen-share session: also forget the measured scale, so a freshly
    // shared window (possibly a different resolution) gets re-measured once.
    this.previousInfo = null;
    this.cachedResolutionScale = null;
    this.hintMissStreak = 0;
  }

  setScaleHints(hints: Record<string, number>) {
    // Seed/replace the per-resolution scale hints from the persisted cache (sent on every init).
    // NOT cleared by resetSession — a measured UI scale stays valid across screen-share sessions.
    this.scaleHints = new Map(Object.entries(hints));
  }

  // Run the hot OpenCV ops once on tiny dummy mats so their WASM code is JIT-compiled before the
  // first real frame. Without this the first-frame anchor sweep runs on cold WASM and takes
  // seconds; the original base felt instant because its first frame did almost no OpenCV work.
  private warmUpCv() {
    const cv = this.cv;
    if (!cv) return;
    try {
      const img = new cv.Mat(64, 64, cv.CV_8UC1);
      const tpl = new cv.Mat(16, 16, cv.CV_8UC1);
      const res = new cv.Mat();
      const resized = new cv.Mat();
      cv.matchTemplate(img, tpl, res, cv.TM_CCOEFF_NORMED);
      (cv.minMaxLoc as unknown as (m: CvMat) => unknown)(res);
      cv.resize(img, resized, new cv.Size(32, 32), 0, 0, cv.INTER_AREA);
      img.delete();
      tpl.delete();
      res.delete();
      resized.delete();
    } catch {
      // best-effort JIT warm-up; never block init on it.
    }
  }

  // Decode any CanvasImageSource (live VideoFrame or uploaded ImageBitmap) ONCE at native size
  // into a grayscale Mat — the only source-specific step; everything downstream operates on Mats.
  private decodeToGray(source: CanvasImageSource, srcWidth: number, srcHeight: number): CvMat {
    if (!this.cv) throw Error('cv is not ready');
    const canvas = this.canvas;
    const ctx = this.ctx;
    canvas.width = srcWidth;
    canvas.height = srcHeight;
    ctx.drawImage(source, 0, 0, srcWidth, srcHeight);
    const rawImageData = ctx.getImageData(0, 0, srcWidth, srcHeight);
    const gray = this.cv.matFromImageData(rawImageData);
    this.cv.cvtColor(gray, gray, this.cv.COLOR_RGBA2GRAY);
    return gray;
  }

  processFrame(frame: VideoFrame, drawDebug: boolean = false, detectionMargin: number = 0) {
    const start = performance.now();
    const canvas = this.canvas;
    let resizedFrame: CvMat | null = null;
    let rawGray: CvMat | null = null;
    let debugCtx: OffscreenCanvasRenderingContext2D | null = null;
    const cv = this.cv;
    if (!cv) return;

    try {
      if (!this.loadedAsset) return;

      // Decode the raw frame ONCE at native size into a grayscale Mat.
      rawGray = this.decodeToGray(frame, frame.displayWidth, frame.displayHeight);

      // Determine the UI scale: reuse the cached/persisted scale, else measure it once by
      // multi-scale matching the anchor over the full raw frame.
      const resKey = `${frame.displayWidth}x${frame.displayHeight}`;
      let resolutionScale: number;
      let usingHint = false;
      if (this.previousInfo) {
        resolutionScale = this.previousInfo.resolutionScale;
      } else if (this.cachedResolutionScale !== null) {
        // Re-lock path: the anchor was lost for a frame but the resolution is unchanged, so reuse
        // the scale we already measured and skip the multi-scale sweep. The anchor LOCATION is
        // re-found cheaply below (full-frame single-scale match at this scale).
        resolutionScale = this.cachedResolutionScale;
      } else if (this.scaleHints.has(resKey)) {
        // Persisted fast path: a previous session already measured the UI scale for this exact
        // resolution. Reuse it and skip the ~5s multi-scale sweep entirely. The anchor find below
        // verifies it; if it fails (user changed UI scale / window mode) we drop it and re-measure.
        resolutionScale = this.scaleHints.get(resKey)!;
        usingHint = true;
      } else {
        const measured = multiScaleAnchorMatch(
          cv,
          rawGray,
          this.loadedAsset.atlasAnchor,
          this.anchorScaleLadder
        );
        if (!measured || measured.score < this.thresholdSet.anchor - detectionMargin) {
          // No anchor found. When debugging, still show the shared frame so the user can
          // see what was captured (and so the debug-image transfer has a drawn context).
          if (drawDebug) {
            this.debugCanvas.width = frame.displayWidth;
            this.debugCanvas.height = frame.displayHeight;
            this.debugCanvas
              .getContext('2d')
              ?.drawImage(frame, 0, 0, this.debugCanvas.width, this.debugCanvas.height);
          }
          rawGray.delete();
          rawGray = null;
          this.previousInfo = null;
          return;
        }
        // Snap to a canonical resolution tier when close: the anchor's correlation peak is
        // ~1-2% biased by font rendering, and that error compounds with anchor-relative
        // distance and breaks the small gem-row templates (verified on real QHD frames).
        resolutionScale = snapResolutionScale(rawScaleToResolutionScale(measured.scale));
        // Measured once for this session; every later re-lock reuses it (branch above).
        this.cachedResolutionScale = resolutionScale;
        // Persist it (via the main thread) so future sessions at this resolution skip the sweep.
        this.scaleHints.set(resKey, resolutionScale);
        postToMain({ type: 'scale:measured', key: resKey, scale: resolutionScale });
      }

      // Normalize the frame to FHD scale so the existing offsets/templates line up.
      resizedFrame = new cv.Mat();
      cv.resize(
        rawGray,
        resizedFrame,
        new cv.Size(
          Math.round(rawGray.cols * resolutionScale),
          Math.round(rawGray.rows * resolutionScale)
        ),
        0,
        0,
        cv.INTER_AREA
      );
      rawGray.delete();
      rawGray = null;
      canvas.width = resizedFrame.cols;
      canvas.height = resizedFrame.rows;

      if (resolutionScale !== 1) {
        // Add extra margin when we resample on our own
        detectionMargin += 0.1;
      }

      if (drawDebug) {
        this.debugCanvas.width = resizedFrame.cols;
        this.debugCanvas.height = resizedFrame.rows;

        debugCtx = this.debugCanvas.getContext('2d');
        if (debugCtx) {
          debugCtx?.drawImage(frame, 0, 0, this.debugCanvas.width, this.debugCanvas.height);
          debugCtx.font = `40px Arial`;
          debugCtx.fillStyle = 'white';
          debugCtx.strokeStyle = 'black'; // outline color
          debugCtx.lineWidth = 10 * resolutionScale; // outline thickness
          const x = 25;
          let y = 100;
          // Draw the outline first, then fill in white text
          let msg = `Measured scale: ${(1 / resolutionScale).toFixed(2)}x (${frame.displayWidth}x${frame.displayHeight})`;
          debugCtx.strokeText(msg, x, y);
          debugCtx.fillText(msg, x, y);
          y += 40;

          msg = `FPS: ${(1000 / (this.frameTimes.reduce((acc, v) => acc + v, 0) / this.frameTimes.length)).toFixed(2)}`;
          debugCtx.strokeText(msg, x, y);
          debugCtx.fillText(msg, x, y);
          y += 40;

          debugCtx.font = '20px Arial';
          msg = 'OpenCV Matching Threshold';
          debugCtx.strokeText(msg, x, y);
          debugCtx.fillText(msg, x, y);
          y += 20;
          for (const [key, value] of Object.entries(this.thresholdSet)) {
            const msg = `${key}: ${(value - detectionMargin).toFixed(2)}`;
            debugCtx.strokeText(msg, x, y);
            debugCtx.fillText(msg, x, y);
            y += 20;
          }
        }
      }

      // 1. Find the anchor in the normalized (FHD-scale) frame.
      //    First detection: search the FULL frame (handles ultrawide / windowed offsets).
      //    Cached: search only the small ROI around the last anchor position.
      const roiAnchor = this.previousInfo
        ? {
            x: this.previousInfo.anchorLoc.x,
            y: this.previousInfo.anchorLoc.y,
            width: this.loadedAsset.atlasAnchor.entries[this.previousInfo.locale].width,
            height: this.loadedAsset.atlasAnchor.entries[this.previousInfo.locale].height,
          }
        : { x: 0, y: 0, width: canvas.width, height: canvas.height };
      const anchor = findBest(
        cv,
        {
          roi: roiAnchor,
          atlas: this.loadedAsset.atlasAnchor,
          threshold: this.thresholdSet.anchor - detectionMargin,
        },
        resizedFrame,
        debugCtx
      );
      if (!anchor) {
        // Not found: reset so the next frame searches again
        this.previousInfo = null;
        if (usingHint && ++this.hintMissStreak >= FrameProcessor.HINT_MISS_LIMIT) {
          // The persisted scale has failed to locate the anchor for too many frames — it's stale
          // (UI scale / window mode changed), not just a startup/black frame. Forget it locally +
          // on disk so the next frame falls back to a fresh multi-scale measurement.
          this.scaleHints.delete(resKey);
          this.cachedResolutionScale = null;
          this.hintMissStreak = 0;
          postToMain({ type: 'scale:drop', key: resKey });
        }
        return;
      } else {
        // Found: record it (also caching the measured scale)
        this.previousInfo = {
          locale: anchor.key,
          anchorLoc: {
            x: anchor.loc.x,
            y: anchor.loc.y,
          },
          resolutionScale,
        };
        if (usingHint) {
          // Persisted scale confirmed — promote it to the session cache so mid-session re-locks
          // (Order<->Chaos switch, fast scroll) reuse it without re-measuring; clear the streak.
          this.cachedResolutionScale = resolutionScale;
          this.hintMissStreak = 0;
        }
      }

      const currentLocale = this.previousInfo.locale;
      const anchorX = this.previousInfo.anchorLoc.x;
      const anchorY = this.previousInfo.anchorLoc.y;

      //2 Search for the Order or Chaos label
      const gemAttr = findBest(
        cv,
        {
          roi: { x: anchorX - 186, y: anchorY + 91, width: 224, height: 32 },
          atlas: this.loadedAsset.atlasGemAttr[currentLocale],
          threshold: this.thresholdSet.gemAttr - detectionMargin,
        },
        resizedFrame,
        debugCtx
      );
      if (!gemAttr) return;

      // 5. Find the 9 gems and do image matching (shared with the static-image path).
      const currentGems = extractNineGems(
        cv,
        resizedFrame,
        this.loadedAsset,
        currentLocale,
        gemAttr.key,
        anchorX,
        anchorY,
        this.thresholdSet,
        detectionMargin,
        debugCtx
      );
      return { locale: currentLocale, gemAttr: gemAttr.key, gems: currentGems };
    } finally {
      // OpenCV.js Mats are WASM-heap allocations that are never GC'd; an
      // exception between creation and the happy-path deletes above would
      // leak them without this (rawGray is null on every non-throw path).
      if (rawGray) rawGray.delete();
      if (resizedFrame) resizedFrame.delete();
      frame.close();
      this.frameTimes.push(performance.now() - start);
      if (this.frameTimes.length > 10) this.frameTimes.shift();
    }
  }

  // Recognize gems from a single uploaded/pasted screenshot. Each image is independent, so this
  // forgets any cached anchor location / measured scale from a prior live session and runs a fresh
  // full-frame multi-scale search via the shared recognize.ts core (the exact path the accuracy
  // harness tests). Closes the bitmap.
  processImage(bitmap: ImageBitmap, detectionMargin: number = 0): RecognizeResult | undefined {
    const cv = this.cv;
    this.previousInfo = null;
    this.cachedResolutionScale = null;
    let gray: CvMat | null = null;
    try {
      if (!cv || !this.loadedAsset) return undefined;
      gray = this.decodeToGray(bitmap, bitmap.width, bitmap.height);
      const result = recognizeGems(cv, gray, this.loadedAsset, {
        thresholds: this.thresholdSet,
        anchorScaleLadder: this.anchorScaleLadder,
        detectionMargin,
      });
      return result ?? undefined;
    } finally {
      if (gray) gray.delete();
      bitmap.close();
    }
  }
}

function postToMain(msg: CaptureWorkerResponse) {
  self.postMessage(msg);
}
const processor = new FrameProcessor(); // singleton

self.onmessage = async (e: MessageEvent<CaptureWorkerRequest>) => {
  const data = e.data;
  switch (data.type) {
    case 'init':
      // Init request. The worker is re-used across sessions, so forget the previously measured
      // scale here — a new share may be a different-resolution window. Persisted per-resolution
      // scales (sent from the main thread) are seeded so the first frame can skip the sweep.
      processor.resetSession();
      if (data.scaleHints) processor.setScaleHints(data.scaleHints);
      try {
        await processor.init();
        postToMain({ type: 'init:done' });
      } catch {
        postToMain({ type: 'init:error' });
      }
      break;

    case 'reset':
      processor.resetDetection();
      break;

    case 'frame':
      // Frame analysis request
      const result = processor.processFrame(data.frame, data.drawDebug, data.detectionMargin);
      postToMain({
        type: 'frame:done',
        result,
      });
      if (data.drawDebug) {
        postToMain({
          type: 'debug',
          image: processor.debugCanvas.transferToImageBitmap(),
        });
      }
      break;

    case 'image':
      // Static-image (upload/paste) recognition request — independent of the live frame loop.
      postToMain({
        type: 'image:done',
        result: processor.processImage(data.bitmap, data.detectionMargin),
      });
      break;
  }
};
