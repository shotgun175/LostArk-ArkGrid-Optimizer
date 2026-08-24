// Weekly-economy bake for the cut plan. A faithful port of shizukaziye's pipeline.js computePipeline
// (+ fuseDecisions / fusionHit / avgScore / the CONST block), run in Node against his baked source
// cells and his own astrogem.js for the model math (scoreDistributionForTier, cpBaseline). His page
// computes this live from an editable CONST block; we bake it per (axis, gpd, baseline anchor) so the
// runtime stays a pure lookup and the oracle-guarded math is never re-implemented.
//
// Global region ONLY (KR excluded, incl. his 2026-08 KR_FLOOR/tradable branches): secondHalfGev is
// just the RB open value. cpBaselineScore is made AXIS-AWARE here (his caches a single DPS value, a
// known wrinkle) - support uses supportBaseline. Includes his 2026-08 epic (1E+2UC) pre-cut fuse
// lane (fuseDecisions epic/epicUcCost + the epic lane in computePipeline), Global branch only.
// DELIBERATE DIVERGENCE in avgScore's conditional-score fallback: see the comment there.

const COSTS = [8, 9, 10];
const RARITIES = ['uncommon', 'rare', 'epic'];
const BUCKETS = ['2_damage', 'optimal_damage', 'suboptimal_damage', 'no_damage'];
const TIERS = ['legendary', 'relic', 'ancient'];
const BW = { '2_damage': 1, optimal_damage: 2, suboptimal_damage: 2, no_damage: 1 };
const BW_TOTAL = 6;
const GRADE_ROWS = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95];

const CONST = {
  SLOTS: 24,
  RESET_COST: 20000,
  RESET_THRESHOLD: 20000,
  FUSION_COST: 500,
  DAILY_INCOME: { uncommon: 4.4, rare: 0.9, epic: 0.4 },
  BOX_VENDOR: { cost: 1185, max: 10 },
  BOX_MAT: { cost: 1.4 * 900 + 4.2 * 30 + 10 * 25, max: 20 },
  BOX_EPIC: { cost: 43000, max: 1 },
  BOX_RARITY_MIX: { uncommon: 0.8, rare: 0.15, epic: 0.05 },
  COST_MIX: { 8: 0.6, 9: 0.3, 10: 0.1 },
  CP_MULT: 1.3,
};
const UC_FUSE = { uncommon: 0.85, rare: 0.135, epic: 0.015 };
const RARE_FUSE = { uncommon: 0.52, rare: 0.44, epic: 0.04 };
// 1E + 2UC -> cost from inputs. Fusing an epic downgrades it on average (0.26 epic back), so it only
// pays as a cost-steer: trade a cheap-cost epic for a shot at a 9/10-cost one (his 2026-08 lane).
const EPIC_FUSE = { uncommon: 0.25, rare: 0.49, epic: 0.26 };
const FUSE_A2L = { legendary: 0.35, relic: 0.4, ancient: 0.25 };
const FUSE_R2L = { legendary: 0.73, relic: 0.25, ancient: 0.02 };
const FUSE_3L = { legendary: 0.99, relic: 0.01, ancient: 0 };

