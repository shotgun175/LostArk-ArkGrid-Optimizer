// Build-time generator: run the validated gem-processing simulator under SUPPORT coeffs to
// produce single-cut P(score > baseline) per archetype/bucket/baseline. Re-run with:
//   npm run generate:support-cutquality   (tsx scripts/generate-support-cutquality.mts)
// Self-validates against per-bucket score ceilings; throws if any is exceeded.
//
// Coefficients, scoring steps, and gem option pools are IMPORTED from the app
// (src/lib/scoring/gemScore.ts, src/lib/models/arkGridGems.ts) so the committed
// table cannot silently drift from what the app scores with. CI regenerates this
// table and diffs it (see .github/workflows/ci.yml).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ArkGridGemOptionName, ArkGridGemSpecs } from '../src/lib/models/arkGridGemSpecs';
import {
  POINT_NEUTRAL,
  POINT_STEP,
  SUPPORT_NODE_COEFF,
  WILLPOWER_NEUTRAL,
  WILLPOWER_STEP,
} from '../src/lib/scoring/gemScore';

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'cutplan',
  'supportCutQuality.json'
);

const SUP = SUPPORT_NODE_COEFF;

// Option pools per willpower cost, derived from the app's gem specs (Order and
// Chaos share pools per cost; verified below so a future divergence is loud).
const POOLS: Record<number, ArkGridGemOptionName[]> = {};
for (const spec of Object.values(ArkGridGemSpecs)) {
  const existing = POOLS[spec.req];
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(spec.availableOptions)) {
      throw new Error(`gem option pools diverged for req ${spec.req}; update bucketing logic`);
    }
  } else {
    POOLS[spec.req] = [...spec.availableOptions];
  }
}

const TURNS: Record<string, number> = { UC: 5, R: 7, E: 9 };
const ARCH: [string, number][] = [
  ['UC', 8],
  ['UC', 9],
  ['UC', 10],
  ['R', 8],
  ['R', 9],
  ['R', 10],
  ['E', 8],
  ['E', 9],
  ['E', 10],
];
const ARCH_KEYS = ['UC8', 'UC9', 'UC10', 'R8', 'R9', 'R10', 'E8', 'E9', 'E10'];
// (kind, delta, weight). Official Stove odds. 4 shown per round (+more).
type Ev = [string, number, number];
const EVENTS: Ev[] = [
  ['we', 1, 11.65],
  ['we', 2, 4.4],
  ['we', 3, 1.75],
  ['we', 4, 0.45],
  ['we', -1, 3.0],
  ['pt', 1, 11.65],
  ['pt', 2, 4.4],
  ['pt', 3, 1.75],
  ['pt', 4, 0.45],
  ['pt', -1, 3.0],
  ['lv1', 1, 11.65],
  ['lv2', 1, 11.65],
  ['chg1', 0, 3.25],
  ['chg2', 0, 3.25],
  // 'cost' events only change gold cost (not the gem's stats), so they are intentional score no-ops here.
  ['cost', 100, 1.75],
  ['cost', -100, 1.75],
  ['cost', 0, 1.75],
  ['more', 1, 2.5],
  ['more', 2, 0.75],
];
const [REQ_MIN, REQ_MAX, PT_MIN, PT_MAX, LV_MAX] = [3, 9, 1, 5, 5];

// Deterministic RNG (mulberry32) so the committed data is reproducible.
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rnd = () => number;
type Coeffs = Record<ArkGridGemOptionName, number>;
type GemState = {
  req: number;
  pt: number;
  lv1: number;
  lv2: number;
  o1: ArkGridGemOptionName;
  o2: ArkGridGemOptionName;
  more: number;
  pool: ArkGridGemOptionName[];
};

const wTerm = (req: number) => (WILLPOWER_NEUTRAL - req) * WILLPOWER_STEP;
const pTerm = (pt: number) => (pt - POINT_NEUTRAL) * POINT_STEP;
const scoreState = (s: GemState, c: Coeffs) =>
  wTerm(s.req) + pTerm(s.pt) + c[s.o1] * s.lv1 + c[s.o2] * s.lv2;

