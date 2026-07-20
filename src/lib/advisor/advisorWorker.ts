// Cut Advisor parse worker. Follows the CV captureWorker footprint (module worker, lazy tesseract,
// zero-copy image transfer) but runs shizukaziye's vendored STRUCTURAL parser in place of our OpenCV
// template matcher. His parseStructural is environment-agnostic: a raw RGBA raster in, plus an
// injected async ocrFn(raster, {psm, whitelist}) -> {text, conf} — the same injection contract our
// recognize.ts uses. No OpenCV here; the advisor stack is tesseract + plain pixel math only.
//
// The vendored ocr/ files are guarded-IIFE UMD. Letting the bundler import them fails both ways:
// Rollup can't see the CommonJS exports statically (they sit behind `typeof module !== "undefined"`),
// yet its commonjs interop half-defines `module`, which flips the files into their Node branch and
// calls a `require()` that does not exist in the worker (ReferenceError at runtime). So instead we
// pull each file in as RAW TEXT (?raw, byte-identical to the frozen source) and execute it with an
// INDIRECT eval, which runs in the worker's global scope. There `module` is genuinely undefined, so
// every IIFE takes its browser branch and attaches its API to `self` (OcrStructuralEngine,
// OcrEngineAPI, OcrLayout, ...) — no bundler CJS transform, no require path. Load order is
// load-bearing: astrogem (Astrogem) first, then engine / layout / tesseract-engine / glyphs /
// level-refs, then structural-engine which reads all of them off `self`.
import astrogemSrc from './vendor/model/astrogem.js?raw';
import engineSrc from './vendor/ocr/engine.js?raw';
import glyphsSrc from './vendor/ocr/glyphs.js?raw';
import layoutSrc from './vendor/ocr/layout.js?raw';
import levelRefsSrc from './vendor/ocr/level-refs.js?raw';
import structuralSrc from './vendor/ocr/structural-engine.js?raw';
import tessEngineSrc from './vendor/ocr/tesseract-engine.js?raw';

const globalEval: (src: string) => void = eval; // indirect eval -> global scope
for (const src of [
  astrogemSrc,
  engineSrc,
  layoutSrc,
  tessEngineSrc,
  glyphsSrc,
  levelRefsSrc,
  structuralSrc,
]) {
  globalEval(src);
}

interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
interface OcrOpts {
  psm?: number;
  whitelist?: string;
}
type ParsedState = Record<string, unknown>;

const g = self as unknown as {
  OcrStructuralEngine?: { parseStructural: (r: Raster, f: unknown) => Promise<ParsedState> };
  OcrEngineAPI?: { constraintSnap: (raw: ParsedState) => ParsedState };
};
// Resolved lazily (on first use) so it never matters whether the side-effect imports finished
// attaching to `self` before this module's top-level ran.
const getParseStructural = () => g.OcrStructuralEngine?.parseStructural;
const getConstraintSnap = () => g.OcrEngineAPI?.constraintSnap;

// ---- lazy tesseract (single instance; parameter-affinity cache like the CV OCR path) ----
let _tess: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;
let _tessParams = '';
async function getTess() {
  if (_tess) return _tess;
  const T = await import('tesseract.js');
  _tess = await T.createWorker('eng', 1, { logger: () => {} });
  return _tess;
}
async function ocrFn(raster: Raster, opts: OcrOpts): Promise<{ text: string; conf: number }> {
  const psm = String(opts?.psm ?? 6);
  const wl = opts?.whitelist ?? '';
  const key = psm + '|' + wl;
  try {
    const w = await getTess();
    if (_tessParams !== key) {
      await w.setParameters({
        tessedit_pageseg_mode: psm as never,
        user_defined_dpi: '150',
        tessedit_char_whitelist: wl,
      });
      _tessParams = key;
    }
    // tesseract.js (v5) reads a canvas reliably; a raw ImageData throws "Error attempting to read
    // image" in the worker. Render the injected raster onto an OffscreenCanvas first (same as the CV
    // OCR path in captureWorker's BrowserOcrRunner).
    const canvas = new OffscreenCanvas(raster.width, raster.height);
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
    const res = await w.recognize(canvas);
    return { text: res?.data?.text ?? '', conf: (res?.data?.confidence ?? 40) / 100 };
  } catch {
    // A dead tesseract instance resolves as an empty read; drop it so the next call rebuilds.
    _tess = null;
    _tessParams = '';
    return { text: '', conf: 0 };
  }
}

async function rasterFromBitmap(bitmap: ImageBitmap): Promise<Raster> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    self.postMessage({ type: 'init:done', ok: !!(getParseStructural() && getConstraintSnap()) });
    return;
  }
  if (msg.type === 'parse') {
    try {
      const parseStructural = getParseStructural();
      const constraintSnap = getConstraintSnap();
      if (!parseStructural || !constraintSnap) throw new Error('parser stack not wired');
      const raster = await rasterFromBitmap(msg.bitmap as ImageBitmap);
      const raw = await parseStructural(raster, ocrFn);
      const snapped = constraintSnap(raw);
      self.postMessage({ type: 'parse:done', id: msg.id, result: snapped });
    } catch (e) {
      console.error('[advisor] parse failed:', (e as Error)?.stack ?? e);
      self.postMessage({ type: 'parse:done', id: msg.id, error: String((e as Error)?.message ?? e) });
    }
  }
};