// Build the economy for one axis. `srcCells` is his source cells map (keyed
// "rarity_cost_bucket_baseline_gpd"); `Astrogem` is his required model module.
function bakeEconomy(Astrogem, axis, srcCells, bakedBaselines, anchorGpd) {
  const AX = axis === 'support' ? 'support' : 'dps';
  const baselines = [...bakedBaselines].sort((a, b) => a - b);

  const bakedBucket = (rarity, cost, bucket, bl, gpd, roster) => {
    const c = srcCells[`${rarity}_${cost}_${bucket}_${bl}_${gpd}`];
    return c ? c[roster] : null;
  };
  const gev = (rarity, cost, bl, gpd, roster) => {
    let t = 0;
    for (const bk of BUCKETS) {
      const rec = bakedBucket(rarity, cost, bk, bl, gpd, roster);
      if (rec && rec.cut != null) t += Math.max(rec.cut, 0) * BW[bk];
    }
    return t / BW_TOTAL;
  };
  const secondHalfGev = (rarity, cost, bl, gpd) => gev(rarity, cost, bl, gpd, 'rb'); // Global only

  function fuseDecisions(bl, gpd) {
    const ucValue = {};
    const ucSf = {};
    for (const c of COSTS) {
      const ucDirect = gev('uncommon', c, bl, gpd, 'nrb');
      let fuseEv = 0;
      for (const orar of RARITIES) {
        const rate = UC_FUSE[orar];
        fuseEv += Math.max(gev(orar, c, bl, gpd, 'nrb'), 0) * rate * 0.5;
        fuseEv += Math.max(secondHalfGev(orar, c, bl, gpd), 0) * rate * 0.5;
      }
      const fpi = (fuseEv - CONST.FUSION_COST) / 3;
      ucSf[c] = fpi > ucDirect;
      ucValue[c] = Math.max(ucDirect, fpi);
    }
    // Output EV by cost for the two "+2 Uncommon" recipes (1R+2UC and 1E+2UC). Same shape, different
    // rarity mix; the epic recipe returns fewer epics but is the only way to move an epic's cost.
    const outEvByCost = (mix) => {
      const by = {};
      for (const cc of COSTS) {
        let ev = 0;
        for (const or2 of RARITIES) {
          const rt = mix[or2];
          ev += Math.max(gev(or2, cc, bl, gpd, 'nrb'), 0) * rt * 0.5;
          ev += Math.max(secondHalfGev(or2, cc, bl, gpd), 0) * rt * 0.5;
        }
        by[cc] = ev;
      }
      return by;
    };
    // Best "+2 Uncommon" fuse for one gem of `rarity` at each cost: pick the Uncommon cost to add
    // (the output lands there 2/3 of the time), net of the fee and the 2 Uncommons' opportunity
    // cost. Fuse iff that beats cutting the gem directly.
    const plusTwoUc = (rarity, byCost) => {
      const sf = {};
      const pick = {};
      for (const oc of COSTS) {
        const openEv = gev(rarity, oc, bl, gpd, 'nrb');
        let bestMarg = -Infinity;
        let bestUc = 8;
        for (const uc of COSTS) {
          const uOpp = ucValue[uc];
          const outEv = oc === uc ? byCost[oc] : (1 / 3) * byCost[oc] + (2 / 3) * byCost[uc];
          const marg = outEv - CONST.FUSION_COST - 2 * uOpp;
          if (marg > bestMarg) {
            bestMarg = marg;
            bestUc = uc;
          }
        }
        sf[oc] = bestMarg > openEv;
        pick[oc] = bestUc;
      }
      return { sf, uc: pick };
    };
    const rare = plusTwoUc('rare', outEvByCost(RARE_FUSE));
    const epic = plusTwoUc('epic', outEvByCost(EPIC_FUSE));
    return { uc: ucSf, rare: rare.sf, rareUcCost: rare.uc, epic: epic.sf, epicUcCost: epic.uc };
  }

  const pTierAbove = (cost, tier, bl) => {
    const dist = Astrogem.scoreDistributionForTier(cost, tier, AX);
    let p = 0;
    dist.forEach((prob, sc) => {
      if (sc > bl) p += prob;
    });
    return p;
  };
  const fusionHit = (bl, mix) => {
    let t = 0;
    for (const c of COSTS) {
      let inner = 0;
      for (const tier of TIERS) inner += mix[tier] * pTierAbove(c, tier, bl);
      t += CONST.COST_MIX[c] * inner;
    }
    return t;
  };

  // Axis-aware cp baseline: DPS cpBaseline, support supportBaseline, cost-weighted 60/30/10.
  const baseFn = AX === 'support' ? Astrogem.supportBaseline : Astrogem.cpBaseline;
  let cpBaseScore = 0;
  for (const c of COSTS) cpBaseScore += CONST.COST_MIX[c] * baseFn(c);

  // Conditional score-when-above per cell. His COND_SCORE table (the exact offline solve) is not
  // baked yet even upstream; his condScoreFor then falls back to the cell's expScore, then baseline.
  // DELIBERATE DIVERGENCE (2026-08-24, see .claude/DECISIONS.md "foundation, not a ceiling"): the
  // true quantity is E[score | score > baseline], which is >= bl by definition and >= expScore
  // always, so max(expScore, bl) is the tighter lower bound of the two fallbacks. Re-evaluate when
  // his COND_SCORE bake ships (pipeline.js /*__COND_SCORE__*/): that is the exact quantity and wins.
  function avgScore(bl, gpd) {
    let ta = 0;
    let ss = 0;
    for (const rarity of RARITIES) {
      for (const cost of COSTS) {
        for (const bucket of BUCKETS) {
          const rec = bakedBucket(rarity, cost, bucket, bl, gpd, 'nrb');
          if (!rec) continue;
          const p = rec.pAbove || 0;
          if (p <= 0) continue;
          const s = Math.max(rec.expScore ?? bl, bl);
          const w = ((CONST.COST_MIX[cost] * BW[bucket]) / BW_TOTAL) * p;
          ta += w;
          ss += w * s;
        }
      }
    }
    return ta > 0 ? ss / ta : bl;
  }

  function computePipeline(bl, gpd) {
    const ba = {};
    for (const rarity of RARITIES) {
      for (const cost of COSTS) {
        const d = {};
        for (const bucket of BUCKETS) {
          const rec = bakedBucket(rarity, cost, bucket, bl, gpd, 'nrb');
          if (rec) d[bucket] = rec;
        }
        ba[`${rarity}_${cost}`] = d;
      }
    }
    const fd = fuseDecisions(bl, gpd);

    let bev = 0;
    for (const orar of RARITIES)
      for (const co of COSTS)
        bev += CONST.BOX_RARITY_MIX[orar] * CONST.COST_MIX[co] * gev(orar, co, bl, gpd, 'nrb');
    const buyVendor = bev > CONST.BOX_VENDOR.cost;
    const buyMat = bev > CONST.BOX_MAT.cost;
    let eev = 0;
    for (const ce of COSTS) eev += CONST.COST_MIX[ce] * gev('epic', ce, bl, gpd, 'nrb');
    const buyEpic = eev > CONST.BOX_EPIC.cost;

    const boxCount = (buyVendor ? CONST.BOX_VENDOR.max : 0) + (buyMat ? CONST.BOX_MAT.max : 0);
    const W = {
      uncommon: CONST.DAILY_INCOME.uncommon * 7,
      rare: CONST.DAILY_INCOME.rare * 7,
      epic: CONST.DAILY_INCOME.epic * 7,
    };
    const tuc = W.uncommon + boxCount * CONST.BOX_RARITY_MIX.uncommon;
    const trr = W.rare + boxCount * CONST.BOX_RARITY_MIX.rare;
    const tep = W.epic + boxCount * CONST.BOX_RARITY_MIX.epic + (buyEpic ? 1.0 : 0);

    let at = 0;
    let lp = 0;
    let rp = 0;
    let ap = 0;
    let cg = 0;
    let rg = 0;
    let fg = 0;
    const bg =
      (buyVendor ? CONST.BOX_VENDOR.max * CONST.BOX_VENDOR.cost : 0) +
      (buyMat ? CONST.BOX_MAT.max * CONST.BOX_MAT.cost : 0) +
      (buyEpic ? CONST.BOX_EPIC.cost : 0);

    function pgb(count, rarity, cost) {
      const bd = ba[`${rarity}_${cost}`];
      for (const bucket of BUCKETS) {
        const rec = bd[bucket];
        if (!rec) continue;
        const b = (count * BW[bucket]) / BW_TOTAL;
        const p = rec.pAbove || 0;
        const ev = rec.cut;
        at += b * p;
        cg += b * (rec.expSpend || 0);
        if (rec.act === 'complete') continue;
        const fl = rec.fLeg || 0;
        const fr = rec.fRelic || 0;
        const fa = rec.fAnc || 0;
        if (ev >= CONST.RESET_THRESHOLD) {
          rp += b * fr;
          ap += b * fa;
          const nr = b * fl;
          rg += nr * CONST.RESET_COST;
          at += nr * p;
          const rf = nr * (1 - p);
          lp += rf * fl;
          rp += rf * fr;
          ap += rf * fa;
        } else {
          lp += b * fl;
          rp += b * fr;
          ap += b * fa;
        }
      }
    }

    if (fd.uc[8] || fd.uc[9] || fd.uc[10]) {
      const ucToFuse = { 8: 0, 9: 0, 10: 0 };
      for (const c1 of COSTS) {
        const cnt1 = tuc * CONST.COST_MIX[c1];
        if (fd.uc[c1]) {
          const bd1 = ba[`uncommon_${c1}`];
          for (const bucket of BUCKETS) {
            const r1 = bd1[bucket];
            if (!r1) continue;
            const b1 = (cnt1 * BW[bucket]) / BW_TOTAL;
            at += b1 * (r1.pAbove || 0);
            cg += b1 * (r1.expSpend || 0);
            ucToFuse[c1] += b1 * (1 - (r1.pAbove || 0));
          }
        } else {
          pgb(cnt1, 'uncommon', c1);
        }
      }
      for (const c2 of COSTS) {
        const nf = ucToFuse[c2] / 3;
        if (nf <= 0) continue;
        fg += nf * CONST.FUSION_COST;
        for (const orar2 of RARITIES) {
          const rt2 = UC_FUSE[orar2];
          pgb(nf * rt2 * 0.5, orar2, c2);
          pgb(nf * rt2 * 0.5, orar2, c2);
        }
      }
    } else {
      for (const c of COSTS) pgb(tuc * CONST.COST_MIX[c], 'uncommon', c);
    }

    if (fd.rare[8] || fd.rare[9] || fd.rare[10]) {
      const rToFuse = { 8: 0, 9: 0, 10: 0 };
      for (const c3 of COSTS) {
        const cnt3 = trr * CONST.COST_MIX[c3];
        if (fd.rare[c3]) {
          const bd3 = ba[`rare_${c3}`];
          for (const bucket of BUCKETS) {
            const r3 = bd3[bucket];
            if (!r3) continue;
            const b3 = (cnt3 * BW[bucket]) / BW_TOTAL;
            at += b3 * (r3.pAbove || 0);
            cg += b3 * (r3.expSpend || 0);
            rToFuse[c3] += b3 * (1 - (r3.pAbove || 0));
          }
        } else {
          pgb(cnt3, 'rare', c3);
        }
      }
      for (const rcst of COSTS) {
        const nfr = rToFuse[rcst];
        if (nfr <= 0) continue;
        const ucc = fd.rareUcCost[rcst];
        fg += nfr * CONST.FUSION_COST;
        const costDist = rcst === ucc ? [[rcst, 1.0]] : [[rcst, 1 / 3], [ucc, 2 / 3]];
        for (const orar3 of RARITIES) {
          const rate3 = RARE_FUSE[orar3];
          for (const [oc, cprob] of costDist) {
            pgb(nfr * rate3 * cprob * 0.5, orar3, oc);
            pgb(nfr * rate3 * cprob * 0.5, orar3, oc);
          }
        }
      }
    } else {
      for (const c of COSTS) pgb(trr * CONST.COST_MIX[c], 'rare', c);
    }

    // Epic processing (with pre-cut fuse where decided; the cost-steer play, his 2026-08 lane).
    if (fd.epic[8] || fd.epic[9] || fd.epic[10]) {
      const eToFuse = { 8: 0, 9: 0, 10: 0 };
      for (const c4 of COSTS) {
        const cnt4 = tep * CONST.COST_MIX[c4];
        if (fd.epic[c4]) {
          const bd4 = ba[`epic_${c4}`];
          for (const bucket of BUCKETS) {
            const r4 = bd4[bucket];
            if (!r4) continue;
            const b4 = (cnt4 * BW[bucket]) / BW_TOTAL;
            at += b4 * (r4.pAbove || 0);
            cg += b4 * (r4.expSpend || 0);
            eToFuse[c4] += b4 * (1 - (r4.pAbove || 0));
          }
        } else {
          pgb(cnt4, 'epic', c4);
        }
      }
      for (const ecst of COSTS) {
        const nfe = eToFuse[ecst];
        if (nfe <= 0) continue;
        const eucc = fd.epicUcCost[ecst];
        fg += nfe * CONST.FUSION_COST;
        const eCostDist = ecst === eucc ? [[ecst, 1.0]] : [[ecst, 1 / 3], [eucc, 2 / 3]];
        for (const orar4 of RARITIES) {
          const rate4 = EPIC_FUSE[orar4];
          for (const [oc2, cprob2] of eCostDist) {
            pgb(nfe * rate4 * cprob2 * 0.5, orar4, oc2);
            pgb(nfe * rate4 * cprob2 * 0.5, orar4, oc2);
          }
        }
      }
    } else {
      for (const c of COSTS) pgb(tep * CONST.COST_MIX[c], 'epic', c);
    }

    const ha = fusionHit(bl, FUSE_A2L);
    const hr = fusionHit(bl, FUSE_R2L);
    const hl = fusionHit(bl, FUSE_3L);
    const na = ap;
    const nr2 = rp;
    const nl = lp;
    const nA2L = nl >= 2 ? Math.min(na, nl / 2) : 0;
    const aboveA2L = nA2L * ha;
    const belowA2L = nA2L - aboveA2L;
    let rl = nl - nA2L * 2;
    let rr = nr2;
    rl += belowA2L * FUSE_A2L.legendary;
    rr += belowA2L * FUSE_A2L.relic;
    const nR2L = rl >= 2 ? Math.min(rr, rl / 2) : 0;
    const aboveR2L = nR2L * hr;
    const belowR2L = nR2L - aboveR2L;
    let rl2 = rl - nR2L * 2;
    rl2 += belowR2L * FUSE_R2L.legendary;
    const above3L = (rl2 / 3) * hl;

    const tf = aboveA2L + aboveR2L + above3L;
    const gt = at + tf;
    const gw = bg + cg + rg + fg;
    const wk = gt > 0 ? CONST.SLOTS / gt : null;
    const gtot = wk != null ? gw * wk : null;

    const avg = avgScore(bl, gpd);
    const avgDmg = avg - cpBaseScore;
    const totDmg = CONST.SLOTS * avgDmg;
    const cpPct = CONST.CP_MULT * (1 + totDmg / 100) - 1;

    return {
      boxEV: Math.round(bev),
      buyVendor,
      buyMat,
      buyEpic,
      direct: gt != null ? at : 0,
      directPerWk: at,
      fusePerWk: tf,
      totalPerWk: gt,
      weeks: wk,
      goldPerWk: gw,
      goldTotal: gtot,
      cpPct,
    };
  }

  const byGpd = {};
  for (const gpd of anchorGpd) {
    byGpd[gpd] = baselines.map((bl) => {
      const r = computePipeline(bl, gpd);
      return {
        boxEV: r.boxEV,
        buyVendor: r.buyVendor,
        buyMat: r.buyMat,
        buyEpic: r.buyEpic,
        directPerWk: round2(r.directPerWk),
        fusePerWk: round2(r.fusePerWk),
        totalPerWk: round2(r.totalPerWk),
        weeks: r.weeks == null ? null : round1(r.weeks),
        goldPerWk: Math.round(r.goldPerWk),
        goldTotal: r.goldTotal == null ? null : Math.round(r.goldTotal),
        cpPct: round4(r.cpPct),
      };
    });
  }
  return byGpd;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 1e4) / 1e4;

module.exports = { bakeEconomy };
