import type { CV } from '@techstark/opencv-js';

import type { GemRecognitionLocale } from '../constants/enums';
import { type ArkGridGem, determineGemGradeByGem } from '../models/arkGridGems';
import type { MatchingAtlas } from './atlas';
import { getCv, initOpenCv } from './cvRuntime';
import { showMatch } from './debug';
import { type KeyOptionLevel, type KeyOptionString, loadGemAsset } from './matStore';
import { type MatchingResult, getBestMatch, multiScaleAnchorMatch } from './matcher';
import { buildScaleLadder, rawScaleToResolutionScale, snapResolutionScale } from './scaleDetection';
import type { CaptureWorkerRequest, CaptureWorkerResponse, CvMat } from './types';

type RecgonitionTarget<K extends string> = {
  roi: {
    // Search-target roi within the full frame
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // Atlas to use
  atlas: MatchingAtlas<K>;
  threshold: number;
};

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

  findBest<K extends string>(
    t: RecgonitionTarget<K>,
    frame: CvMat,
    debugCtx?: OffscreenCanvasRenderingContext2D | null,
    option?: {
      method?: number;
      excludeKey?: K;
    }
  ): MatchingResult<K> | null {
    // Find the given target
    if (!this.cv) throw Error('cv is not ready');
    const roi = new this.cv.Rect(t.roi.x, t.roi.y, t.roi.width, t.roi.height);
    const match = getBestMatch(frame, t.atlas, roi, option);
    if (!match) return null;
    if (debugCtx) {
      showMatch(debugCtx, roi, match, {
        scoreThreshold: t.threshold,
      });
    }
    if (match.score > t.threshold) return match;
    return null;
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

      // Decode the raw frame ONCE at native size into a grayscale Mat.
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const rawImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const rawGray = cv.matFromImageData(rawImageData);
      cv.cvtColor(rawGray, rawGray, cv.COLOR_RGBA2GRAY);

      // Determine the UI scale: reuse the cached scale, else measure it once by
      // multi-scale matching the anchor over the full raw frame.
      let resolutionScale: number;
      if (this.previousInfo) {
        resolutionScale = this.previousInfo.resolutionScale;
      } else if (this.cachedResolutionScale !== null) {
        // Re-lock path: the anchor was lost for a frame but the resolution is unchanged, so reuse
        // the scale we already measured and skip the multi-scale sweep. The anchor LOCATION is
        // re-found cheaply below (full-frame single-scale match at this scale).
        resolutionScale = this.cachedResolutionScale;
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
          this.previousInfo = null;
          return;
        }
        // Snap to a canonical resolution tier when close: the anchor's correlation peak is
        // ~1-2% biased by font rendering, and that error compounds with anchor-relative
        // distance and breaks the small gem-row templates (verified on real QHD frames).
        resolutionScale = snapResolutionScale(rawScaleToResolutionScale(measured.scale));
        // Measured once for this session; every later re-lock reuses it (branch above).
        this.cachedResolutionScale = resolutionScale;
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
          let x = 25;
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
      const anchor = this.findBest(
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
      }

      let currentLocale = this.previousInfo.locale;
      let anchorX = this.previousInfo.anchorLoc.x;
      let anchorY = this.previousInfo.anchorLoc.y;

      //2 Search for the Order or Chaos label
      const gemAttr = this.findBest(
        {
          roi: { x: anchorX - 186, y: anchorY + 91, width: 224, height: 32 },
          atlas: this.loadedAsset.atlasGemAttr[currentLocale],
          threshold: this.thresholdSet.gemAttr - detectionMargin,
        },
        resizedFrame,
        debugCtx
      );
      if (!gemAttr) return;

      // 5. Find the 9 gems and do image matching
      const currentGems: ArkGridGem[] = [];
      for (let i = 0; i < 9; i++) {
        // Compute the gem row position (height 61px, gap 2px)
        const rowX = anchorX - 287;
        const rowY = anchorY + 213 + 63 * i;

        // 1) Gem type (name)
        const gemName = this.findBest(
          {
            roi: { x: rowX + 9, y: rowY + 14, width: 30, height: 30 },
            atlas: this.loadedAsset.altasGemImage[currentLocale],
            threshold: this.thresholdSet.gemImage - detectionMargin,
          },
          resizedFrame,
          debugCtx
        );

        // 2) Willpower
        const willPower = this.findBest(
          {
            roi: { x: rowX + 65, y: rowY, width: 18, height: 30 },
            atlas: this.loadedAsset.atlasWillPower[currentLocale],
            threshold: this.thresholdSet.willPower - detectionMargin,
          },
          resizedFrame,
          debugCtx
        );

        // 3) Order/Chaos point
        const corePoint = this.findBest(
          {
            roi: { x: rowX + 65, y: rowY + 30, width: 18, height: 30 },
            atlas: this.loadedAsset.atlasCorePoint[currentLocale],
            threshold: this.thresholdSet.corePoint - detectionMargin,
          },
          resizedFrame,
          debugCtx
        );

        // 4) Extract gem options
        type GemOptionResult = {
          optionName: MatchingResult<KeyOptionString> | null;
          optionLevel: MatchingResult<KeyOptionLevel> | null;
          yOffset: number;
        };
        const optionTop: GemOptionResult = {
          optionName: null,
          optionLevel: null,
          yOffset: 0,
        };
        const optionBottom: GemOptionResult = {
          optionName: null,
          optionLevel: null,
          yOffset: 30, // the bottom option sits 30px below
        };

        for (const targetOption of [optionTop, optionBottom]) {
          // Option name
          const optionNameRoi = {
            x: rowX + 125,
            y: rowY + targetOption.yOffset,
            width: 200,
            height: 30,
          };
          let optionName = this.findBest(
            {
              roi: optionNameRoi,
              atlas: this.loadedAsset.atlasOptionName[currentLocale],
              threshold: this.thresholdSet.optionName - detectionMargin,
            },
            resizedFrame,
            currentLocale === 'ru_ru' ? null : debugCtx
          );

          // For ru_ru, "AtkPower" gets captured from the "AllyAttackEnh" string
          if (optionName !== null && currentLocale === 'ru_ru' && optionName.key === 'AtkPower') {
            // So check again against an atlas that excludes "AtkPower"
            const tempOptionName = this.findBest(
              {
                roi: optionNameRoi,
                atlas: this.loadedAsset.atlasOptionName[currentLocale],
                threshold: this.thresholdSet.optionName - detectionMargin,
              },
              resizedFrame,
              null,
              {
                excludeKey: 'AtkPower',
              }
            );
            if (tempOptionName) {
              // If it's still found, this is actually "AllyAttackEnh"
              optionName = tempOptionName;
            } else {
              // "AllyAttackEnh" wasn't found, so it's "AtkPower"
            }
          }

          if (currentLocale === 'ru_ru') {
            // Draw the debug that findBest didn't draw
            // XXX When not found we'd want to show that it wasn't found, but we can't here
            if (debugCtx && optionName) {
              showMatch(debugCtx, optionNameRoi, optionName, {
                scoreThreshold: this.thresholdSet.optionName - detectionMargin,
              });
            }
          }

          // Option level
          // The level sits 16px past the position found above
          const optionLevelXOffset = optionName
            ? optionName.loc.x - optionNameRoi.x + optionName.template.cols + 16
            : 60;

          const optionLevel = this.findBest(
            {
              roi: {
                x: rowX + 125 + optionLevelXOffset,
                y: rowY + targetOption.yOffset,
                width: 48,
                height: 30,
              },
              atlas: this.loadedAsset.atlasOptionLevel[currentLocale],
              threshold: this.thresholdSet.optionLevel - detectionMargin,
            },
            resizedFrame,
            debugCtx
          );

          targetOption.optionName = optionName;
          targetOption.optionLevel = optionLevel;
        }

        if (
          gemName !== null &&
          willPower !== null &&
          corePoint !== null &&
          optionTop.optionName !== null &&
          optionTop.optionLevel !== null &&
          optionBottom.optionName !== null &&
          optionBottom.optionLevel !== null
        ) {
          const gem: ArkGridGem = {
            gemAttr: gemAttr.key,
            name: gemName.key,
            req: Number(willPower.key),
            point: Number(corePoint.key),
            option1: {
              optionType: optionTop.optionName.key,
              value: Number(optionTop.optionLevel.key),
            },
            option2: {
              optionType: optionBottom.optionName.key,
              value: Number(optionBottom.optionLevel.key),
            },
          };
          gem.grade = determineGemGradeByGem(gem);
          currentGems.push(gem);
        }
      }
      return { locale: currentLocale, gemAttr: gemAttr.key, gems: currentGems };
      // ... other recognition
      // return the recognized objects
    } finally {
      if (resizedFrame) resizedFrame.delete();
      frame.close();
      this.frameTimes.push(performance.now() - start);
      if (this.frameTimes.length > 10) this.frameTimes.shift();
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
      // scale here — a new share may be a different-resolution window.
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
  }
};
