import type { CV } from '@techstark/opencv-js';

import type { GemRecognitionLocale } from '../constants/enums';
import { getCv, initOpenCv } from './cvRuntime';
import { loadGemAsset } from './matStore';
import { type RecognizeResult, extractNineGems, findBest } from './recognize';
import { recognizeGemsOcr, type OcrResult, type OcrRunner } from './recognizeOcr';
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
    // view changes). The UI scale is derived from the frame height every frame, so there is
    // nothing else to reset.
    this.previousInfo = null;
  }

  resetSession() {
    // Full reset for a NEW screen-share session: forget the cached anchor location so a freshly
    // shared window re-locks from scratch.
    this.previousInfo = null;
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
    const canvas = this.canvas;
    const ctx = this.ctx;
    let resizedFrame: CvMat | null = null;
    let debugCtx: OffscreenCanvasRenderingContext2D | null = null;
    const cv = this.cv;
    if (!cv) return;

    try {
      if (!this.loadedAsset) return;

      // Derive the UI scale from the frame height and resample to FHD scale in a single drawImage,
      // so the existing offsets/templates line up without an expensive multi-scale sweep.
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

      if (drawDebug) {
        this.debugCanvas.width = canvas.width;
        this.debugCanvas.height = canvas.height;

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
            const msg = `${key}: ${(value - detectionMargin).toFixed(2)}`;
            debugCtx.strokeText(msg, x, y);
            debugCtx.fillText(msg, x, y);
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
        return;
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
        debugCtx ?? undefined
      );
      // owned-count is read only on the static-image upload path (recognizeGems); the live frame
      // stream doesn't need the checksum, so leave it null here.
      return { locale: currentLocale, gemAttr: gemAttr.key, gems: currentGems, owned: null };
    } finally {
      // OpenCV.js Mats are WASM-heap allocations that are never GC'd; an exception between
      // creation and the happy-path delete below would leak resizedFrame without this.
      if (resizedFrame) resizedFrame.delete();
      frame.close();
      this.frameTimes.push(performance.now() - start);
      if (this.frameTimes.length > 10) this.frameTimes.shift();
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

    case 'image': {
      // Static-image (upload/paste) recognition request — independent of the live frame loop. Async:
      // the OCR path lazy-loads tesseract and runs many OCR calls.
      const result = await processor.processImage(data.bitmap);
      postToMain({ type: 'image:done', result });
      break;
    }
  }
};