function seed(cost: number, rnd: Rnd): GemState {
  const pool = POOLS[cost];
  const o1 = pool[Math.floor(rnd() * 4)];
  let o2 = pool[Math.floor(rnd() * 4)];
  while (o2 === o1) o2 = pool[Math.floor(rnd() * 4)];
  return { req: cost, pt: 1, lv1: 1, lv2: 1, o1, o2, more: 0, pool };
}
function gain(s: GemState, ev: Ev, c: Coeffs): number {
  const [k, d] = ev;
  if (k === 'we') return wTerm(Math.min(REQ_MAX, Math.max(REQ_MIN, s.req - d))) - wTerm(s.req);
  if (k === 'pt') return pTerm(Math.min(PT_MAX, Math.max(PT_MIN, s.pt + d))) - pTerm(s.pt);
  if (k === 'lv1') return c[s.o1] * (Math.min(LV_MAX, s.lv1 + 1) - s.lv1);
  if (k === 'lv2') return c[s.o2] * (Math.min(LV_MAX, s.lv2 + 1) - s.lv2);
  if (k === 'chg1') {
    const o = s.pool.filter((x) => x !== s.o2);
    return (o.reduce((a, x) => a + c[x], 0) / o.length - c[s.o1]) * s.lv1;
  }
  if (k === 'chg2') {
    const o = s.pool.filter((x) => x !== s.o1);
    return (o.reduce((a, x) => a + c[x], 0) / o.length - c[s.o2]) * s.lv2;
  }
  return 0;
}
function apply(s: GemState, ev: Ev, rnd: Rnd) {
  const [k, d] = ev;
  if (k === 'we') s.req = Math.min(REQ_MAX, Math.max(REQ_MIN, s.req - d));
  else if (k === 'pt') s.pt = Math.min(PT_MAX, Math.max(PT_MIN, s.pt + d));
  else if (k === 'lv1') s.lv1 = Math.min(LV_MAX, s.lv1 + 1);
  else if (k === 'lv2') s.lv2 = Math.min(LV_MAX, s.lv2 + 1);
  else if (k === 'chg1') {
    const o = s.pool.filter((x) => x !== s.o2);
    s.o1 = o[Math.floor(rnd() * o.length)];
  } else if (k === 'chg2') {
    const o = s.pool.filter((x) => x !== s.o1);
    s.o2 = o[Math.floor(rnd() * o.length)];
  } else if (k === 'more') s.more = Math.min(2, s.more + d);
}
function sampleShown(rnd: Rnd, n: number): Ev[] {
  const ev = EVENTS.map((e) => e),
    w = EVENTS.map((e) => e[2]),
    out: Ev[] = [];
  for (let i = 0; i < Math.min(n, ev.length); i++) {
    const total = w.reduce((a, b) => a + b, 0);
    const r = rnd() * total;
    let acc = 0;
    for (let j = 0; j < w.length; j++) {
      acc += w[j];
      if (r <= acc) {
        out.push(ev[j]);
        w[j] = 0;
        break;
      }
    }
  }
  return out;
}
function processOne(cost: number, rarity: string, c: Coeffs, rnd: Rnd): GemState {
  const s = seed(cost, rnd);
  for (let t = 0; t < TURNS[rarity]; t++) {
    const shown = sampleShown(rnd, 4 + s.more);
    let best = shown[0],
      bg = gain(s, shown[0], c);
    for (const e of shown) {
      const g = gain(s, e, c);
      if (g > bg) {
        bg = g;
        best = e;
      }
    }
    apply(s, best, rnd);
  }
  return s;
}
function bucketOf(s: GemState, c: Coeffs): string {
  const a1 = c[s.o1] > 0,
    a2 = c[s.o2] > 0;
  if (a1 && a2) return '2D';
  if (!a1 && !a2) return 'No';
  const cur = a1 ? c[s.o1] : c[s.o2];
  const actives = s.pool
    .filter((o) => c[o] > 0)
    .map((o) => c[o])
    .sort((x, y) => y - x);
  return actives.length >= 2 && cur <= actives[1] + 1e-9 && cur < actives[0] - 1e-9 ? 'Sub' : 'Op';
}

const N = 1000000;
const SEED = 123456;
const BASELINES = Array.from({ length: 18 }, (_, i) => i); // 0..17
const rnd = mulberry32(SEED);

