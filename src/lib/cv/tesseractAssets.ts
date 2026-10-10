/**
 * Self-hosted tesseract.js asset locations, shared by both OCR workers (captureWorker for screenshot
 * upload, advisorWorker for the Cut Advisor). Without these options tesseract.js 5 fetches its worker,
 * wasm core and English model from cdn.jsdelivr.net; the model URL there is unversioned, so a republish
 * would silently change OCR for every user. `scripts/copy-tesseract.cjs` (predev / prebuild) copies the
 * lockfile-pinned files into `public/tesseract/`, which Vite serves under the app's base path.
 *
 * All three paths must be absolute. Inside a Web Worker tesseract.js passes them through unresolved,
 * and it loads workerPath through a blob: URL wrapper whose importScripts cannot resolve a relative
 * URL. corePath stays a directory so tesseract's own SIMD detection still picks between the SIMD and
 * non-SIMD LSTM cores.
 *
 * Worker-only: reads `self.location` (the worker script URL) and `import.meta.env`, so Node tooling
 * must not import it.
 */
export function tesseractAssetOptions(): {
  workerPath: string;
  corePath: string;
  langPath: string;
} {
  const base = new URL(import.meta.env.BASE_URL + 'tesseract/', self.location.href).href;
  return { workerPath: base + 'worker.min.js', corePath: base, langPath: base };
}
