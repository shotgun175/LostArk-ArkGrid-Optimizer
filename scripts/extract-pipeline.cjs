// Build-time generator: transform shizukaziye's astrogem-calculator pipeline data
// (the EXACT Bellman-DP per-effect-pair-bucket model, gem-value units) into a compact,
// interpolation-friendly JSON the app embeds. Re-run with: node scripts/extract-pipeline.cjs
//
// Source (third-party, deliberately untracked) lives under Reference Projects/ (his repo moved into
// the loastuff monorepo in 2026-08; the data folder is loastuff-main/loa-astrogem-calc/data). We bake
// BOTH axes — DPS (data/pipeline.json) and Support (data/pipeline-support.json) — into one
// file, reorganized as cells[rarity][cost][bucket][gpd] = [{ b, nrb, rb } per baseline anchor]
// plus thru[rarity][cost][gpd] = [{ b, ... } per baseline]. The output's _provenance block
// records each source's sha256 + date so the committed table stays auditable from a clone.
//
// Per-gem VERDICTS are the baked cut-value bands (meta.verdict); the "fuse-first" (purple)
// refinement is computed client-side at read time (cutPlan.ts unopenedFusion, incl. the 1E+2UC
// epic lane). The weekly economy's avg/cp% uses a max(expScore, baseline) conditional-score
// bound, a deliberate divergence from his expScore fallback (see bake-economy.cjs avgScore).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'Reference Projects', 'loastuff-main', 'loa-astrogem-calc', 'data');
const OUT_PATH = path.join(__dirname, '..', 'src', 'lib', 'cutplan', 'pipeline.json');

function readSource(file) {
  const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  return { json: JSON.parse(raw), sha256: crypto.createHash('sha256').update(raw).digest('hex') };
}

const round = (n, dp) => {
  if (n == null) return n;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// Reorganize one axis's flat cells/thru (keyed "rarity_cost_bucket_baseline_gpd") into the
// nested, baseline-sorted structure. Keys are reconstructed from meta enums (buckets contain
// underscores, so we must build keys, not split them).
function transform(src, meta) {
  const { rarities, costs, buckets, anchorGpd, bakedBaselines } = meta;
  const baselines = [...bakedBaselines].sort((a, b) => a - b);
  const cells = {};
  const thru = {};
  let missing = 0;
  for (const rarity of rarities) {
    cells[rarity] = {};
    thru[rarity] = {};
    for (const cost of costs) {
      cells[rarity][cost] = {};
      thru[rarity][cost] = {};
      for (const bucket of buckets) {
        cells[rarity][cost][bucket] = {};
        for (const gpd of anchorGpd) {
          cells[rarity][cost][bucket][gpd] = baselines.map((b) => {
            const c = src.cells[`${rarity}_${cost}_${bucket}_${b}_${gpd}`];
            if (!c) {
              missing++;
              return null;
            }
            return {
              b: round(b, 6),
              nrb: {
                cut: Math.round(c.nrb.cut),
                // The DP's chosen root action for a fresh cut: 'process' | 'complete' | 'reroll'.
                // The weekly-economy model needs it: a 'complete' cell produces no fodder.
                act: c.nrb.act,
                pAbove: round(c.nrb.pAbove, 4),
                expScore: round(c.nrb.expScore, 4),
                expSpend: Math.round(c.nrb.expSpend || 0),
                fLeg: round(c.nrb.fLeg, 4),
                fRelic: round(c.nrb.fRelic, 4),
                fAnc: round(c.nrb.fAnc, 4),
              },
              rb: {
                cut: Math.round(c.rb.cut),
                act: c.rb.act,
                pAbove: round(c.rb.pAbove, 4),
                expScore: round(c.rb.expScore, 4),
                expSpend: Math.round(c.rb.expSpend || 0),
              },
            };
          });
        }
      }
      for (const gpd of anchorGpd) {
        thru[rarity][cost][gpd] = baselines.map((b) => {
          const t = src.thru[`${rarity}_${cost}_${b}_${gpd}`];
          if (!t) {
            missing++;
            return null;
          }
          return {
            b: round(b, 6),
            directPerWk: round(t.directPerWk, 2),
            fusePerWk: round(t.fusePerWk, 2),
            totalPerWk: round(t.totalPerWk, 2),
            weeks: round(t.weeks, 1),
            goldPerWk: Math.round(t.goldPerWk),
            boxEV: Math.round(t.boxEV),
            avgScore: round(t.avgScore, 4),
            cpGain: round(t.cpGain, 4),
          };
        });
      }
    }
  }
  return { cells, thru, missing, baselines: baselines.map((b) => round(b, 6)) };
}

const dps = readSource('pipeline.json');
const support = readSource('pipeline-support.json');
const meta = dps.json.meta;

const dpsT = transform(dps.json, meta);
const supportT = transform(support.json, support.json.meta);
if (dpsT.missing || supportT.missing) {
  throw new Error(`missing cells: dps=${dpsT.missing} support=${supportT.missing}`);
}

// Fusion / fodder values are LIVE model math on his page (his joint 9-variable fixed point), not in
// the baked DP cells. We reproduce them EXACTLY by calling his own astrogem.js in Node (it is CJS and
// runs natively here) at each baked baseline anchor x gpd, so the runtime stays a pure lookup and we
// never re-implement the oracle-guarded math. tierExpectedValue applies the support x3 gpd internally,
// so we just pass the axis. Baselines are sorted ascending to stay parallel to the baked cells.
const Astrogem = require(path.join(SRC_DIR, '..', 'model', 'astrogem.js'));
function bakeFusion(axis, bakedBaselines, anchorGpd) {
  const baselines = [...bakedBaselines].sort((a, b) => a - b);
  const byGpd = {};
  for (const gpd of anchorGpd) {
    byGpd[gpd] = {};
    for (const cost of [8, 9, 10]) {
      byGpd[gpd][cost] = baselines.map((bl) => {
        const tev = Astrogem.tierExpectedValue(cost, bl, gpd, axis);
        return {
          // Expected gold of a random processed gem of each fodder tier (keep-or-fuse EV).
          tierEV: {
            leg: Math.round(tev.legendary),
            relic: Math.round(tev.relic),
            anc: Math.round(tev.ancient),
          },
          // Per-input value of using a below-baseline gem of each tier as fusion fodder.
          fodder: {
            leg: Math.round(Astrogem.fusionValueForTier('legendary', cost, bl, gpd, axis)),
            relic: Math.round(Astrogem.fusionValueForTier('relic', cost, bl, gpd, axis)),
            anc: Math.round(Astrogem.fusionValueForTier('ancient', cost, bl, gpd, axis)),
          },
        };
      });
    }
  }
  return byGpd;
}
const dpsFusion = bakeFusion('dps', meta.bakedBaselines, meta.anchorGpd);
const supportFusion = bakeFusion('support', support.json.meta.bakedBaselines, meta.anchorGpd);

// Weekly-economy model (his pipeline.js computePipeline, ported to Node in bake-economy.cjs). It reads
// his source cells + CONST + his astrogem.js and produces one whole-economy result per (axis, gpd,
// baseline). We bake it so the runtime is a pure lookup; validated exact against his live Pipeline tab.
const { bakeEconomy } = require('./bake-economy.cjs');
const dpsEconomy = bakeEconomy(Astrogem, 'dps', dps.json.cells, meta.bakedBaselines, meta.anchorGpd);
const supportEconomy = bakeEconomy(Astrogem, 'support', support.json.cells, support.json.meta.bakedBaselines, meta.anchorGpd);

// Preserve generated_at when the inputs are unchanged so re-runs stay byte-identical.
let generatedAt = new Date().toISOString().slice(0, 10);
if (fs.existsSync(OUT_PATH)) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    const p = prev._provenance;
    if (p && p.dps_sha256 === dps.sha256 && p.support_sha256 === support.sha256 && p.generated_at) {
      generatedAt = p.generated_at;
    }
  } catch {
    // unreadable previous file: stamp fresh
  }
}