// supportCutQuality[baseline][archetype][bucket] = pct (single-cut P(support score > baseline))
type Cell = { pct: number; avg: number | null };
const out: Record<string, Record<string, Record<string, Cell>>> = {};
for (const bl of BASELINES) out[bl] = {};
const ceil: Record<string, Record<string, number>> = {}; // archetype -> bucket -> max score seen

for (let i = 0; i < ARCH.length; i++) {
  const [rarity, cost] = ARCH[i];
  const key = ARCH_KEYS[i];
  const counts: Record<
    string,
    { total: number; above: Record<number, number>; scoreSumAbove: Record<number, number> }
  > = {};
  for (let n = 0; n < N; n++) {
    const s = processOne(cost, rarity, SUP, rnd);
    const sc = scoreState(s, SUP);
    const b = bucketOf(s, SUP);
    ceil[key] = ceil[key] || {};
    ceil[key][b] = Math.max(ceil[key][b] ?? -1e9, sc);
    counts[b] = counts[b] || { total: 0, above: {}, scoreSumAbove: {} };
    counts[b].total++;
    for (const bl of BASELINES) {
      if (sc > bl) {
        counts[b].above[bl] = (counts[b].above[bl] ?? 0) + 1;
        counts[b].scoreSumAbove[bl] = (counts[b].scoreSumAbove[bl] ?? 0) + sc;
      }
    }
  }
  // Cell = { pct: single-cut P(score > baseline), avg: E[score | score > baseline] }.
  for (const bl of BASELINES) {
    out[bl][key] = {};
    for (const b of ['2D', 'Op', 'Sub', 'No']) {
      const c = counts[b];
      const aboveN = c ? (c.above[bl] ?? 0) : 0;
      const pct = c && c.total > 0 ? +((100 * aboveN) / c.total).toFixed(1) : 0;
      const avg = aboveN > 0 ? +((c.scoreSumAbove[bl] ?? 0) / aboveN).toFixed(2) : null;
      out[bl][key][b] = { pct, avg };
    }
  }
}

// Ceiling gate: no bucket may EXCEED its theoretical ceiling (= base + topActiveCoeffs*5).
function ceilOf(cost: number, bucket: string): number {
  const actives = POOLS[cost]
    .filter((o) => SUP[o] > 0)
    .map((o) => SUP[o])
    .sort((a, b) => b - a);
  const base = wTerm(REQ_MIN) + pTerm(PT_MAX); // 7.54 with the current steps
  if (bucket === 'No') return base;
  if (bucket === '2D') return base + (actives[0] + actives[1]) * 5;
  if (bucket === 'Op') return base + actives[0] * 5;
  return base + actives[1] * 5; // Sub
}
for (let i = 0; i < ARCH.length; i++) {
  const [, cost] = ARCH[i];
  const key = ARCH_KEYS[i];
  for (const b of Object.keys(ceil[key])) {
    const max = ceil[key][b];
    const limit = ceilOf(cost, b) + 1e-6;
    if (max > limit)
      throw new Error(`CEILING VIOLATION ${key}/${b}: ${max.toFixed(2)} > ${limit.toFixed(2)}`);
  }
}

// Provenance stamp. generated_at is preserved when the data is unchanged so the
// CI regenerate+diff guard stays clean on an untouched tree.
let generatedAt = new Date().toISOString().slice(0, 10);
if (fs.existsSync(OUT_PATH)) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    const prevGeneratedAt: string | undefined = prev._meta?.generated_at;
    delete prev._meta;
    if (JSON.stringify(prev) === JSON.stringify(out) && prevGeneratedAt) {
      generatedAt = prevGeneratedAt;
    }
  } catch {
    // unreadable previous file: stamp fresh
  }
}
const final = {
  _meta: {
    generator: 'scripts/generate-support-cutquality.mts',
    seed: SEED,
    samples: N,
    generated_at: generatedAt,
  },
  ...out,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(final), 'utf8');
console.log(
  `wrote ${OUT_PATH} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB), ceiling gate PASSED`
);
console.log('sample bl=10:', JSON.stringify(out[10]['E9']));
