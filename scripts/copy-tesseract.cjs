// Copies the tesseract.js runtime files the browser OCR needs into public/tesseract/, so the app
// serves them from its own origin instead of tesseract's default CDN (jsDelivr). Runs automatically
// before `npm run dev` and `npm run build` (predev / prebuild). public/tesseract/ is gitignored: the
// files come from lockfile-pinned packages, so the repo carries zero bytes of them and a tesseract
// upgrade only changes package-lock.json.
//
// What gets copied, and why only these four:
// - tesseract.js/dist/worker.min.js: the tesseract web worker script (workerPath).
// - tesseract.js-core/tesseract-core-simd-lstm.wasm.js and tesseract-core-lstm.wasm.js: the engine
//   (corePath). Both call sites use OEM 1 (LSTM only), so tesseract only ever picks one of these two,
//   by its own SIMD detection. The non-lstm cores are never selected.
// - @tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz: the English model (langPath). This is
//   the exact file tesseract.js 5 fetches for OEM 1; the package's 4.0.0 (legacy) model is not used.
//
// The worker files reference each other by URL, so the four files keep their published names.
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public', 'tesseract');

/** Find a package directory the way Node would when required from inside `fromDir`. */
function findPackageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) throw new Error(`copy-tesseract: cannot find ${name}`);
  }
}

// tesseract.js-core is tesseract.js's own dependency (not ours), so look it up from inside
// tesseract.js: that is the exact version tesseract.js loads. A directory walk instead of
// require.resolve keeps knip from reporting it as an unlisted dependency of this repo.
const tesseractDir = path.dirname(require.resolve('tesseract.js/package.json'));
const coreDir = findPackageDir('tesseract.js-core', tesseractDir);

const files = [
  path.join(tesseractDir, 'dist', 'worker.min.js'),
  path.join(coreDir, 'tesseract-core-simd-lstm.wasm.js'),
  path.join(coreDir, 'tesseract-core-lstm.wasm.js'),
  require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
];

fs.mkdirSync(outDir, { recursive: true });
for (const src of files) {
  const dest = path.join(outDir, path.basename(src));
  fs.copyFileSync(src, dest);
  console.log(`tesseract asset: ${path.relative(process.cwd(), dest)}`);
}
