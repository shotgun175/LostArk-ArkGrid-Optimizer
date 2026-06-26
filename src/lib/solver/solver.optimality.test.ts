import { describe, expect, it } from 'vitest';

import { Core, Gem, type GemSet, buildScoreMap } from './models';
import { getBestGemSetPacks, getMaxStat, getPossibleGemSets } from './solver';

// getBestGemSetPacks runs a branch-and-bound that PRUNES the assignment search with
// optimistic upper bounds. Its core promise is that, despite pruning, it still returns
// the GLOBAL optimum (the pack with the largest "maxScore") under the constraints:
//   - each core gets one GemSet (≤4 gems, Σreq ≤ energy, Σpoint ≥ core.point),
//   - each gem is used at most once across cores (bitmask disjointness).
// We prove that here by comparing the solver against an INDEPENDENT exhaustive oracle.
// A pruning bug (a too-aggressive bound) would silently return a suboptimal grid; these
// tests would catch it. NOTE: the solver uses its own multiplicative combat-power model
// (models.ts), NOT src/lib/scoring — so the gem-grading work does not touch it.

// DPS option coefficients (mirror gemOptionLevelCoeffs). Their exact values are
// incidental to optimality — only internal consistency matters for this oracle.
const DPS_COEFFS = [400, 700, 1000];

// A core whose point→coeff ramp covers every reachable point sum (0..20 for up to four
// 5-point gems). The ramp shape is arbitrary; it just has to make points matter so the
// optimizer faces a real stats-vs-core-points tradeoff.
function makeCore(energy: number, point: number): Core {
  const coeff = Array.from({ length: 21 }, (_, p) => p * 60);
  return new Core(energy, point, coeff);
}

function makeGem(
  index: number,
  req: number,
  point: number,
  att: number,
  skill: number,
  boss: number
): Gem {
  return new Gem(BigInt(index), req, point, att, skill, boss);
}

// Mirror solve()'s setup: derive score maps from the reachable stat maxima, then set
// every GemSet's [min,max] range (getBestGemSetPacks requires this).
function prepare(cores: Core[], gems: Gem[]) {
  const gssList = cores.map((core) => getPossibleGemSets(core, gems));
  let attMax = 0;
  let skillMax = 0;
  let bossMax = 0;
  for (const gss of gssList) {
    attMax += getMaxStat(gss, 'att');
    skillMax += getMaxStat(gss, 'skill');
    bossMax += getMaxStat(gss, 'boss');
  }
  const scoreMaps: [number, number][][] = [
    buildScoreMap(DPS_COEFFS[0], attMax),
    buildScoreMap(DPS_COEFFS[1], skillMax),
    buildScoreMap(DPS_COEFFS[2], bossMax),
  ];
  for (const gss of gssList) for (const gs of gss) gs.setScoreRange(scoreMaps);
  return { gssList, scoreMaps };
}

// Optimistic combat power for a fully-chosen pack — the SAME formula the solver uses
// internally (inlineScores().maxScore), recomputed here via an independent path.
function packMaxScore(pack: GemSet[], scoreMaps: [number, number][][]): number {
  let att = 0;
  let skill = 0;
  let boss = 0;
  let coreScore = 1;
  for (const gs of pack) {
    att += gs.att;
    skill += gs.skill;
    boss += gs.boss;
    coreScore *= (gs.coreCoeff + 10000) / 10000;
  }
  return coreScore * scoreMaps[0][att][1] * scoreMaps[1][skill][1] * scoreMaps[2][boss][1];
}

// Exhaustive oracle: the best maxScore over EVERY disjoint one-GemSet-per-core choice.
function bruteForceBest(gssList: GemSet[][], scoreMaps: [number, number][][]): number {
  let best = -Infinity;
  const chosen: GemSet[] = [];
  const recurse = (coreIdx: number, used: bigint) => {
    if (coreIdx === gssList.length) {
      best = Math.max(best, packMaxScore(chosen, scoreMaps));
      return;
    }
    for (const gs of gssList[coreIdx]) {
      if ((gs.bitmask & used) !== 0n) continue;
      chosen.push(gs);
      recurse(coreIdx + 1, used | gs.bitmask);
      chosen.pop();
    }
  };
  recurse(0, 0n);
  return best;
}

function solverBestMaxScore(gssList: GemSet[][], scoreMaps: [number, number][][]): number {
  const packs = getBestGemSetPacks(gssList, scoreMaps);
  return packs.length > 0 ? packs[0].maxScore : -Infinity;
}

