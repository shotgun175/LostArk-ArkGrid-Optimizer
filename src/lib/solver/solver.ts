import { Core, Gem, GemSet, GemSetPack } from './models';

export type GemSetPackProgress = {
  current: number;
  total: number;
};

type GemSetPackProgressCallback = (progress: GemSetPackProgress) => void;

export function getMaxStat(gss: GemSet[], statType: 'att' | 'skill' | 'boss') {
  // Return the highest value of statType across the given GemSet[].
  let result = 0;
  for (const gs of gss) {
    if (gs[statType] > result) {
      result = gs[statType];
    }
  }
  return result;
}

// Upper bound on the will-points a single astrogem can contribute. The game's gem-point domain is
// 1-5: every "perfect" gem in solverWorker.ts uses point 5, and the launcher-gem simulation sweeps
// gemPoint from 5 down to 1. getPossibleGemSets enumerates at most 4 gems per core (the i/j/k/m loop
// nest), so after placing N gems the (4 - N) remaining slots can add at most (4 - N) * MAX_GEM_POINT
// more points. The branch-and-bound below prunes a branch as soon as even that optimistic remainder
// cannot reach the core's required `point`.
const MAX_GEM_POINT = 5;

export function getPossibleGemSets(core: Core, gems: Gem[]): GemSet[] {
  // Return all gem sets from the given gems that satisfy the required energy and point.
  const n = gems.length;
  const g = [...gems].sort((a, b) => a.req - b.req);
  const energy = core.energy;
  const point = core.point;
  const result: GemSet[] = [];

  if (point == 0) {
    result.push(new GemSet([], core));
  }

  for (let i = 0; i < n; i++) {
    const ei = energy - g[i].req;
    const pi = g[i].point;

    if (pi >= point && ei >= 0) result.push(new GemSet([g[i]], core));

    if (ei < 3) break;
    if (pi + 3 * MAX_GEM_POINT < point) continue; // 3 slots (j,k,m) still open

    for (let j = i + 1; j < n; j++) {
      const ej = ei - g[j].req;
      const pj = pi + g[j].point;
      if (pj >= point && ej >= 0) result.push(new GemSet([g[i], g[j]], core));
      if (ej < 0) break;
      if (ej < 3) continue;
      if (pj + 2 * MAX_GEM_POINT < point) continue; // 2 slots (k,m) still open

      for (let k = j + 1; k < n; k++) {
        const ek = ej - g[k].req;
        const pk = pj + g[k].point;
        if (pk >= point && ek >= 0) result.push(new GemSet([g[i], g[j], g[k]], core));
        if (ek < 0) break;
        if (ek < 3) continue;
        if (pk + MAX_GEM_POINT < point) continue; // 1 slot (m) still open
        for (let m = k + 1; m < n; m++) {
          const el = ek - g[m].req;
          const pl = pk + g[m].point;
          if (el < 0) break;
          if (pl >= point && el >= 0) result.push(new GemSet([g[i], g[j], g[k], g[m]], core));
        }
      }
    }
  }
  return result;
}

type PackEntry = {
  gs1: GemSet;
  gs2: GemSet | null;
  gs3: GemSet | null;
  maxScore: number;
  minScore: number;
  stability: number;
};

function popcount(n: bigint): number {
  let count = 0;
  while (n > 0n) {
    count += Number(n & 1n);
    n >>= 1n;
  }
  return count;
}

function computeStability(
  gs1: GemSet,
  gs2: GemSet | null,
  gs3: GemSet | null,
  bitmasks?: bigint[]
): number {
  if (!bitmasks) return 0;
  let overlap = 0;
  if (bitmasks[0] !== undefined) overlap += popcount(gs1.bitmask & bitmasks[0]);
  if (gs2 && bitmasks[1] !== undefined) overlap += popcount(gs2.bitmask & bitmasks[1]);
  if (gs3 && bitmasks[2] !== undefined) overlap += popcount(gs3.bitmask & bitmasks[2]);
  return overlap;
}

