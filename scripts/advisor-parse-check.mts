/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- loads untyped vendored .js via require; dev diagnostic only
/*
 * Dev-only diagnostic (NOT shipped, NOT a CI gate): run the vendored structural parser on a captured
 * advisor frame the same way the worker does, and print per-field values + confidence + the raw OCR
 * each micro-call returned. Used to reproduce the live-frame misreads and pin whether the OCR channel
 * is failing (self-heal degrade) or the values come out of the template/scale channels.
 *
 * Usage:  npx tsx scripts/advisor-parse-check.mts "Reference Projects/advisor-fixtures/<file>.png" [--verbose]
 *
 * Mirrors advisorWorker.ts: rasterFromBitmap -> parseStructural(raster, ocrFn) -> constraintSnap, with
 * the SAME tesseract params (psm/whitelist/user_defined_dpi=150). The fixture PNG is exactly the raster
 * the worker fed the parser (the frame dump draws the same bitmap), so structural/template reads here
 * match the browser worker bit-for-bit; only the tesseract-fed OCR channel can differ slightly.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const engineApi = require('../src/lib/advisor/vendor/ocr/engine.js');
const structural = require('../src/lib/advisor/vendor/ocr/structural-engine.js');

const fixture =
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'Reference Projects/advisor-fixtures/chaos-corrosion-support-2of9.png';
const VERBOSE = process.argv.includes('--verbose');

function loadRaster(path: string) {
  const png = PNG.sync.read(readFileSync(path));
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}

let worker: any = null;
async function getWorker() {
  if (!worker) worker = await createWorker('eng', 1, { logger: () => {} });
  return worker;
}
let q: Promise<any> = Promise.resolve();
let ocrCalls = 0;
function nodeOcr(raster: any, opts: any) {
  q = q.then(async () => {
    ocrCalls++;
    const w = await getWorker();
    await w
      .setParameters({
        tessedit_pageseg_mode: String(opts?.psm ?? 6),
        tessedit_char_whitelist: opts?.whitelist ?? '',
        user_defined_dpi: '150',
      })
      .catch(() => {});
    const png = new PNG({ width: raster.width, height: raster.height });
    png.data = Buffer.from(raster.data.buffer, raster.data.byteOffset ?? 0, raster.data.byteLength);
    const res = await w.recognize(PNG.sync.write(png));
    const out = { text: res.data?.text ?? '', conf: (res.data?.confidence ?? 40) / 100 };
    if (VERBOSE)
      console.log(
        `  ocr#${String(ocrCalls).padStart(2)} psm=${opts?.psm ?? 6} wl="${(opts?.whitelist ?? '').slice(0, 24)}" ${raster.width}x${raster.height} -> "${out.text.replace(/\s+/g, ' ').trim()}" (${out.conf.toFixed(2)})`
      );
    return out;
  });
  return q;
}

console.log('=== advisor parse check:', fixture, '===');
const raster = loadRaster(fixture);
console.log(`frame ${raster.width}x${raster.height}`);
const raw = await structural.parseStructural(raster, nodeOcr);
const snapped = engineApi.constraintSnap(raw);
console.log('\n--- RAW parse (pre-snap, with confidence) ---');
console.log(JSON.stringify(raw, null, 2));
console.log('\n--- SNAPPED (legal state) ---');
console.log(JSON.stringify(snapped, null, 2));
console.log(`\n--- total OCR micro-calls: ${ocrCalls} ---`);
if (worker) await worker.terminate();
