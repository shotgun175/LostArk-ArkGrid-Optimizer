// Build-time generator: parse the reference astrogem pipeline table (DPS Monte-Carlo
// output) into a compact JSON the app embeds. Re-run with: node scripts/extract-pipeline-table.cjs
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(
  __dirname,
  '..',
  'Reference Projects',
  'astrogem-pipeline-table-main',
  'index.html'
);
const OUT_PATH = path.join(__dirname, '..', 'src', 'lib', 'cutplan', 'pipelineTable.json');

const THRESHOLDS = ['500k', '1M', '1_5M', '2_5M', '3_5M', '5M', '7_5M', '10M'];
const BINDINGS = ['nrb', 'rb'];
const ARCHETYPES = ['UC8', 'UC9', 'UC10', 'R8', 'R9', 'R10', 'E8', 'E9', 'E10'];
const PIPE_KEYS = [
  'boxes',
  'boxEV',
  'directWk',
  'fuseWk',
  'totalWk',
  'weeks',
  'gold',
  'avgScore',
  'totalScore',
  'cpGain',
];

const html = fs.readFileSync(HTML_PATH, 'utf8');

function plainText(s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ') // before the tag strip, so multi-line cells keep a separator
    .replace(/<[^>]*>/g, '')
    .replace(/&minus;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&times;/g, 'x')
    .replace(/&divide;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&#8635;/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
function parsePct(s) {
  if (s == null) return null;
  const t = String(s).replace('%', '').trim();
  if (t === '' || t === '-') return null;
  const v = parseFloat(t);
  return Number.isNaN(v) ? null : v;
}
function parseGold(s) {
  if (s == null) return null;
  let t = String(s)
    .replace(/&minus;/g, '-')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (t === '' || t === '-') return null;
  let mult = 1;
  if (/k$/i.test(t)) {
    mult = 1e3;
    t = t.slice(0, -1);
  } else if (/M$/i.test(t)) {
    mult = 1e6;
    t = t.slice(0, -1);
  }
  const v = parseFloat(t);
  return Number.isNaN(v) ? null : Math.round(v * mult);
}
// Map a bucket-row's background color to its action (ports the reference tool's getActionClass).
function actionFromBg(styleAttr) {
  const bg = (styleAttr || '').toLowerCase().replace(/\s/g, '');
  if (bg.includes('#2d8a4e')) return 'cut-reset';
  if (bg.includes('#5a2020')) return 'dont-cut';
  if (bg.includes('#5b3a8c')) return 'fuse';
  return 'cut';
}
function splitTds(rowHtml) {
  const re = /<td\b([^>]*)>/gi;
  const opens = [];
  let m;
  while ((m = re.exec(rowHtml)) !== null) opens.push({ contentStart: re.lastIndex });
  return opens.map((o) => {
    const close = rowHtml.indexOf('</td>', o.contentStart);
    return rowHtml.slice(o.contentStart, close);
  });
}
function parseBucketCell(cellHtml) {
  const hdrM = cellHtml.match(/<div class="bkt-hdr">([^<]*)<\/div>/);
  const cell = { headerEV: parseGold(hdrM ? hdrM[1] : null), buckets: {} };
  const rows = [...cellHtml.matchAll(/<div class="bkt-row"([^>]*)>([\s\S]*?)<\/div>/g)];
  for (const rm of rows) {
    const attrs = rm[1];
    const inner = rm[2];
    const labelM = inner.match(/<span class="bkt-label">([^<]*)<\/span>/);
    if (!labelM) continue;
    const label = labelM[1].trim();
    const valM = inner.match(/<span class="bkt-val">([\s\S]*?)<\/span>/);
    const pctM = inner.match(/<span class="bkt-pct">([\s\S]*?)<\/span>/);
    const styleM = attrs.match(/style="([^"]*)"/);
    cell.buckets[label] = {
      goldEV: parseGold(valM ? plainText(valM[1]) : null),
      pct: parsePct(pctM ? plainText(pctM[1]) : null),
      action: actionFromBg(styleM ? styleM[1] : ''),
    };
  }
  return cell;
}
function extractTable(thr, binding) {
  const id = `tbl_${thr}_${binding}`;
  const idIdx = html.indexOf(`id="${id}"`);
  if (idIdx < 0) throw new Error(`table ${id} not found`);
  const tableHtml = html.slice(idIdx, html.indexOf('</table>', idIdx));
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => x[1]).slice(2);
  const out = [];
  for (const rowHtml of rows) {
    const tds = splitTds(rowHtml);
    if (tds.length < 20) continue;
    const baseline = parseInt(plainText(tds[0]), 10);
    if (Number.isNaN(baseline)) continue;
    const archetypes = {};
    for (let a = 0; a < 9; a++) archetypes[ARCHETYPES[a]] = parseBucketCell(tds[1 + a]);
    const pipeline = {};
    for (let i = 0; i < PIPE_KEYS.length; i++) pipeline[PIPE_KEYS[i]] = plainText(tds[10 + i]);
    out.push({ baseline, archetypes, pipeline });
  }
  return out;
}

const result = {};
for (const thr of THRESHOLDS) {
  result[thr] = {};
  for (const binding of BINDINGS) result[thr][binding] = extractTable(thr, binding);
}
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(result), 'utf8'); // minified
const bytes = fs.statSync(OUT_PATH).size;
console.log(`wrote ${OUT_PATH} (${(bytes / 1024).toFixed(0)} KB)`);
// Sanity: 500k nrb BL5 E8 must be 2D 45.1% / header 17100.
const e8 = result['500k']['nrb'].find((r) => r.baseline === 5).archetypes.E8;
console.log('sanity 500k/nrb/BL5/E8:', e8.headerEV, e8.buckets['2D']);
