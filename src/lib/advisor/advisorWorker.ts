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
import dpSrc from './vendor/model/dp.js?raw';
import nestedSrc from './vendor/model/nested.js?raw';
import engineSrc from './vendor/ocr/engine.js?raw';
import glyphsSrc from './vendor/ocr/glyphs.js?raw';
import layoutSrc from './vendor/ocr/layout.js?raw';
import levelRefsSrc from './vendor/ocr/level-refs.js?raw';
import structuralSrc from './vendor/ocr/structural-engine.js?raw';
import tessEngineSrc from './vendor/ocr/tesseract-engine.js?raw';
import { isGreyCharge, type PanelRect } from './chargeDetect';

const globalEval: (src: string) => void = eval; // indirect eval -> global scope
// astrogem first (Astrogem), then nested + dp (the decision engine reads Astrogem + AstrogemNested),
// then the ocr stack (engine reads Astrogem; structural-engine reads all the others off self).
for (const src of [
  astrogemSrc,
  nestedSrc,
  dpSrc,
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

interface DpAction {
  name: string;
  value: number;
  expectedScore: number;
  expectedCost: number;
  aboveBaselineOdds: number;
  description: string;
}
interface DpAdvice {
  bestAction: string;
  allActions: DpAction[];
  currentValue: number;
  resetCost: number | null;
}
const g = self as unknown as {
  OcrStructuralEngine?: { parseStructural: (r: Raster, f: unknown) => Promise<ParsedState> };
  OcrEngineAPI?: { constraintSnap: (raw: ParsedState) => ParsedState };
  OcrLayout?: { panelOrWhole: (r: Raster) => { rect?: { w?: number } } | null };
  AstrogemDP?: {
    evaluateActionsDP: (
      state: unknown,
      baseline: number,
      gpd: number,
      numRuns: number,
      onProgress: unknown,
      opts: { axis: string }
    ) => DpAdvice;
  };
  Astrogem?: {
    gradeToScore: (grade: number, baseCost?: number) => number;
    supportGradeToScore: (grade: number) => number;
  };
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
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

// Reuse one CPU-backed canvas across parses. The shared frame is the same size every parse, so this
// avoids reallocating a full-frame canvas each time, and willReadFrequently keeps the canvas in CPU
// memory so the getImageData readback (~15MB on a 1440p frame) skips the slow GPU->CPU round-trip that
// otherwise dominates parse time.
let _rasterCanvas: OffscreenCanvas | null = null;
let _rasterCtx: OffscreenCanvasRenderingContext2D | null = null;
async function rasterFromBitmap(bitmap: ImageBitmap): Promise<Raster> {
  const w = bitmap.width;
  const h = bitmap.height;
  if (!_rasterCanvas || _rasterCanvas.width !== w || _rasterCanvas.height !== h) {
    _rasterCanvas = new OffscreenCanvas(w, h);
    _rasterCtx = _rasterCanvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = _rasterCtx!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  return { width: img.width, height: img.height, data: img.data };
}

// Rank the four actions for a parsed gem. constraintSnap returns { config, state, outcomes }; the DP
// wants that flattened (config + turn state + outcomes on one object). The baseline arrives as a 0-100
// GRADE and is converted to the DP's gemValue-scale threshold here via the vendored gradeToScore
// (single source of truth). Returns null when no baseline grade / gpd was supplied or the engine
// isn't wired.
function adviseFrom(
  snapped: { config: unknown; state: Record<string, unknown>; outcomes: unknown },
  baselineGrade: number | undefined,
  gpd: number | undefined,
  axis: string | undefined
): DpAdvice | null {
  const evaluate = g.AstrogemDP?.evaluateActionsDP;
  const A = g.Astrogem;
  if (!evaluate || !A || baselineGrade == null || gpd == null) return null;
  const isSupport = axis === 'support';
  const baseline = isSupport ? A.supportGradeToScore(baselineGrade) : A.gradeToScore(baselineGrade);
  const dpState = { config: snapped.config, ...snapped.state, outcomes: snapped.outcomes };
  return evaluate(dpState, baseline, gpd, 1, null, { axis: isSupport ? 'support' : 'dps' });
}

/**
 * Carry the Processing window's on-screen width out with the parse.
 *
 * How many pixels that window occupies is the single best predictor of how well it reads: measured on
 * one machine, the same client scores 97.7% of fields with a ~925px panel and 95.5% with a ~677px one,
 * because the game's Force 21:9 setting letterboxes the UI and shrinks every glyph with it. Surfacing
 * the number lets the UI say so instead of the user discovering it the hard way.
 *
 * Measured by locating the panel on the ORIGINAL raster. The parser's own debug channel is not usable
 * for this: it stores the rect AFTER a wheel-fit and scale normalisation, so the same 677px window
 * comes back as ~1354 there. Best-effort — wrapped so a shape change upstream costs the note, not the
 * parse.
 */
function attachPanelSize(raster: Raster, snapped: Record<string, unknown>) {
  try {
    const w = g.OcrLayout?.panelOrWhole(raster)?.rect?.w;
    if (typeof w === 'number' && w > 0) snapped.panelWidth = Math.round(w);
  } catch {
    // diagnostic only; never fail a parse over it
  }
}

// Grey-Charge rescue (pixel channel): the vendored parser reads the gold "Charge" button but misses the
// dim all-spent grey one, then constraintSnap defaults the unread reroll count to FULL. Step in ONLY
// when the parser failed to read the reroll (no pill, no bright Charge) AND we're past turn 1 (a fresh
// turn-1 gem legitimately has full rerolls) AND the pixel detector confirms the grey Charge -> force the
// reroll count to 0 so the DP does not offer a free reroll that no longer exists.
function applyGreyChargeRescue(
  raster: Raster,
  raw: Record<string, unknown>,
  snappedState: Record<string, unknown>
): void {
  const panel = raw._srcPanel as PanelRect | undefined;
  if (!panel) return;
  const rawState = (raw.state ?? {}) as Record<string, unknown>;
  if (rawState.rerollsShownFree != null || rawState.rerollsChargeSeen) return;
  if (((snappedState.currentTurn as number) ?? 1) <= 1) return;
  if (isGreyCharge(raster, panel)) snappedState.rerollsRemaining = 0;
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
      const snapped = constraintSnap(raw) as { config: unknown; state: Record<string, unknown>; outcomes: unknown };
      applyGreyChargeRescue(raster, raw as Record<string, unknown>, snapped.state);
      attachPanelSize(raster, snapped as Record<string, unknown>);
      const advice = adviseFrom(snapped, msg.baselineGrade, msg.gpd, msg.axis);
      self.postMessage({ type: 'parse:done', id: msg.id, result: snapped, advice });
    } catch (e) {
      console.error('[advisor] parse failed:', (e as Error)?.stack ?? e);
      self.postMessage({ type: 'parse:done', id: msg.id, error: String((e as Error)?.message ?? e) });
    }
    return;
  }
  // Manual-edit path: no image, just a human-corrected state run through the same constraintSnap +
  // DP the parser uses. Responds on the SAME parse:done channel the controller already awaits.
  if (msg.type === 'advise') {
    try {
      const constraintSnap = getConstraintSnap();
      if (!constraintSnap) throw new Error('parser stack not wired');
      const snapped = constraintSnap({
        config: msg.config,
        state: msg.state,
        outcomes: msg.outcomes,
        rarity: msg.rarity,
      }) as { config: unknown; state: Record<string, unknown>; outcomes: unknown };
      const advice = adviseFrom(snapped, msg.baselineGrade, msg.gpd, msg.axis);
      self.postMessage({ type: 'parse:done', id: msg.id, result: snapped, advice });
    } catch (e) {
      console.error('[advisor] advise failed:', (e as Error)?.stack ?? e);
      self.postMessage({ type: 'parse:done', id: msg.id, error: String((e as Error)?.message ?? e) });
    }
    return;
  }
};
