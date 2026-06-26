/**
 * CV recognition ACCURACY harness — dev-only, run via `npm run test:cv-accuracy` (tsx/Node).
 *
 * Decodes each real screenshot fixture (JPEG via jpeg-js) and each template sprite (PNG via pngjs)
 * into OpenCV Mats, runs the SAME single-image core the in-app upload path uses (recognize.ts), and
 * scores the result field-by-field against a hand-validated ground-truth JSON.
 *
 * Fixtures live under `Reference Projects/cv-fixtures/` and are gitignored (dev-only), so this is
 * NOT part of `npm test` / CI — it skips gracefully when the fixtures are absent. Ground truth is
 * `groundtruth.json` in that same folder; when it's missing the harness instead DUMPS the
 * recognized gems (and writes `groundtruth.candidate.json`) so a human can validate and correct
 * them into the real ground truth.
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CV } from '@techstark/opencv-js';

import { getCv, initOpenCv } from '../src/lib/cv/cvRuntime';
import { type SpriteDecoder, loadGemAsset } from '../src/lib/cv/matStore';
import { recognizeGems } from '../src/lib/cv/recognize';
import { buildScaleLadder } from '../src/lib/cv/scaleDetection';
import type { CvMat } from '../src/lib/cv/types';

// jpeg-js and pngjs are CommonJS; load them via require so Node's ESM↔CJS named-export interop
// can't bite at runtime. jpeg-js ships types (typeof import); pngjs 3.x doesn't, so shape it inline.
const requireCjs = createRequire(import.meta.url);
const jpeg = requireCjs('jpeg-js') as typeof import('jpeg-js');
const { PNG } = requireCjs('pngjs') as {
  PNG: { sync: { read(buffer: Uint8Array): { width: number; height: number; data: Uint8Array } } };
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'public');
const fixturesDir = path.join(root, 'Reference Projects', 'cv-fixtures');
const groundTruthPath = path.join(fixturesDir, 'groundtruth.json');
const candidatePath = path.join(fixturesDir, 'groundtruth.candidate.json');

// Mirror the worker's recognition config (captureWorker.ts).
const THRESHOLDS = {
  anchor: 0.95,
  gemAttr: 0.8,
  gemImage: 0.8,
  willPower: 0.8,
  corePoint: 0.8,
  optionName: 0.8,
  optionLevel: 0.8,
};
const ANCHOR_SCALE_LADDER = buildScaleLadder(0.5, 2.5, 0.05);

/** Build a grayscale Mat from raw RGBA bytes (jpeg-js / pngjs output). opencv-js's ImageData takes
 *  any ArrayBufferView for `data`, so the decoders' Uint8Array/Buffer can be passed straight in. */
function grayFromRGBA(cv: CV, data: Uint8Array, width: number, height: number): CvMat {
  const mat = cv.matFromImageData({ data, width, height });
  cv.cvtColor(mat, mat, cv.COLOR_RGBA2GRAY);
  return mat;
}

/** Node sprite decoder: read a PNG sprite from public/ and grayscale it (replaces the browser fetch). */
const nodeSpriteDecoder: SpriteDecoder = async (fileName) => {
  const buf = fs.readFileSync(path.join(publicDir, fileName));
  const png = PNG.sync.read(buf);
  return grayFromRGBA(getCv(), png.data, png.width, png.height);
};

function decodeFixtureToGray(cv: CV, file: string): CvMat {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
  return grayFromRGBA(cv, raw.data, raw.width, raw.height);
}

// ---- Ground-truth scoring -------------------------------------------------------------------

type GemOption = { optionType: string; value: number };
interface ExpectedGem {
  name?: string;
  gemAttr: string;
  req: number;
  point: number;
  option1: GemOption;
  option2: GemOption;
}
interface ExpectedFixture {
  gemAttr: string;
  gems: ExpectedGem[];
}
type GroundTruth = Record<string, ExpectedFixture>;

// The 7 per-gem fields scored (name, willpower req, point, both options' type + level).
function gemFieldMatches(a: ExpectedGem | undefined, b: ExpectedGem | undefined): boolean[] {
  return [
    a?.name === b?.name,
    a?.req === b?.req,
    a?.point === b?.point,
    a?.option1.optionType === b?.option1.optionType,
    a?.option1.value === b?.option1.value,
    a?.option2.optionType === b?.option2.optionType,
    a?.option2.value === b?.option2.value,
  ];
}

function fmtGem(g: ExpectedGem): string {
  const o = (opt: GemOption) => `${opt.optionType}+${opt.value}`;
  return `${(g.name ?? '?').padEnd(28)} req=${g.req} pt=${g.point}  ${o(g.option1).padEnd(18)} ${o(g.option2)}`;
}

function pct(num: number, den: number): string {
  return den === 0 ? '  n/a ' : `${((100 * num) / den).toFixed(1)}%`.padStart(6);
}

