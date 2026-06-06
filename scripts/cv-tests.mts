/**
 * OpenCV-dependent tests, run via `tsx` (plain Node) rather than Vitest.
 *
 * Why not Vitest: the 10MB @techstark/opencv-js WASM bundle hangs under Vitest's
 * worker/transform pipeline. In plain Node (what tsx gives us) it initializes in
 * a few seconds. Pure-logic tests still live in *.test.ts under Vitest.
 *
 * Run: `npm run test:cv` (or as part of `npm test`).
 */
import { generateMatchingAtlas } from '../src/lib/cv/atlas';
import { getCv, initOpenCv } from '../src/lib/cv/cvRuntime';
import { multiScaleAnchorMatch } from '../src/lib/cv/matcher';
import { buildScaleLadder } from '../src/lib/cv/scaleDetection';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ok   - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL - ${name}`);
  }
}

async function main(): Promise<void> {
  await initOpenCv();
  const cv = getCv();

  // Smoke: OpenCV is available and can build a Mat.
  const m = cv.Mat.zeros(4, 4, cv.CV_8UC1);
  check('opencv builds a 4x4 mat', m.rows === 4 && m.cols === 4);
  m.delete();

  // multiScaleAnchorMatch: recover a known scale and location of a template
  // embedded in a frame at 1.5x. Use a deterministic high-variance (noise-like)
  // pattern so the correlation peak is sharp at the true scale.
  const W = 30;
  const H = 16;
  const pattern: number[] = [];
  for (let i = 0; i < W * H; i++) pattern.push((i * 73 + 17) % 256);
  const tpl = cv.matFromArray(H, W, cv.CV_8UC1, pattern);
  const atlas = generateMatchingAtlas({ anchor: tpl });

  const frame = cv.Mat.zeros(400, 800, cv.CV_8UC1);
  const scaled = new cv.Mat();
  cv.resize(
    tpl,
    scaled,
    new cv.Size(Math.round(W * 1.5), Math.round(H * 1.5)),
    0,
    0,
    cv.INTER_LINEAR
  );
  const dst = frame.roi(new cv.Rect(300, 120, scaled.cols, scaled.rows));
  scaled.copyTo(dst);
  dst.delete();

  const best = multiScaleAnchorMatch(cv, frame, atlas, buildScaleLadder(0.5, 2.5, 0.1));
  check('multiScaleAnchorMatch finds a match', best !== null);
  check('recovers scale ~1.5', !!best && Math.abs(best.scale - 1.5) <= 0.1);
  check('recovers high correlation score', !!best && best.score > 0.9);
  check('recovers x location ~300', !!best && Math.abs(best.loc.x - 300) <= 2);
  check('recovers y location ~120', !!best && Math.abs(best.loc.y - 120) <= 2);
  if (best)
    console.log(
      `       (measured scale=${best.scale}, score=${best.score.toFixed(3)}, loc=${best.loc.x},${best.loc.y})`
    );

  tpl.delete();
  atlas.atlas.delete();
  frame.delete();
  scaled.delete();

  // Precision: embed at an OFF-ladder scale (1.333 = real QHD 1440/1080) and require
  // tight recovery. A coarse-only search snaps to 1.30/1.35; that ~2.5% error compounds
  // with anchor-relative distance and breaks the tiny gem-row templates (observed as
  // 0 gems on a real QHD screenshot). Needs sub-ladder refinement.
  const tpl2 = cv.matFromArray(H, W, cv.CV_8UC1, pattern);
  const atlas2 = generateMatchingAtlas({ anchor: tpl2 });
  const frame2 = cv.Mat.zeros(500, 900, cv.CV_8UC1);
  const scaled2 = new cv.Mat();
  cv.resize(
    tpl2,
    scaled2,
    new cv.Size(Math.round(W * 1.333), Math.round(H * 1.333)),
    0,
    0,
    cv.INTER_LINEAR
  );
  const dst2 = frame2.roi(new cv.Rect(250, 150, scaled2.cols, scaled2.rows));
  scaled2.copyTo(dst2);
  dst2.delete();
  const best2 = multiScaleAnchorMatch(cv, frame2, atlas2, buildScaleLadder(0.5, 2.5, 0.1));
  check(
    'recovers OFF-ladder scale ~1.333 within 0.02',
    !!best2 && Math.abs(best2.scale - 1.333) <= 0.02
  );
  if (best2)
    console.log(
      `       (off-ladder measured scale=${best2.scale}, score=${best2.score.toFixed(3)})`
    );
  tpl2.delete();
  atlas2.atlas.delete();
  frame2.delete();
  scaled2.delete();

  console.log(`\ncv-tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('cv-tests crashed:', e);
  process.exit(1);
});
