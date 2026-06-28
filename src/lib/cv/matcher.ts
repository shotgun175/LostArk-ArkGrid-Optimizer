import type { MinMaxLoc } from '@techstark/opencv-js';

import type { MatchingAtlas } from './atlas';
import { getCv } from './cvRuntime';
import {
  type ScaleCandidate,
  buildScaleLadder,
  chooseBestScale,
  computeSearchDownscale,
} from './scaleDetection';
import type { CvMat, CvPoint, CvRect } from './types';

export type MatchingResult<K extends string> = {
  key: K;
  score: number;
  loc: CvPoint;
  template: CvMat;
};

// @techstark/opencv-js's generated `minMaxLoc` type mirrors the C++ output-pointer
// signature, but the actual JS binding is `minMaxLoc(src, mask?) => MinMaxLoc`. Wrap once.
function minMaxLocOf(cv: ReturnType<typeof getCv>, src: CvMat): MinMaxLoc {
  return (cv.minMaxLoc as unknown as (s: CvMat) => MinMaxLoc)(src);
}

export function getBestMatch<K extends string>(
  frame: CvMat,
  matchingAtlas: MatchingAtlas<K>,
  roi?: CvRect,
  option?: {
    method?: number;
    excludeKey?: K;
  }
): MatchingResult<K> | null {
  if (roi) {
    if (
      roi.x < 0 ||
      roi.x + roi.width > frame.cols ||
      roi.y < 0 ||
      roi.y + roi.height > frame.rows ||
      roi.width <= 0 ||
      roi.height <= 0
    ) {
      return null;
    }
  }
  const cv = getCv();
  const targetFrame = roi ? frame.roi(roi) : frame;

  let bestMm: MinMaxLoc | null = null;
  let bestKey: K | null = null;

  for (const key of Object.keys(matchingAtlas.entries) as K[]) {
    if (option?.excludeKey && key === option.excludeKey) continue;
    const template = matchingAtlas.entries[key].template;
    const result = new cv.Mat();
    // if (template.cols > targetFrame.cols && template.rows > targetFrame.rows) {
    //   // When both exceed, swap image and template and compute that way.
    //   throw Error(
    //     `Template size ${template.cols}x${template.rows} is larger than ROI ${targetFrame.cols}x${targetFrame.rows}. matchTemplate skipped.`
    //   );
    // }
    cv.matchTemplate(
      targetFrame,
      template,
      result,
      option?.method ? option.method : cv.TM_CCOEFF_NORMED
    );
    const mm = minMaxLocOf(cv, result);
    if (!bestMm || mm.maxVal > bestMm.maxVal) {
      bestMm = mm;
      bestKey = key;
    }
    result.delete();
  }

  if (roi) targetFrame.delete();

  if (!bestMm || !bestKey) throw Error('matchingAtlas is empty');

  return {
    key: bestKey,
    score: bestMm.maxVal,
    loc: new cv.Point(
      roi ? roi.x + bestMm.maxLoc.x : bestMm.maxLoc.x,
      roi ? roi.y + bestMm.maxLoc.y : bestMm.maxLoc.y
    ),
    template: matchingAtlas.entries[bestKey].template,
  };
}

/**
 * Find the atlas template at its true on-screen scale.
 * Returns the best { key (locale), scale, score, loc-in-frame-pixels } or null.
 *
 * Two passes: a COARSE search over `ladder` (frame downscaled to <= maxSearchWidth for
 * speed), then a FINE search at full resolution around the coarse winner. The fine pass
 * is essential — ladder quantization (e.g. snapping QHD's true 1.333 to 1.30) leaves a
 * ~2.5% scale error that compounds with anchor-relative distance and breaks the small
 * gem-row templates. Recovered loc is reported in the ORIGINAL frame's coordinates.
 */
export function multiScaleAnchorMatch<K extends string>(
  cv: ReturnType<typeof getCv>,
  frame: CvMat,
  matchingAtlas: MatchingAtlas<K>,
  ladder: number[],
  maxSearchWidth = 1600,
  // Optional 0..1 progress over the coarse sweep — the slow first step of upload recognition. The
  // worker posts these while it runs, so the main-thread bar can move instead of sitting at 0.
  onProgress?: (fraction: number) => void
): ScaleCandidate<K> | null {
  const searchScales = (
    scales: number[],
    downscale: number,
    onlyKey?: K,
    onScale?: (fraction: number) => void
  ): ScaleCandidate<K>[] => {
    let small = frame;
    if (downscale < 1) {
      small = new cv.Mat();
      cv.resize(
        frame,
        small,
        new cv.Size(Math.round(frame.cols * downscale), Math.round(frame.rows * downscale)),
        0,
        0,
        cv.INTER_AREA
      );
    }
    const keys = onlyKey ? [onlyKey] : (Object.keys(matchingAtlas.entries) as K[]);
    const out: ScaleCandidate<K>[] = [];
    for (let si = 0; si < scales.length; si++) {
      const f = scales[si];
      for (const key of keys) {
        const tpl = matchingAtlas.entries[key].template;
        const tw = Math.round(tpl.cols * f * downscale);
        const th = Math.round(tpl.rows * f * downscale);
        if (tw < 4 || th < 4 || tw > small.cols || th > small.rows) continue;
        const scaledTpl = new cv.Mat();
        cv.resize(
          tpl,
          scaledTpl,
          new cv.Size(tw, th),
          0,
          0,
          f * downscale < 1 ? cv.INTER_AREA : cv.INTER_LINEAR
        );
        const res = new cv.Mat();
        cv.matchTemplate(small, scaledTpl, res, cv.TM_CCOEFF_NORMED);
        const mm = minMaxLocOf(cv, res);
        out.push({
          key,
          scale: f,
          score: mm.maxVal,
          loc: { x: mm.maxLoc.x / downscale, y: mm.maxLoc.y / downscale },
        });
        scaledTpl.delete();
        res.delete();
      }
      onScale?.((si + 1) / scales.length);
    }
    if (small !== frame) small.delete();
    return out;
  };

  // Coarse pass over the ladder, downscaled for speed (reports 0..0.7 of this match's progress).
  const coarse = chooseBestScale(
    searchScales(
      ladder,
      computeSearchDownscale(frame.cols, maxSearchWidth),
      undefined,
      onProgress && ((f) => onProgress(0.7 * f))
    )
  );
  if (!coarse) return null;

  // Fine pass at full resolution around the coarse winner (winning locale only), to beat
  // ladder quantization and recover the true sub-step scale (reports 0.7..1.0).
  const step = ladder.length > 1 ? Math.abs(ladder[1] - ladder[0]) : 0.05;
  const fineLadder = buildScaleLadder(
    Math.max(0.05, coarse.scale - step),
    coarse.scale + step,
    step / 10
  );
  const fine = chooseBestScale(
    searchScales(fineLadder, 1, coarse.key, onProgress && ((f) => onProgress(0.7 + 0.3 * f)))
  );
  return fine && fine.score >= coarse.score ? fine : coarse;
}