async function main(): Promise<void> {
  if (!fs.existsSync(fixturesDir)) {
    console.log(`cv-accuracy: no fixtures at ${path.relative(root, fixturesDir)} — skipping (dev-only).`);
    process.exit(0);
  }

  await initOpenCv();
  const cv = getCv();
  const asset = await loadGemAsset(nodeSpriteDecoder);

  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort();
  if (files.length === 0) {
    console.log('cv-accuracy: fixtures folder has no .jpg images — nothing to do.');
    process.exit(0);
  }

  // Recognize every fixture (key = base name without extension).
  const recognized: Record<string, ExpectedFixture> = {};
  for (const file of files) {
    const key = file.replace(/\.[^.]+$/, '');
    const gray = decodeFixtureToGray(cv, path.join(fixturesDir, file));
    try {
      const result = recognizeGems(cv, gray, asset, {
        thresholds: THRESHOLDS,
        anchorScaleLadder: ANCHOR_SCALE_LADDER,
      });
      recognized[key] = result
        ? {
            gemAttr: result.gemAttr,
            gems: result.gems.map((g) => ({
              name: g.name,
              gemAttr: g.gemAttr,
              req: g.req,
              point: g.point,
              option1: { optionType: g.option1.optionType, value: g.option1.value },
              option2: { optionType: g.option2.optionType, value: g.option2.value },
            })),
          }
        : { gemAttr: '(none)', gems: [] };
    } finally {
      gray.delete();
    }
  }

  const groundTruth: GroundTruth | null = fs.existsSync(groundTruthPath)
    ? (JSON.parse(fs.readFileSync(groundTruthPath, 'utf8')) as GroundTruth)
    : null;

  if (!groundTruth) {
    // No ground truth yet: dump recognized gems for human validation and write a candidate file.
    console.log('\nNo ground truth found. Recognized gems per fixture (validate these):\n');
    for (const key of Object.keys(recognized)) {
      const r = recognized[key];
      console.log(`=== ${key} === attr=${r.gemAttr} gems=${r.gems.length}`);
      r.gems.forEach((g, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmtGem(g)}`));
      console.log('');
    }
    fs.writeFileSync(candidatePath, JSON.stringify(recognized, null, 2));
    console.log(
      `Wrote candidate ground truth to ${path.relative(root, candidatePath)}.\n` +
        `Validate/correct it, then rename to groundtruth.json to enable scoring.`
    );
    process.exit(0);
  }

  // Score against ground truth.
  console.log('\nCV recognition accuracy\n');
  console.log(
    `${'Fixture'.padEnd(14)} ${'attr'.padEnd(5)} ${'gems'.padEnd(7)} ${'fields'.padEnd(13)} exact`
  );
  console.log('-'.repeat(56));

  let totFieldsOk = 0;
  let totFields = 0;
  let totExact = 0;
  let totExpectedGems = 0;

  for (const key of Object.keys(groundTruth)) {
    const exp = groundTruth[key];
    const rec = recognized[key] ?? { gemAttr: '(missing)', gems: [] };

    let fieldsOk = 0;
    let fields = 1; // the fixture-level gemAttr
    const attrOk = rec.gemAttr === exp.gemAttr;
    if (attrOk) fieldsOk++;

    let exact = 0;
    for (let i = 0; i < exp.gems.length; i++) {
      const matches = gemFieldMatches(exp.gems[i], rec.gems[i]);
      fields += matches.length;
      const okCount = matches.filter(Boolean).length;
      fieldsOk += okCount;
      if (okCount === matches.length) exact++;
    }

    totFieldsOk += fieldsOk;
    totFields += fields;
    totExact += exact;
    totExpectedGems += exp.gems.length;

    console.log(
      `${key.padEnd(14)} ${(attrOk ? 'ok' : 'X').padEnd(5)} ` +
        `${`${rec.gems.length}/${exp.gems.length}`.padEnd(7)} ` +
        `${`${fieldsOk}/${fields} ${pct(fieldsOk, fields)}`.padEnd(13)} ` +
        `${exact}/${exp.gems.length}`
    );
  }

  console.log('-'.repeat(56));
  console.log(
    `${'TOTAL'.padEnd(14)} ${''.padEnd(5)} ${''.padEnd(7)} ` +
      `${`${totFieldsOk}/${totFields} ${pct(totFieldsOk, totFields)}`.padEnd(13)} ` +
      `${totExact}/${totExpectedGems}`
  );
  console.log(
    `\nField accuracy ${pct(totFieldsOk, totFields).trim()}, ` +
      `exact-gem accuracy ${pct(totExact, totExpectedGems).trim()} (${totExact}/${totExpectedGems}).`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('cv-accuracy crashed:', e);
  process.exit(1);
});
