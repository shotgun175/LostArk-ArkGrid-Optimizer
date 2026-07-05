import type { CV } from '@techstark/opencv-js';

import type { GemRecognitionLocale } from '../constants/enums';
import { getCv, initOpenCv } from './cvRuntime';
import { multiScaleAnchorMatch } from './matcher';
import { loadGemAsset } from './matStore';
import {
  type RecognizeResult,
  type ScaledFieldAtlases,
  buildScaledFieldAtlases,
  deriveAttr,
  disposeScaledFieldAtlases,
  extractNineGems,
  findBest,
  scaleFromPitch,
} from './recognize';
import { findIconRows, recognizeGemsOcr, type OcrResult, type OcrRunner } from './recognizeOcr';
import { buildScaleLadder } from './scaleDetection';
import type { CaptureWorkerRequest, CaptureWorkerResponse, CvMat } from './types';

/**
 * Lazy tesseract.js wrapper for the client-agnostic upload OCR path. tesseract (wasm core + English
 * data, multi-MB) loads only on the FIRST image recognition, then one worker is reused across the
 * ~30 column/cell OCR calls per image. Each cv.Mat is rendered to ImageData for tesseract.
 */
class BrowserOcrRunner implements OcrRunner {
  private worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | null = null;
  private psmMap: Record<number, unknown> = {};
  private initPromise: Promise<void> | null = null;
  // Set per-call so the worker's recognition logger can drive a determinate progress bar for the slow
  // block reads (effect names, footer); the fast single-char digit reads report per-component instead.
  private onProgress: ((fraction: number) => void) | null = null;

  private async ensure(): Promise<void> {
    if (this.worker) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const T = await import('tesseract.js');
        this.psmMap = { 6: T.PSM.SINGLE_BLOCK, 7: T.PSM.SINGLE_LINE, 10: T.PSM.SINGLE_CHAR };
        this.worker = await T.createWorker('eng', 1, {
          logger: (m: { status?: string; progress?: number }) => {
            if (m.status === 'recognizing text' && typeof m.progress === 'number') this.onProgress?.(m.progress);
          },
        });
      })();
    }
    await this.initPromise;
  }

  async recognizeMat(
    mat: CvMat,
    opts: { psm: number; whitelist?: string; onProgress?: (fraction: number) => void }
  ): Promise<OcrResult> {
    await this.ensure();
    this.onProgress = opts.onProgress ?? null;
    const cv = getCv();
    await this.worker!.setParameters({
      tessedit_pageseg_mode: (this.psmMap[opts.psm] ?? this.psmMap[6]) as never,
      tessedit_char_whitelist: opts.whitelist ?? '',
    });
    const rgba = new cv.Mat();
    cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA);
    const imgData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
    rgba.delete();
    // tesseract.js won't read a raw ImageData; hand it an OffscreenCanvas (supported in workers).
    const canvas = new OffscreenCanvas(imgData.width, imgData.height);
    canvas.getContext('2d')!.putImageData(imgData, 0, 0);
    const { data } = await this.worker!.recognize(canvas, {}, { blocks: true });
    this.onProgress = null;
    const lines: OcrResult['lines'] = [];
    for (const b of (data.blocks ?? []) as Array<{ paragraphs?: Array<{ lines?: Array<{ text: string; bbox: { y0: number; y1: number } }> }> }>)
      for (const p of b.paragraphs ?? [])
        for (const l of p.lines ?? []) lines.push({ text: String(l.text).trim(), cy: (l.bbox.y0 + l.bbox.y1) / 2 });
    return { text: String(data.text).trim(), lines };
  }
}