export function getBestGemSetPacks(
  gssList: GemSet[][],
  scoreMaps: [number, number][][],
  ignoreDuplication = false,
  onProgress?: GemSetPackProgressCallback,
  currentBitmasks?: bigint[]
): GemSetPack[] {
  if (gssList.length > 3) throw Error('length of gsss should be one of 1, 2, 3');
  const [gss1, gss2, gss3] = gssList;

  // Deduplicate by (att|skill|boss|coreScore) key — identical keys yield identical scores in Phase 3
  const answerMap = new Map<string, PackEntry>();
  let targetMin = 0; // Largest lower bound (min) of the combat-power range found so far

  // validate
  [gss1, gss2, gss3].forEach((gss) => {
    if (gss === undefined || gss.length == 0) return;
    if (gss.some((gs) => gs.maxScore == -1 || gs.minScore == -1)) {
      throw Error('maxScore and minScore is not set');
    }
  });
  if (gss1) gss1.sort((a, b) => b.maxScore - a.maxScore);
  if (gss2) gss2.sort((a, b) => b.maxScore - a.maxScore);
  if (gss3) gss3.sort((a, b) => b.maxScore - a.maxScore);

  let lastProgressBucket = -1;
  function emitProgress(current: number, total: number) {
    if (!onProgress || total <= 0) return;
    const bucket = Math.floor((current * 1000) / total);
    if (bucket === lastProgressBucket && current < total) return;
    lastProgressBucket = bucket;
    onProgress({ current, total });
  }

  // Binary search helper
  function binarySearchThreshold(gss: GemSet[], threshold: number): number {
    let left = 0;
    let right = gss.length;

    while (left < right) {
      const mid = (left + right) >>> 1;
      if (gss[mid].maxScore >= threshold) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }
    return left;
  }

  function estimateOuterLoopTotal(remainingMaxScoreProduct: number, current: number) {
    if (!Number.isFinite(remainingMaxScoreProduct) || remainingMaxScoreProduct <= 0) {
      return Math.max(current, gss1.length);
    }

    const threshold = targetMin / remainingMaxScoreProduct;
    return Math.max(current, binarySearchThreshold(gss1, threshold));
  }

  function* getCandidatesGenerator(
    currentBitmask: bigint,
    gemSetIndex: number,
    threshold: number
  ): Generator<GemSet> {
    const gss = gssList[gemSetIndex];

    // Find the end of the valid range via binary search
    const maxValidIdx = binarySearchThreshold(gss, threshold);

    // Lazily yield only as many as needed
    for (let i = 0; i < maxValidIdx; i++) {
      const gs = gss[i];
      if (ignoreDuplication || (gs.bitmask & currentBitmask) === 0n) {
        yield gs;
      }
    }
  }
  const getCandidates = getCandidatesGenerator;

  // Compute scores inline without constructing a GemSetPack (same operation order as the GemSetPack constructor)
  function inlineScores(gs1: GemSet, gs2: GemSet | null, gs3: GemSet | null) {
    const att = gs1.att + (gs2?.att ?? 0) + (gs3?.att ?? 0);
    const skill = gs1.skill + (gs2?.skill ?? 0) + (gs3?.skill ?? 0);
    const boss = gs1.boss + (gs2?.boss ?? 0) + (gs3?.boss ?? 0);
    const coreScore =
      (((((gs1.coreCoeff + 10000) / 10000) * ((gs2?.coreCoeff ?? 0) + 10000)) / 10000) *
        ((gs3?.coreCoeff ?? 0) + 10000)) /
      10000;
    const maxScore =
      coreScore * scoreMaps[0][att][1] * scoreMaps[1][skill][1] * scoreMaps[2][boss][1];
    const minScore =
      coreScore * scoreMaps[0][att][0] * scoreMaps[1][skill][0] * scoreMaps[2][boss][0];
    return { att, skill, boss, coreScore, maxScore, minScore };
  }

  function upsertPack(
    gs1: GemSet,
    gs2: GemSet | null,
    gs3: GemSet | null,
    att: number,
    skill: number,
    boss: number,
    coreScore: number,
    maxScore: number,
    minScore: number
  ) {
    const key = `${att}|${skill}|${boss}|${coreScore}`;
    const stability = computeStability(gs1, gs2, gs3, currentBitmasks);
    const existing = answerMap.get(key);
    if (!existing || stability > existing.stability) {
      answerMap.set(key, { gs1, gs2, gs3, maxScore, minScore, stability });
    }
  }

  /* 0 cores */
  if (gssList.length == 0) return [];
  /* 1 core */
  if (gssList.length == 1) {
    for (const gs of gss1) {
      const { att, skill, boss, coreScore, maxScore, minScore } = inlineScores(gs, null, null);
      if (maxScore > targetMin) {
        upsertPack(gs, null, null, att, skill, boss, coreScore, maxScore, minScore);
      }
      if (minScore > targetMin) {
        targetMin = minScore;
      }
    }
  }

  /* 2 cores */
  if (gssList.length == 2) {
    const gm2 = gss2.length > 0 ? gss2[0].maxScore : 1;
    let current = 0;
    for (const gs1 of gss1) {
      current += 1;
      emitProgress(current, estimateOuterLoopTotal(gm2, current));
      if (gs1.maxScore * gm2 < targetMin) break;

      for (const gs2 of getCandidates(gs1.bitmask, 1, targetMin / gs1.maxScore)) {
        const { att, skill, boss, coreScore, maxScore, minScore } = inlineScores(gs1, gs2, null);
        if (maxScore > targetMin) {
          upsertPack(gs1, gs2, null, att, skill, boss, coreScore, maxScore, minScore);
        }
        if (minScore > targetMin) {
          targetMin = minScore;
        }
      }
    }
  }

  /* 3 cores */
  if (gssList.length == 3) {
    const gm2 = gss2.length > 0 ? gss2[0].maxScore : 1;
    const gm3 = gss3.length > 0 ? gss3[0].maxScore : 1;

    let current = 0;
    for (const gs1 of gss1) {
      current += 1;
      emitProgress(current, estimateOuterLoopTotal(gm2 * gm3, current));
      if (gs1.maxScore * gm2 * gm3 < targetMin) break;
      for (const gs2 of getCandidates(gs1.bitmask, 1, targetMin / (gs1.maxScore * gm3))) {
        if (gs1.maxScore * gs2.maxScore * gm3 < targetMin) break;
        for (const gs3 of getCandidates(
          gs1.bitmask | gs2.bitmask,
          2,
          targetMin / (gs1.maxScore * gs2.maxScore)
        )) {
          if (gs1.maxScore * gs2.maxScore * gs3.maxScore < targetMin) break;
          const { att, skill, boss, coreScore, maxScore, minScore } = inlineScores(gs1, gs2, gs3);
          if (maxScore > targetMin) {
            upsertPack(gs1, gs2, gs3, att, skill, boss, coreScore, maxScore, minScore);
          }
          if (minScore > targetMin) {
            targetMin = minScore;
          }
        }
      }
    }
  }

  // If maxScore is below targetMin, it is not even a candidate
  const entries = [...answerMap.values()].filter((e) => e.maxScore >= targetMin);
  entries.sort((a, b) => b.maxScore - a.maxScore || b.stability - a.stability);
  return entries.map(
    ({ gs1, gs2, gs3, stability }) => new GemSetPack(gs1, gs2, gs3, scoreMaps, stability)
  );
}
