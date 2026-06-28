/**
 * OCR recognition accuracy harness — dev-only, `npm run test:cv-ocr` (tsx/Node).
 *
 * Runs the client-AGNOSTIC OCR path (recognizeOcr.ts) on real screenshots from TWO clients:
 *  - `Reference Projects/cv-fixtures/` (client 1) scored against its independent `groundtruth.json`,
 *  - `Reference Projects/Test shots/` (client 2 — the user's own client that template-matching failed
 *    on) dumped for review (+ scored against `groundtruth.json` there if present).
 * Skips gracefully when fixtures are absent. tesseract.js runs fully in Node (no backend).
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CV } from '@techstark/opencv-js';

import { getCv, initOpenCv } from '../src/lib/cv/cvRuntime';
import { loadGemAsset, type SpriteDecoder } from '../src/lib/cv/matStore';
import { recognizeGemsOcr, type OcrResult, type OcrRunner } from '../src/lib/cv/recognizeOcr';
import { buildScaleLadder } from '../src/lib/cv/scaleDetection';
import type { CvMat } from '../src/lib/cv/types';

const requireCjs = createRequire(import.meta.url);
const jpeg = requireCjs('jpeg-js') as typeof import('jpeg-js');
const { PNG } = requireCjs('pngjs') as {
  PNG: {
    new (o: { width: number; height: number }): { data: Buffer };
    sync: { read(b: Uint8Array): { width: number; height: number; data: Uint8Array }; write(p: unknown): Buffer };
  };
};
const { createWorker, PSM } = requireCjs('tesseract.js') as typeof import('tesseract.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const publicDir = path.join(root, 'public');
const LADDER = buildScaleLadder(0.5, 2.5, 0.05);

function grayFromRGBA(cv: CV, data: Uint8Array, w: number, h: number): CvMat {
  const m = cv.matFromImageData({ data, width: w, height: h });
  cv.cvtColor(m, m, cv.COLOR_RGBA2GRAY);
  return m;
}
const nodeSpriteDecoder: SpriteDecoder = async (f) => {
  const p = PNG.sync.read(fs.readFileSync(path.join(publicDir, f)));
  return grayFromRGBA(getCv(), p.data, p.width, p.height);
};
function decodeGray(cv: CV, file: string): CvMat {
  const raw = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true });
  return grayFromRGBA(cv, raw.data, raw.width, raw.height);
}

// Encode a CV_8UC1 Mat to a PNG Buffer for tesseract. ucharAt(y,x) (Mat.data is unreliable on ROIs).
function matToPng(mat: CvMat): Buffer {
  const png = new PNG({ width: mat.cols, height: mat.rows });
  for (let y = 0; y < mat.rows; y++) {
    for (let x = 0; x < mat.cols; x++) {
      const v = (mat as unknown as { ucharAt(r: number, c: number): number }).ucharAt(y, x);
      const idx = (y * mat.cols + x) * 4;
      png.data[idx] = v;
      png.data[idx + 1] = v;
      png.data[idx + 2] = v;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

// Node OcrRunner: one reused tesseract worker; renders the Mat to a PNG buffer; returns line bboxes.
class NodeOcrRunner implements OcrRunner {
  private worker!: Awaited<ReturnType<typeof createWorker>>;
  private psmMap: Record<number, (typeof PSM)[keyof typeof PSM]> = {
    6: PSM.SINGLE_BLOCK,
    7: PSM.SINGLE_LINE,
    10: PSM.SINGLE_CHAR,
  };
  async init() {
    this.worker = await createWorker('eng');
  }
  async terminate() {
    await this.worker.terminate();
  }
  async recognizeMat(mat: CvMat, opts: { psm: number; whitelist?: string }): Promise<OcrResult> {
    await this.worker.setParameters({
      tessedit_pageseg_mode: this.psmMap[opts.psm] ?? PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: opts.whitelist ?? '',
    });
    const png = matToPng(mat);
    const { data } = await this.worker.recognize(png, {}, { blocks: true });
    const lines: OcrResult['lines'] = [];
    for (const b of (data.blocks ?? []) as any[])
      for (const p of b.paragraphs ?? [])
        for (const l of p.lines ?? []) lines.push({ text: String(l.text).trim(), cy: (l.bbox.y0 + l.bbox.y1) / 2 });
    return { text: data.text.trim(), lines };
  }
}

type GemOption = { optionType: string; value: number };
interface ExpectedGem {
  name?: string;
  gemAttr: string;
  req: number;
  point: number;
  option1: GemOption;
  option2: GemOption;
}
type GroundTruth = Record<string, { gemAttr: string; gems: ExpectedGem[] }>;

function gemFields(a: ExpectedGem | undefined, b: ExpectedGem | undefined): boolean[] {
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
const fmt = (g: ExpectedGem) =>
  `${(g.name ?? '?').replace('Astrogem: ', '').padEnd(20)} req=${g.req} pt=${g.point}  ${g.option1.optionType}+${g.option1.value} / ${g.option2.optionType}+${g.option2.value}`;

async function recognizeDir(cv: CV, asset: Awaited<ReturnType<typeof loadGemAsset>>, ocr: OcrRunner, dir: string) {
  const out: Record<string, { gemAttr: string; gems: ExpectedGem[] }> = {};
  const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  for (const file of files) {
    const gray = decodeGray(cv, path.join(dir, file));
    try {
      const dbg = process.env.OCR_DEBUG ? (m: string) => console.error(`[${file}] ${m}`) : undefined;
      const r = await recognizeGemsOcr(cv, gray, asset, ocr, { anchorScaleLadder: LADDER, debug: dbg });
      out[file.replace(/\.[^.]+$/, '')] = r
        ? { gemAttr: r.gemAttr, gems: r.gems.map((g) => ({ name: g.name, gemAttr: g.gemAttr, req: g.req, point: g.point, option1: g.option1, option2: g.option2 })) }
        : { gemAttr: '(none)', gems: [] };
    } finally {
      gray.delete();
    }
  }
  return out;
}

function score(label: string, recognized: Record<string, { gemAttr: string; gems: ExpectedGem[] }>, gt: GroundTruth) {
  console.log(`\n=== ${label} (scored vs ground truth) ===`);
  console.log(`${'Fixture'.padEnd(14)} ${'attr'.padEnd(5)} ${'gems'.padEnd(7)} fields    exact`);
  let okF = 0, totF = 0, okE = 0, totG = 0;
  for (const key of Object.keys(gt)) {
    const exp = gt[key], rec = recognized[key] ?? { gemAttr: '(missing)', gems: [] };
    let f = 1, fo = rec.gemAttr === exp.gemAttr ? 1 : 0, ex = 0;
    for (let i = 0; i < exp.gems.length; i++) {
      const m = gemFields(exp.gems[i], rec.gems[i]);
      f += m.length; fo += m.filter(Boolean).length;
      if (m.every(Boolean)) ex++;
      else if (process.env.OCR_DEBUG) console.error(`  [${key} #${i}] exp ${fmt(exp.gems[i])} | got ${rec.gems[i] ? fmt(rec.gems[i]) : '(none)'}`);
    }
    okF += fo; totF += f; okE += ex; totG += exp.gems.length;
    console.log(`${key.padEnd(14)} ${(rec.gemAttr === exp.gemAttr ? 'ok' : 'X').padEnd(5)} ${`${rec.gems.length}/${exp.gems.length}`.padEnd(7)} ${`${fo}/${f}`.padEnd(9)} ${ex}/${exp.gems.length}`);
  }
  console.log(`TOTAL field ${((100 * okF) / totF).toFixed(1)}%  exact-gem ${okE}/${totG} (${((100 * okE) / totG).toFixed(1)}%)`);
}

function dump(label: string, recognized: Record<string, { gemAttr: string; gems: ExpectedGem[] }>) {
  console.log(`\n=== ${label} (recognized — review) ===`);
  for (const key of Object.keys(recognized)) {
    const r = recognized[key];
    console.log(`--- ${key}  attr=${r.gemAttr}  gems=${r.gems.length} ---`);
    r.gems.forEach((g, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(g)}`));
  }
}

async function main() {
  const fixturesDir = path.join(root, 'Reference Projects', 'cv-fixtures');
  const testDir = path.join(root, 'Reference Projects', 'Test shots');
  if (!fs.existsSync(fixturesDir) && !fs.existsSync(testDir)) {
    console.log('cv-ocr: no fixtures — skipping (dev-only).');
    process.exit(0);
  }
  await initOpenCv();
  const cv = getCv();
  const asset = await loadGemAsset(nodeSpriteDecoder);
  const ocr = new NodeOcrRunner();
  await ocr.init();
  try {
    if (fs.existsSync(fixturesDir)) {
      const rec = await recognizeDir(cv, asset, ocr, fixturesDir);
      const gtPath = path.join(fixturesDir, 'groundtruth.json');
      if (fs.existsSync(gtPath)) score('cv-fixtures (client 1)', rec, JSON.parse(fs.readFileSync(gtPath, 'utf8')) as GroundTruth);
      else dump('cv-fixtures (client 1)', rec);
    }
    if (fs.existsSync(testDir)) {
      const rec = await recognizeDir(cv, asset, ocr, testDir);
      const gtPath = path.join(testDir, 'groundtruth.json');
      if (fs.existsSync(gtPath)) score('Test shots (client 2 — user)', rec, JSON.parse(fs.readFileSync(gtPath, 'utf8')) as GroundTruth);
      dump('Test shots (client 2 — user)', rec);
    }
  } finally {
    await ocr.terminate();
  }
  process.exit(0);
}
main().catch((e) => {
  console.error('cv-ocr crashed:', e);
  process.exit(1);
});