class FrameProcessor {
  // init
  private loadedAsset: Awaited<ReturnType<typeof loadGemAsset>> | null = null;
  private initPromise: Promise<void> | null = null;
  // Lazy OCR engine for the upload path (created on first uploaded image; live path never uses it).
  private ocrRunner: BrowserOcrRunner | null = null;

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
  } | null = null;
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

  // Live recognition mode, resolved ONCE per screen-share session (it can't change resolution mid-
  // stream): 'standard' = the fast height-tier + header-anchor path (16:9 / UWFHD / QHD / UHD);
  // 'nonstandard' = the icon-seed path for forced-21:9 / windowed clients whose header and gem-LIST
  // scales diverge so no single resample normalises both. null = still classifying.
  private liveMode: 'standard' | 'nonstandard' | null = null;
  // Non-standard session cache (measured once, reused per frame so the hot loop SKIPS the expensive
  // multi-scale icon sweep). nsScale = measured on-screen UI scale g; nsColX / nsRow0Y = the gem-icon
  // column x + row-0 icon-top y (native px); nsScaledAtlases = the five field atlases pre-scaled to g
  // ONCE (so the per-frame read never rescales templates). All null until calibrated.
  private nsScale: number | null = null;
  private nsColX: number | null = null;
  private nsRow0Y: number | null = null;
  // Measured on-screen row pitch (px). The icon-row PITCH and the field-offset scale `g` differ ~1-2%
  // at forced-21:9 (pitch g≈1.0, fields g≈1.015), so the per-frame re-lock must snap rows by this
  // MEASURED pitch — snapping by 63*g instead drifts row-0 by which row matched and drops rows.
  private nsPitch: number | null = null;
  private nsScaledAtlases: ScaledFieldAtlases | null = null;
  private nsRelockMiss = 0; // consecutive fast-pass re-lock misses (panel moved/closed)
  private nsEmptyStreak = 0; // consecutive frames the strip RE-LOCKED but read no gems (stale geometry)
  private nullStdFails = 0; // consecutive unclassified frames where the standard path read no gems
  private lastNsHeavyAt = 0; // throttle for the expensive ops (calibration sweep, full-frame re-acquire)
  private nsLocale: GemRecognitionLocale = 'en_us'; // live template path is en_us (icons are language-agnostic)
  private static readonly NS_HEAVY_INTERVAL_MS = 1000;
  private static readonly NS_RELOCK_REACQUIRE = 6; // strip-miss streak before a (throttled) full re-acquire
  private static readonly NS_EMPTY_REACQUIRE = 8; // locked-but-empty streak before forcing a re-acquire
  private static readonly STANDARD_PRIORITY_FRAMES = 5; // standard gets this many tries before non-standard is attempted

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
    // Clear the cached anchor LOCATION so the next frame re-finds it (e.g. after the on-screen view
    // changes). Keep the session's classification + measured non-standard scale/atlases (the resolution
    // is unchanged); only the icon-column LOCK is dropped so the next frame re-acquires it.
    this.previousInfo = null;
    this.nsColX = null;
    this.nsRow0Y = null;
    this.nsRelockMiss = 0;
    this.nsEmptyStreak = 0;
  }

  resetSession() {
    // Full reset for a NEW screen-share session: a freshly shared window may be a different resolution
    // / aspect, so forget the cached anchor location, the live-mode classification, and the measured
    // non-standard scale + pre-scaled atlases (disposing the WASM Mats so they don't leak).
    this.previousInfo = null;
    this.liveMode = null;
    this.nsScale = null;
    this.nsColX = null;
    this.nsRow0Y = null;
    this.nsPitch = null;
    this.nsRelockMiss = 0;
    this.nsEmptyStreak = 0;
    this.nullStdFails = 0;
    this.lastNsHeavyAt = 0;
    if (this.nsScaledAtlases) {
      disposeScaledFieldAtlases(this.nsScaledAtlases);
      this.nsScaledAtlases = null;
    }
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

  // Derive the frame resample factor from the captured HEIGHT, which maps to the game UI's
  // discrete resolution tiers. Far cheaper than measuring the scale with a multi-scale anchor
  // sweep, and valid because a screen-share surface can't change resolution mid-session.
  adjustResolution(height: number): { resolutionScale: number; expectedResolution: string } {
    let resolutionScale = 1;
    let expectedResolution = 'FHD';
    // The captured height includes the Windows title bar (~27px on Windows 10).
    if (height < 1080) {
      // Below FHD: upscale to FHD.
      resolutionScale = 1080 / (height - 27);
      expectedResolution = '(warning) below FHD';
    } else if (height >= 1080 && height <= 1080 + 48) {
      // FHD / UWFHD: use as-is.
    } else if (height >= 1440 && height <= 1440 + 48) {
      // QHD / UWQHD: downscale to 3/4.
      resolutionScale = 3 / 4;
      expectedResolution = 'QHD';
    } else if (height >= 2160 && height <= 2160 + 48) {
      // UHD: downscale to 1/2.
      resolutionScale = 1 / 2;
      expectedResolution = 'UHD';
    } else {
      // Unknown size: fall back to FHD as-is.
      expectedResolution = '(warning) Unknown';
    }
    return { resolutionScale, expectedResolution };
  }

  processFrame(frame: VideoFrame, drawDebug: boolean = false, detectionMargin: number = 0) {
    const start = performance.now();
    const cv = this.cv;
    let gray: CvMat | null = null;
    let debugCtx: OffscreenCanvasRenderingContext2D | null = null;
    if (!cv) return;

    try {
      if (!this.loadedAsset) return;

      // STANDARD path (today's fast height-tier + header-anchor design) — try it unless this session is
      // already classified non-standard.
      if (this.liveMode !== 'nonstandard') {
        const std = this.tryStandardPath(frame, drawDebug, detectionMargin);
        // Commit 'standard' ONLY once it has actually READ a gem. A bare header match must not lock the
        // session in — Lost Ark menus have gold-bordered panel headers that can match the "Astrogem"
        // anchor, and a 21:9 header matches at the wrong scale to read the list. Gating the commit on a
        // real gem read IS the fallback: until SOME path genuinely reads the gem page, both the standard
        // and non-standard paths keep getting tried each frame, so an early wrong guess can't strand the
        // session (which can't change resolution mid-stream, so the first path that reads it is correct).
        if (std.result && std.result.gems.length > 0) {
          this.liveMode = 'standard';
          this.nullStdFails = 0;
          return std.result;
        }
        // Already locked to 'standard' (it read gems earlier): this frame just found a header but no
        // gems, or lost the panel (a menu / black frame) — stay standard and re-search next frame.
        if (this.liveMode === 'standard') return std.result;
        // Still classifying and standard didn't read gems. Give standard a few frames of priority before
        // paying the non-standard icon sweep, so a transient standard miss on a real 16:9 client can't
        // commit it to the slower non-standard path.
        if (++this.nullStdFails < FrameProcessor.STANDARD_PRIORITY_FRAMES) return std.result;
        // Standard has failed to read for several frames running — fall through to the non-standard path.
      }

      // NON-STANDARD path (forced-21:9 / windowed): recognise on the NATIVE frame at the measured gem-
      // list scale, since the header is at a different scale and can't anchor the list. Decode native
      // gray once (used by both calibration and the fast pass).
      gray = this.decodeToGray(frame, frame.displayWidth, frame.displayHeight);
      if (drawDebug) {
        this.debugCanvas.width = frame.displayWidth;
        this.debugCanvas.height = frame.displayHeight;
        debugCtx = this.debugCanvas.getContext('2d');
        debugCtx?.drawImage(frame, 0, 0, this.debugCanvas.width, this.debugCanvas.height);
      }

      if (this.liveMode === 'nonstandard' && this.nsScaledAtlases && this.nsScale != null) {
        // Fast per-frame pass: re-lock the icon column in a narrow strip (cheap) and read at the cached
        // scale against the pre-scaled atlases — no per-frame multi-scale sweep, no template rescaling.
        return this.processFrameNonStandard(gray, frame, drawDebug, detectionMargin, debugCtx);
      }

      // Not yet classified: attempt the one-time non-standard calibration. Throttle the (expensive)
      // icon sweep so an idle stream with no gem panel doesn't pay it every frame.
      const now = performance.now();
      if (now - this.lastNsHeavyAt < FrameProcessor.NS_HEAVY_INTERVAL_MS) {
        if (drawDebug && debugCtx) this.drawNsDebug(debugCtx, frame, detectionMargin, null);
        return;
      }
      this.lastNsHeavyAt = now;
      const calib = this.calibrateNonStandard(gray, detectionMargin, debugCtx, frame, drawDebug);
      if (calib.calibrated) {
        this.liveMode = 'nonstandard';
        return calib.result;
      }
      if (drawDebug && debugCtx) this.drawNsDebug(debugCtx, frame, detectionMargin, null);
      return;
    } finally {
      // OpenCV.js Mats are WASM-heap allocations that are never GC'd; always release this frame's
      // native gray here (tryStandardPath owns + deletes its own resampled Mat). gray is null on the
      // standard-path return, so this no-ops there.
      if (gray) gray.delete();
      frame.close();
      this.frameTimes.push(performance.now() - start);
      if (this.frameTimes.length > 10) this.frameTimes.shift();
    }
  }

  // The STANDARD live path — verbatim today's behaviour: derive the UI scale from the frame HEIGHT,
  // resample to FHD in one drawImage, then header-anchor + read the 9 rows at native template scale
  // (geomScale 1). `found` = whether the gold header anchor matched (the 16:9-class signal); `result`
  // carries the gems (undefined when the anchor matched but the Order/Chaos label / rows didn't read).
  private tryStandardPath(
    frame: VideoFrame,
    drawDebug: boolean,
    detectionMargin: number
  ): { found: boolean; result?: RecognizeResult } {
    const cv = this.cv;
    const canvas = this.canvas;
    const ctx = this.ctx;
    let resizedFrame: CvMat | null = null;
    if (!cv || !this.loadedAsset) return { found: false };
    try {
      const { resolutionScale, expectedResolution } = this.adjustResolution(frame.displayHeight);
      canvas.width = frame.displayWidth * resolutionScale;
      canvas.height = frame.displayHeight * resolutionScale;
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resizedFrame = cv.matFromImageData(imageData);
      cv.cvtColor(resizedFrame, resizedFrame, cv.COLOR_RGBA2GRAY);
      if (resolutionScale !== 1) {
        // Add extra margin when we resample on our own.
        detectionMargin += 0.1;
      }

      let debugCtx: OffscreenCanvasRenderingContext2D | null = null;
      if (drawDebug) {
        this.debugCanvas.width = canvas.width;
        this.debugCanvas.height = canvas.height;
        debugCtx = this.debugCanvas.getContext('2d');
        if (debugCtx) {
          debugCtx.drawImage(frame, 0, 0, this.debugCanvas.width, this.debugCanvas.height);
          debugCtx.font = `40px Arial`;
          debugCtx.fillStyle = 'white';
          debugCtx.strokeStyle = 'black'; // outline color
          debugCtx.lineWidth = 10 * resolutionScale; // outline thickness
          const x = 25;
          let y = 100;
          // Draw the outline first, then fill in white text
          let msg = `Resolution: ${expectedResolution} (${frame.displayWidth}x${frame.displayHeight})`;
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
            const m = `${key}: ${(value - detectionMargin).toFixed(2)}`;
            debugCtx.strokeText(m, x, y);
            debugCtx.fillText(m, x, y);
            y += 20;
          }
        }
      }

      // 1. Find the anchor in the resampled frame.
      //    First detection: search the TOP-RIGHT QUADRANT (where the gem panel sits).
      //    Cached: search only the small ROI around the last anchor position.
      const roiAnchor = this.previousInfo
        ? {
            x: this.previousInfo.anchorLoc.x,
            y: this.previousInfo.anchorLoc.y,
            width: this.loadedAsset.atlasAnchor.entries[this.previousInfo.locale].width,
            height: this.loadedAsset.atlasAnchor.entries[this.previousInfo.locale].height,
          }
        : { x: canvas.width / 2, y: 0, width: canvas.width / 2, height: canvas.height / 2 };
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
        // Not found: reset so the next frame searches the quadrant again.
        this.previousInfo = null;
        return { found: false };
      }
      // Found: record the locale + location for the next frame's fast re-lock.
      this.previousInfo = {
        locale: anchor.key,
        anchorLoc: { x: anchor.loc.x, y: anchor.loc.y },
      };

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
      if (!gemAttr) return { found: true };

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
        debugCtx ?? undefined
      );
      // owned-count is read only on the static-image upload path (recognizeGems); the live frame
      // stream doesn't need the checksum, so leave it null here.
      return {
        found: true,
        result: { locale: currentLocale, gemAttr: gemAttr.key, gems: currentGems, owned: null },
      };
    } finally {
      if (resizedFrame) resizedFrame.delete();
    }
  }

  // Fast per-frame NON-STANDARD pass: re-lock the gem-icon column (cheap, narrow vertical strip around
  // the cached column; a throttled full-frame seed re-acquires after the panel moves/closes), then read
  // the 9 rows on the native frame at the cached scale against the pre-scaled atlases.
  private processFrameNonStandard(
    gray: CvMat,
    frame: VideoFrame,
    drawDebug: boolean,
    detectionMargin: number,
    debugCtx: OffscreenCanvasRenderingContext2D | null
  ): RecognizeResult | undefined {
    const cv = this.cv!;
    const asset = this.loadedAsset!;
    const g = this.nsScale!;
    const scaled = this.nsScaledAtlases!;

    let lock =
      this.nsColX != null && this.nsRow0Y != null && this.nsPitch != null
        ? this.relockStrip(gray, scaled.gemImage, this.nsColX, this.nsRow0Y, this.nsPitch, g, detectionMargin)
        : null;
    if (!lock) {
      this.nsRelockMiss++;
      // No cheap lock (panel moved/closed, or none cached yet). Re-acquire with a full-frame single-
      // scale seed — throttled so a genuinely absent panel doesn't pay it every frame.
      const now = performance.now();
      if (
        (this.nsColX == null || this.nsRelockMiss >= FrameProcessor.NS_RELOCK_REACQUIRE) &&
        now - this.lastNsHeavyAt >= FrameProcessor.NS_HEAVY_INTERVAL_MS
      ) {
        this.lastNsHeavyAt = now;
        lock = this.reacquireNonStandard(gray, detectionMargin);
      }
    }
    if (!lock) {
      if (drawDebug && debugCtx) this.drawNsDebug(debugCtx, frame, detectionMargin, g);
      return undefined;
    }
    this.nsColX = lock.colX;
    this.nsRow0Y = lock.row0Y;
    this.nsRelockMiss = 0;

    const anchorX = lock.colX + 267 * g;
    const anchorY = lock.row0Y - 230 * g;
    const gems = extractNineGems(
      cv,
      gray,
      asset,
      this.nsLocale,
      'Order',
      anchorX,
      anchorY,
      this.thresholdSet,
      detectionMargin + 0.1,
      debugCtx ?? undefined,
      g,
      scaled
    );
    if (drawDebug && debugCtx) this.drawNsDebug(debugCtx, frame, detectionMargin, g);
    if (gems.length === 0) {
      // Re-locked an icon but read nothing — usually a transient blurry frame, but a persistent streak
      // means the cached geometry went stale (e.g. the window was nudged < a row, which the strip snap
      // can't track). Drop the lock so the next frame does a full re-acquire that re-derives it.
      if (++this.nsEmptyStreak >= FrameProcessor.NS_EMPTY_REACQUIRE) {
        this.nsColX = null;
        this.nsRow0Y = null;
        this.nsEmptyStreak = 0;
      }
      return undefined;
    }
    this.nsEmptyStreak = 0;
    return { locale: this.nsLocale, gemAttr: deriveAttr(gems), gems, owned: null };
  }

  // One-time NON-STANDARD calibration: seed on the gem icons (full multi-scale sweep), walk the icon
  // column, then REFINE the scale by maximising complete-gem count — the row pitch fixes a rough scale,
  // but the field-offset geometry's effective scale can differ ~1-2% (measured: pitch g≈1.0, fields read
  // at g≈1.015). Caches the scale, icon column, row-0 y, and the pre-scaled field atlases for the fast
  // pass. `calibrated` is true once a readable gem panel is found at some scale.
  private calibrateNonStandard(
    gray: CvMat,
    detectionMargin: number,
    debugCtx: OffscreenCanvasRenderingContext2D | null,
    frame: VideoFrame,
    drawDebug: boolean
  ): { calibrated: boolean; result?: RecognizeResult } {
    const cv = this.cv!;
    const asset = this.loadedAsset!;
    const locale = this.nsLocale;
    const gemAtlas = asset.atlasGemImage[locale];

    const seed = multiScaleAnchorMatch(cv, gray, gemAtlas, this.anchorScaleLadder);
    if (!seed) return { calibrated: false };
    const { colX, rows } = findIconRows(
      cv,
      gray,
      gemAtlas,
      seed.scale,
      seed.loc.x,
      seed.loc.y,
      this.thresholdSet.gemImage - detectionMargin
    );
    if (rows.length < 2) return { calibrated: false };
    const row0Y = rows[0].y;
    const pitch = (rows[rows.length - 1].y - rows[0].y) / (rows.length - 1); // actual on-screen row pitch
    const g0 = scaleFromPitch(rows, seed.scale);
    const refined = this.refineScale(gray, locale, colX, row0Y, g0, detectionMargin);
    if (refined.count < 1) return { calibrated: false }; // a layout but no readable gems → not a gem panel

    if (this.nsScaledAtlases) disposeScaledFieldAtlases(this.nsScaledAtlases);
    this.nsScaledAtlases = buildScaledFieldAtlases(cv, asset, locale, refined.g);
    this.nsScale = refined.g;
    this.nsColX = colX;
    this.nsRow0Y = row0Y;
    this.nsPitch = pitch;
    this.nsRelockMiss = 0;

    const anchorX = colX + 267 * refined.g;
    const anchorY = row0Y - 230 * refined.g;
    const gems = extractNineGems(
      cv,
      gray,
      asset,
      locale,
      'Order',
      anchorX,
      anchorY,
      this.thresholdSet,
      detectionMargin + 0.1,
      debugCtx ?? undefined,
      refined.g,
      this.nsScaledAtlases
    );
    if (drawDebug && debugCtx) this.drawNsDebug(debugCtx, frame, detectionMargin, refined.g);
    return {
      calibrated: true,
      result: gems.length ? { locale, gemAttr: deriveAttr(gems), gems, owned: null } : undefined,
    };
  }

  // Sweep the on-screen scale ±0.04 around the pitch estimate `g0` (step 0.005) and return the scale
  // that reads the most COMPLETE gems (all 7 fields above threshold can't align by chance), tie-broken
  // toward g0. extractNineGems builds/disposes its own scaled atlases per probe (calibration-only cost).
  private refineScale(
    gray: CvMat,
    locale: GemRecognitionLocale,
    colX: number,
    row0Y: number,
    g0: number,
    detectionMargin: number
  ): { g: number; count: number } {
    const cv = this.cv!;
    const asset = this.loadedAsset!;
    let best = { g: g0, count: -1 };
    for (let gg = g0 - 0.04; gg <= g0 + 0.04 + 1e-9; gg += 0.005) {
      const n = extractNineGems(
        cv,
        gray,
        asset,
        locale,
        'Order',
        colX + 267 * gg,
        row0Y - 230 * gg,
        this.thresholdSet,
        detectionMargin + 0.1,
        undefined,
        gg
      ).length;
      if (n > best.count || (n === best.count && Math.abs(gg - g0) < Math.abs(best.g - g0))) {
        best = { g: gg, count: n };
      }
    }
    return best;
  }

  // Re-acquire the icon column after the panel moved/closed: a full-frame seed at the KNOWN scale
  // (single-scale, far cheaper than the calibration ladder), then walk the column. Throttled by the
  // caller. Returns the icon column x + row-0 y, or null when no gem panel is visible.
  private reacquireNonStandard(
    gray: CvMat,
    detectionMargin: number
  ): { colX: number; row0Y: number } | null {
    const cv = this.cv!;
    const asset = this.loadedAsset!;
    const g = this.nsScale!;
    const gemAtlas = asset.atlasGemImage[this.nsLocale];
    const seed = multiScaleAnchorMatch(cv, gray, gemAtlas, [g]);
    if (!seed) return null;
    const { colX, rows } = findIconRows(
      cv,
      gray,
      gemAtlas,
      g,
      seed.loc.x,
      seed.loc.y,
      this.thresholdSet.gemImage - detectionMargin
    );
    if (rows.length < 1) return null;
    // Refresh the measured pitch from the re-acquired rows (the on-screen spacing is unchanged, but a
    // longer/shorter visible list gives a cleaner estimate).
    if (rows.length >= 2) this.nsPitch = (rows[rows.length - 1].y - rows[0].y) / (rows.length - 1);
    return { colX, row0Y: rows[0].y };
  }

  // Cheap per-frame re-lock: slide the pre-scaled gem-icon templates over a narrow VERTICAL STRIP around
  // the cached icon column (spanning the 9 rows), take the best match, and snap its y to the cached row
  // grid. Returns the (drift-corrected) icon column x + row-0 y, or null below the gem-image threshold.
  private relockStrip(
    gray: CvMat,
    gemAtlasScaled: ScaledFieldAtlases['gemImage'],
    colX: number,
    row0Y: number,
    pitch: number,
    g: number,
    detectionMargin: number
  ): { colX: number; row0Y: number } | null {
    const cv = this.cv!;
    const entries = gemAtlasScaled.entries;
    const keys = Object.keys(entries) as (keyof typeof entries)[];
    let maxW = 0;
    let maxH = 0;
    for (const key of keys) {
      maxW = Math.max(maxW, entries[key].template.cols);
      maxH = Math.max(maxH, entries[key].template.rows);
    }
    const padX = Math.round(6 * g);
    const sx = Math.max(0, Math.round(colX - padX));
    const sy = Math.max(0, Math.round(row0Y - pitch * 0.5));
    const sw = Math.min(maxW + 2 * padX, gray.cols - sx);
    const sh = Math.min(Math.round(pitch * 9), gray.rows - sy);
    if (sw < maxW || sh < maxH) return null;
    const roi = gray.roi(new cv.Rect(sx, sy, sw, sh));
    let best: { score: number; x: number; y: number } | null = null;
    try {
      for (const key of keys) {
        const tpl = entries[key].template;
        if (tpl.cols > roi.cols || tpl.rows > roi.rows) continue;
        const res = new cv.Mat();
        cv.matchTemplate(roi, tpl, res, cv.TM_CCOEFF_NORMED);
        const mm = (cv.minMaxLoc as unknown as (m: CvMat) => { maxVal: number; maxLoc: { x: number; y: number } })(res);
        if (!best || mm.maxVal > best.score) best = { score: mm.maxVal, x: sx + mm.maxLoc.x, y: sy + mm.maxLoc.y };
        res.delete();
      }
    } finally {
      roi.delete();
    }
    if (!best || best.score <= this.thresholdSet.gemImage - detectionMargin) return null;
    // Snap the best match's y to the nearest cached-grid row and recompute row-0 y from it (so a lock on
    // any row, e.g. when row 0 is empty/cut off, still yields the row-0 origin extractNineGems needs).
    const k = Math.round((best.y - row0Y) / pitch);
    return { colX: best.x, row0Y: best.y - k * pitch };
  }

  // Draw the live NON-STANDARD debug overlay (mode + measured scale + FPS + per-target thresholds) on
  // the native-size debug canvas. `g` is the cached on-screen scale, or null while still calibrating.
  private drawNsDebug(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: VideoFrame,
    detectionMargin: number,
    g: number | null
  ) {
    ctx.font = `40px Arial`;
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 10;
    const x = 25;
    let y = 100;
    const line = (msg: string, dy: number) => {
      ctx.strokeText(msg, x, y);
      ctx.fillText(msg, x, y);
      y += dy;
    };
    line(`Live mode: non-standard / icon-seed (${frame.displayWidth}x${frame.displayHeight})`, 40);
    line(`Measured scale: ${g != null ? `${g.toFixed(3)}x` : 'calibrating…'}`, 40);
    const avg = this.frameTimes.reduce((acc, v) => acc + v, 0) / (this.frameTimes.length || 1);
    line(`FPS: ${(1000 / avg).toFixed(2)}`, 40);
    ctx.font = '20px Arial';
    line('OpenCV Matching Threshold', 20);
    for (const [key, value] of Object.entries(this.thresholdSet)) {
      line(`${key}: ${(value - detectionMargin).toFixed(2)}`, 20);
    }
  }

  // Recognize gems from a single uploaded/pasted screenshot via the CLIENT-AGNOSTIC OCR path
  // (recognizeOcr.ts): the gem text is read by OCR (rendering-invariant) so an upload works on ANY
  // client, unlike the template-matching live path. Closes the bitmap. (`detectionMargin` is unused
  // here — OCR has no per-match threshold to relax.)
  async processImage(bitmap: ImageBitmap): Promise<RecognizeResult | undefined> {
    const cv = this.cv;
    let gray: CvMat | null = null;
    try {
      if (!cv || !this.loadedAsset) return undefined;
      gray = this.decodeToGray(bitmap, bitmap.width, bitmap.height);
      if (!this.ocrRunner) this.ocrRunner = new BrowserOcrRunner();
      const result = await recognizeGemsOcr(cv, gray, this.loadedAsset, this.ocrRunner, {
        anchorScaleLadder: this.anchorScaleLadder,
        onProgress: (fraction) => postToMain({ type: 'image:progress', fraction }),
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
      // Init request. The worker is re-used across sessions, so forget the previously cached
      // anchor location here — a new share may be a different-resolution window.
      processor.resetSession();
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
      // Frame analysis request. Wrap so a throw (an OpenCV / WASM failure) still posts frame:done: the
      // capture loop's `await waitForAnalysis` would otherwise never settle, hanging the loop and
      // leaving the screen share live. processFrame's own `finally` has already closed the frame.
      try {
        const result = processor.processFrame(data.frame, data.drawDebug, data.detectionMargin);
        postToMain({ type: 'frame:done', result });
        if (data.drawDebug) {
          postToMain({
            type: 'debug',
            image: processor.debugCanvas.transferToImageBitmap(),
          });
        }
      } catch {
        postToMain({ type: 'frame:done', result: undefined });
      }
      break;

    case 'image': {
      // Static-image (upload/paste) recognition request — independent of the live frame loop. Async:
      // the OCR path lazy-loads tesseract and runs many OCR calls. Wrap so a throw (e.g. a tesseract
      // load failure) still posts image:done — otherwise recognizeImage() never resolves and the upload
      // zone shows "Recognizing…" forever. processImage's `finally` has already closed the bitmap.
      try {
        const result = await processor.processImage(data.bitmap);
        postToMain({ type: 'image:done', result });
      } catch {
        postToMain({ type: 'image:done', result: undefined });
      }
      break;
    }
  }
};