const out = {
  _provenance: {
    generator: 'scripts/extract-pipeline.cjs',
    source: 'shizukaziye/loastuff, loa-astrogem-calc (data/pipeline.json, data/pipeline-support.json) - exact Bellman-DP over the 2026-08-10 roster-bound grading model (gem-value units)',
    upstream: 'https://github.com/shizukaziye/loastuff',
    dps_sha256: dps.sha256,
    support_sha256: support.sha256,
    generated_at: generatedAt,
    note: 'Per-bucket cut/fodder values are his baked DP output (his IP, used with attribution). Verdicts use meta.verdict cut-value bands; the fuse-first (purple) refinement incl. the 1E+2UC epic lane is computed client-side (cutPlan.ts). avg/cp% uses a max(expScore, baseline) conditional-score bound, a deliberate divergence from his expScore fallback.',
  },
  meta: {
    scoreUnit: meta.scoreUnit,
    costs: meta.costs,
    rarities: meta.rarities,
    buckets: meta.buckets,
    bucketLabels: meta.bucketLabels,
    // Per-axis effect-pair labels: each source file pairs different effects into each bucket
    // (DPS vs support). Two meta fields differ across the axes and are split by CutAxis:
    // effectBuckets (below) and baselines (further down). Every other meta field is identical.
    effectBuckets: { dps: meta.effectBuckets, support: support.json.meta.effectBuckets },
    verdict: meta.verdict,
    slots: meta.slots,
    cutsPerWeek: meta.cutsPerWeek,
    boxSchedule: meta.boxSchedule,
    freshBucketMix: meta.freshBucketMix,
    anchorGpd: meta.anchorGpd,
    // Per-axis baseline anchors: support scores on a smaller (per-DPS ÷3) % scale, so its cells are
    // baked at a different baseline range than DPS. Both arrays stay parallel to GRADE_ROWS.
    baselines: { dps: dpsT.baselines, support: supportT.baselines },
  },
  axes: {
    dps: { cells: dpsT.cells, thru: dpsT.thru, fusion: dpsFusion, economy: dpsEconomy },
    support: { cells: supportT.cells, thru: supportT.thru, fusion: supportFusion, economy: supportEconomy },
  },
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8');
const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
console.log(`wrote ${OUT_PATH} (${kb} KB)`);
// Sanity: uncommon c8 2D nrb at the lowest baseline / 500k should be a small positive cut.
const sample = out.axes.dps.cells.uncommon[8]['2_damage'][500000][0];
console.log('sanity dps uncommon/8/2D/500k/blMin:', sample.nrb.cut, 'pAbove', sample.nrb.pAbove);