// True when every core has at least one feasible GemSet (so a full assignment exists).
function feasible(gssList: GemSet[][]): boolean {
  return gssList.every((gss) => gss.length > 0);
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('getBestGemSetPacks returns the global optimum (vs. exhaustive oracle)', () => {
  it('matches brute force on a 2-core contention instance', () => {
    // Two point-0 cores compete for the same high-stat gems; the optimal split is not
    // obvious because each gem can only sit on one core.
    const cores = [makeCore(18, 0), makeCore(18, 0)];
    const gems = [
      makeGem(0, 5, 5, 5, 0, 0),
      makeGem(1, 6, 4, 0, 5, 0),
      makeGem(2, 7, 3, 0, 0, 5),
      makeGem(3, 4, 5, 3, 3, 0),
      makeGem(4, 8, 2, 0, 4, 4),
    ];
    const { gssList, scoreMaps } = prepare(cores, gems);
    expect(feasible(gssList)).toBe(true);
    expect(solverBestMaxScore(gssList, scoreMaps)).toBeCloseTo(
      bruteForceBest(gssList, scoreMaps),
      9
    );
  });

  it('matches brute force on a 3-core triad with point requirements', () => {
    const cores = [makeCore(20, 10), makeCore(17, 5), makeCore(15, 0)];
    const gems = [
      makeGem(0, 3, 5, 5, 0, 0),
      makeGem(1, 4, 5, 0, 5, 0),
      makeGem(2, 5, 4, 0, 0, 5),
      makeGem(3, 5, 3, 4, 2, 0),
      makeGem(4, 6, 5, 0, 3, 3),
      makeGem(5, 4, 4, 2, 0, 4),
      makeGem(6, 7, 2, 3, 3, 0),
    ];
    const { gssList, scoreMaps } = prepare(cores, gems);
    expect(feasible(gssList)).toBe(true);
    expect(solverBestMaxScore(gssList, scoreMaps)).toBeCloseTo(
      bruteForceBest(gssList, scoreMaps),
      9
    );
  });

  it('matches brute force when a point-0 core may take the empty GemSet', () => {
    const cores = [makeCore(15, 14), makeCore(12, 0)];
    const gems = [
      makeGem(0, 5, 5, 5, 5, 0),
      makeGem(1, 5, 5, 0, 5, 5),
      makeGem(2, 5, 5, 5, 0, 5),
      makeGem(3, 6, 4, 4, 4, 4),
    ];
    const { gssList, scoreMaps } = prepare(cores, gems);
    expect(feasible(gssList)).toBe(true);
    expect(solverBestMaxScore(gssList, scoreMaps)).toBeCloseTo(
      bruteForceBest(gssList, scoreMaps),
      9
    );
  });

  it('matches brute force across 200 randomized feasible instances', () => {
    const rnd = mulberry32(0xc0ffee);
    const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    let tested = 0;
    let attempts = 0;
    while (tested < 200 && attempts < 4000) {
      attempts += 1;
      const coreCount = ri(1, 3);
      const cores = Array.from({ length: coreCount }, () => makeCore(ri(12, 20), [0, 0, 3, 5][ri(0, 3)]));
      const gemCount = ri(4, 7);
      const gems = Array.from({ length: gemCount }, (_, i) => {
        // each gem carries 0-2 non-zero stats (mirrors a gem's two damage options)
        const stats = [0, 0, 0];
        const slots = ri(0, 2);
        for (let s = 0; s < slots; s++) stats[ri(0, 2)] += ri(1, 5);
        return makeGem(i, ri(3, 8), ri(1, 5), stats[0], stats[1], stats[2]);
      });
      const { gssList, scoreMaps } = prepare(cores, gems);
      if (!feasible(gssList)) continue;
      tested += 1;
      expect(solverBestMaxScore(gssList, scoreMaps)).toBeCloseTo(
        bruteForceBest(gssList, scoreMaps),
        9
      );
    }
    // Guard: the sweep must actually have exercised a meaningful number of instances.
    expect(tested).toBeGreaterThanOrEqual(100);
  });
});

describe('the oracle has teeth (non-vacuity)', () => {
  it("the optimum strictly beats a deliberately suboptimal assignment", () => {
    const cores = [makeCore(18, 0), makeCore(18, 0)];
    const gems = [
      makeGem(0, 5, 5, 5, 0, 0),
      makeGem(1, 6, 4, 0, 5, 0),
      makeGem(2, 7, 3, 0, 0, 5),
      makeGem(3, 4, 5, 3, 3, 3),
    ];
    const { gssList, scoreMaps } = prepare(cores, gems);
    const best = solverBestMaxScore(gssList, scoreMaps);
    // A concrete suboptimal pack: put only the weakest single gem on core 0 and nothing
    // usable on core 1. Its score must be strictly below the optimum, proving the
    // comparison discriminates (a vacuous test would let these tie).
    const weakSet = gssList[0].find((gs) => gs.att === 3 && gs.skill === 3 && gs.boss === 3);
    expect(weakSet).toBeDefined();
    const suboptimal = packMaxScore([weakSet as GemSet], scoreMaps);
    expect(best).toBeGreaterThan(suboptimal);
  });
});

describe('frozen golden values (regression guard)', () => {
  it('produces stable, independently-recomputed maxScores for fixed instances', () => {
    const cores = [makeCore(20, 10), makeCore(17, 5), makeCore(15, 0)];
    const gems = [
      makeGem(0, 3, 5, 5, 0, 0),
      makeGem(1, 4, 5, 0, 5, 0),
      makeGem(2, 5, 4, 0, 0, 5),
      makeGem(3, 5, 3, 4, 2, 0),
      makeGem(4, 6, 5, 0, 3, 3),
      makeGem(5, 4, 4, 2, 0, 4),
      makeGem(6, 7, 2, 3, 3, 0),
    ];
    const { gssList, scoreMaps } = prepare(cores, gems);
    const solver = solverBestMaxScore(gssList, scoreMaps);
    const brute = bruteForceBest(gssList, scoreMaps);
    // Solver == independent oracle, AND both equal a frozen constant. If the scoring
    // math legitimately changes, re-freeze GOLDEN deliberately (and document why).
    const GOLDEN = 1.2040118893985767;
    expect(solver).toBeCloseTo(brute, 9);
    expect(solver).toBeCloseTo(GOLDEN, 6);
  });
});
