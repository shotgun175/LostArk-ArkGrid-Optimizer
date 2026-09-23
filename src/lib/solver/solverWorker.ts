import type { ArkGridGem, ArkGridGemOptionName } from '../models/arkGridGems';
import {
  Core,
  Gem,
  GemSet,
  GemSetPack,
  GemSetPackTuple,
  buildScoreMap,
  gemOptionLevelCoeffs,
  gemOptionLevelCoeffsSupporter,
} from './models';
import { getBestGemSetPacks, getMaxStat, getPossibleGemSets } from './solver';
import type {
  SolverProgress,
  SolverProgressStage,
  SolverRunPayload,
  SolverRunResult,
  SolverWorkerRequest,
  SolverWorkerResponse,
  WorkerCore,
} from './types';

const perfectGems = [
  {
    req: 3,
    point: 5,
    option1: { optionType: 'AtkPower', value: 5 },
    option2: {
      optionType: 'AddDamage',
      value: 5,
    },
  },
  {
    req: 4,
    point: 5,
    option1: { optionType: 'AtkPower', value: 5 },
    option2: {
      optionType: 'BossDamage',
      value: 5,
    },
  },
  {
    req: 5,
    point: 5,
    option1: {
      optionType: 'AddDamage',
      value: 5,
    },
    option2: {
      optionType: 'BossDamage',
      value: 5,
    },
  },
] satisfies Partial<ArkGridGem>[];

const perfectGemsSupporter = [
  {
    req: 3,
    point: 5,
    option1: { optionType: 'BrandPower', value: 5 },
    option2: {
      optionType: 'AllyDamageEnh',
      value: 5,
    },
  },
  {
    req: 4,
    point: 5,
    option1: { optionType: 'AllyDamageEnh', value: 5 },
    option2: {
      optionType: 'AllyAttackEnh',
      value: 5,
    },
  },
  {
    req: 5,
    point: 5,
    option1: {
      optionType: 'BrandPower',
      value: 5,
    },
    option2: {
      optionType: 'AllyAttackEnh',
      value: 5,
    },
  },
] satisfies Partial<ArkGridGem>[];

const STAGE_RANGES: Record<SolverProgressStage, [number, number]> = {
  preparing: [0, 10],
  searching_order_packs: [10, 50],
  searching_chaos_packs: [50, 90],
  combining_results: [90, 95],
  finalizing: [99, 100],
};

type ProgressReporter = (progress: SolverProgress) => void;

type SolveOptions = {
  isSupporter?: boolean;
  perfectSolve?: boolean;
  orderCurrentBitmasks?: bigint[];
  chaosCurrentBitmasks?: bigint[];
};

type SolveResultInternal = {
  answer: GemSetPackTuple;
  assignedGemIndexes: number[][];
};

function toCore(core: WorkerCore) {
  return new Core(core.energy, core.point, core.coeff);
}

function convertToSolverGems(
  gems: ArkGridGem[],
  isSupporter: boolean
): {
  gems: Gem[];
} {
  const optionIndexMap: ArkGridGemOptionName[] = isSupporter
    ? ['AllyDamageEnh', 'BrandPower', 'AllyAttackEnh']
    : ['AtkPower', 'AddDamage', 'BossDamage'];

  return {
    gems: gems.map((gem, index) => {
      const coeff = [0, 0, 0];

      for (const option of [gem.option1, gem.option2]) {
        const optionIndex = optionIndexMap.findIndex((name) => name === option.optionType);
        if (optionIndex === -1) {
          continue;
        }
        coeff[optionIndex] += option.value;
      }

      return new Gem(BigInt(index), gem.req, gem.point, coeff[0], coeff[1], coeff[2]);
    }),
  };
}

function assignGemIndexes(gs: GemSet | null | undefined): number[] {
  if (!gs) {
    return [];
  }

  let bitmask = gs.bitmask;
  let index = 0;
  const result: number[] = [];

  while (bitmask > 0n) {
    if ((bitmask & 1n) === 1n) {
      result.push(index);
    }
    index += 1;
    bitmask >>= 1n;
  }

  return result;
}

function emitProgress(
  report: ProgressReporter | undefined,
  stage: SolverProgressStage,
  stagePercent: number,
  extra?: Omit<SolverProgress, 'stage' | 'stagePercent' | 'totalPercent'>
) {
  if (!report) {
    return;
  }

  const boundedStagePercent = Math.max(0, Math.min(100, stagePercent));
  const [start, end] = STAGE_RANGES[stage];
  const totalPercent = start + ((end - start) * boundedStagePercent) / 100;

  report({
    stage,
    stagePercent: boundedStagePercent,
    totalPercent,
    ...extra,
  });
}

function solve(
  rawOrderCores: WorkerCore[],
  rawChaosCores: WorkerCore[],
  inOrderGems: ArkGridGem[],
  inChaosGems: ArkGridGem[],
  {
    isSupporter = false,
    perfectSolve = false,
    orderCurrentBitmasks,
    chaosCurrentBitmasks,
  }: SolveOptions = {},
  report?: ProgressReporter
): SolveResultInternal {
  emitProgress(report, 'preparing', 0);
  const orderCores = rawOrderCores.map(toCore);
  const chaosCores = rawChaosCores.map(toCore);

  const { gems: orderGems } = convertToSolverGems(inOrderGems, isSupporter);
  const { gems: chaosGems } = convertToSolverGems(inChaosGems, isSupporter);

  const orderGssList = orderCores.map((core) => getPossibleGemSets(core, orderGems));
  const chaosGssList = chaosCores.map((core) => getPossibleGemSets(core, chaosGems));

  if (perfectSolve) {
    for (const gssList of [orderGssList, chaosGssList]) {
      for (let i = 0; i < gssList.length; i++) {
        const gss = gssList[i];
        const seen = new Set<string>();
        const uniqueGss: GemSet[] = [];

        for (const gs of gss) {
          const key = JSON.stringify({
            att: gs.att,
            skill: gs.skill,
            boss: gs.boss,
            coreScore: gs.coreCoeff,
          });
          if (!seen.has(key)) {
            seen.add(key);
            uniqueGss.push(gs);
          }
        }

        gssList[i] = uniqueGss;
      }
    }
  }

  const allGssList = orderGssList.concat(chaosGssList);
  let attMax = 0;
  let skillMax = 0;
  let bossMax = 0;

  for (const gss of allGssList) {
    attMax += getMaxStat(gss, 'att');
    skillMax += getMaxStat(gss, 'skill');
    bossMax += getMaxStat(gss, 'boss');
  }

  const gemOptionCoeff = isSupporter ? gemOptionLevelCoeffsSupporter : gemOptionLevelCoeffs;
  const scoreMaps = [
    buildScoreMap(gemOptionCoeff[0], attMax),
    buildScoreMap(gemOptionCoeff[1], skillMax),
    buildScoreMap(gemOptionCoeff[2], bossMax),
  ];

  for (const gss of allGssList) {
    for (const gs of gss) {
      gs.setScoreRange(scoreMaps);
    }
  }

  emitProgress(report, 'preparing', 100);

  emitProgress(report, 'searching_order_packs', 0);
  const orderGspList: GemSetPack[] = getBestGemSetPacks(
    orderGssList,
    scoreMaps,
    perfectSolve,
    ({ current, total }) => {
      emitProgress(report, 'searching_order_packs', (current / total) * 100, {
        current,
        total,
      });
    },
    orderCurrentBitmasks
  );
  emitProgress(report, 'searching_order_packs', 100);

  emitProgress(report, 'searching_chaos_packs', 0);
  const chaosGspList: GemSetPack[] = getBestGemSetPacks(
    chaosGssList,
    scoreMaps,
    perfectSolve,
    ({ current, total }) => {
      emitProgress(report, 'searching_chaos_packs', (current / total) * 100, {
        current,
        total,
      });
    },
    chaosCurrentBitmasks
  );
  emitProgress(report, 'searching_chaos_packs', 100);

  let answer = new GemSetPackTuple(orderGspList[0] ?? null, chaosGspList[0] ?? null, isSupporter);

  // Cross-product combining step for globally optimal assignment
  {
    emitProgress(report, 'combining_results', 0);
    const gemSetPackSet: GemSetPack[][] = [[], []];

    for (const [i, gspList] of [orderGspList, chaosGspList].entries()) {
      const seen = new Set<string>();
      const total = gspList.length;
      let current = 0;
      for (const gsp of gspList) {
        current += 1;
        emitProgress(report, 'combining_results', ((i + current / Math.max(total, 1)) / 4) * 100, {
          current,
          total,
        });
        const key = `${gsp.att}|${gsp.skill}|${gsp.boss}|${gsp.coreScore}`;
        if (!seen.has(key)) {
          seen.add(key);
          gemSetPackSet[i].push(gsp);
        }
      }
    }

    if (gemSetPackSet[0].length > 0 && gemSetPackSet[1].length > 0) {
      const total = gemSetPackSet[0].length;
      let current = 0;
      for (const gsp1 of gemSetPackSet[0]) {
        current += 1;
        emitProgress(report, 'combining_results', 50 + (current / total) * 50, { current, total });
        for (const gsp2 of gemSetPackSet[1]) {
          const gspt = new GemSetPackTuple(gsp1, gsp2, isSupporter);
          if (
            gspt.score > answer.score ||
            (gspt.score == answer.score && gspt.stability > answer.stability)
          ) {
            answer = gspt;
          }
        }
      }
    }

    emitProgress(report, 'combining_results', 100);
  }

  return {
    answer,
    assignedGemIndexes: [
      assignGemIndexes(answer.gsp1?.gs1),
      assignGemIndexes(answer.gsp1?.gs2),
      assignGemIndexes(answer.gsp1?.gs3),
      assignGemIndexes(answer.gsp2?.gs1),
      assignGemIndexes(answer.gsp2?.gs2),
      assignGemIndexes(answer.gsp2?.gs3),
    ],
  };
}

function getPerfectScore(isSupporter: boolean) {
  const coeffs = isSupporter ? gemOptionLevelCoeffsSupporter : gemOptionLevelCoeffs;

  if (!isSupporter) {
    return (
      ((((((1.09 *
        1.09 *
        1.06 *
        1.04 *
        1.04 *
        1.04 *
        (Math.floor((60 * coeffs[0]) / 120) + 10000)) /
        10000) *
        (Math.floor((90 * coeffs[1]) / 120) + 10000)) /
        10000) *
        (Math.floor((90 * coeffs[2]) / 120) + 10000)) /
        10000 -
        1) *
      100
    );
  }

  return (
    ((((((1.0942 *
      1.0942 *
      1.033 *
      1.06 *
      1.06 *
      1.0353 *
      (Math.floor((60 * coeffs[0]) / 120) + 10000)) /
      10000) *
      (Math.floor((90 * coeffs[1]) / 120) + 10000)) /
      10000) *
      (Math.floor((90 * coeffs[2]) / 120) + 10000)) /
      10000 -
      1) *
    100
  );
}

function createProgressReporter(postProgress: ProgressReporter): ProgressReporter {
  let lastTotalPercent = -1;
  let lastStagePercent = -1;
  let lastStage: SolverProgressStage | null = null;

  return (progress) => {
    const roundedTotalPercent = Math.max(
      0,
      Math.min(100, Math.round(progress.totalPercent * 10) / 10)
    );
    const roundedStagePercent = Math.max(
      0,
      Math.min(100, Math.round(progress.stagePercent * 10) / 10)
    );

    if (
      roundedTotalPercent === lastTotalPercent &&
      roundedStagePercent === lastStagePercent &&
      progress.stage === lastStage
    ) {
      return;
    }

    lastTotalPercent = roundedTotalPercent;
    lastStagePercent = roundedStagePercent;
    lastStage = progress.stage;

    postProgress({
      ...progress,
      totalPercent: roundedTotalPercent,
      stagePercent: roundedStagePercent,
    });
  };
}

export function runSolve(payload: SolverRunPayload, report: ProgressReporter): SolverRunResult {
  const {
    orderCores,
    chaosCores,
    orderGems,
    chaosGems,
    isSupporter,
    orderCurrentBitmasks,
    chaosCurrentBitmasks,
    assignmentOnly,
  } = payload;

  const solved = solve(
    orderCores,
    chaosCores,
    orderGems,
    chaosGems,
    {
      isSupporter,
      orderCurrentBitmasks,
      chaosCurrentBitmasks,
    },
    report
  );

  const answer = solved.answer;

  // Endgame pass: downstream consumes only the assignment, so skip the perfect-gems best-score solve
  // below. It does not influence `assignedGemIndexes` (the assignment is fully decided by the main
  // solve above), so this returns the same assignment a full run would, proven in
  // solverWorker.assignmentOnly.test.ts. The discarded score set is returned zeroed.
  if (assignmentOnly) {
    emitProgress(report, 'finalizing', 100);
    return {
      assignedGemIndexes: solved.assignedGemIndexes,
      scoreSet: { score: 0, bestScore: 0, perfectScore: 0 },
    };
  }

  const perfectOrderGems: ArkGridGem[] = [];
  const perfectChaosGems: ArkGridGem[] = [];
  for (const gem of isSupporter ? perfectGemsSupporter : perfectGems) {
    for (let i = 0; i < 4; i++) {
      perfectOrderGems.push({ gemAttr: 'Order', ...gem });
      perfectChaosGems.push({ gemAttr: 'Chaos', ...gem });
    }
  }

  const score = (answer.score - 1) * 100;
  const bestScore =
    (solve(orderCores, chaosCores, perfectOrderGems, perfectChaosGems, {
      isSupporter,
      perfectSolve: true,
    }).answer.score -
      1) *
    100;

  emitProgress(report, 'finalizing', 100);

  return {
    assignedGemIndexes: solved.assignedGemIndexes,
    scoreSet: {
      score,
      bestScore,
      perfectScore: getPerfectScore(isSupporter),
    },
  };
}

// Guarded so the module can be imported in a non-worker context (e.g. Node unit tests, which import
// `runSolve` directly) without referencing the worker-only `self` global at load time.
if (typeof self !== 'undefined') {
  self.onmessage = (e: MessageEvent<SolverWorkerRequest>) => {
    const data = e.data;

    switch (data.type) {
      case 'runSolve':
        try {
          const report = createProgressReporter((progress) => {
            self.postMessage({
              type: 'runSolve:progress',
              progress,
            } satisfies SolverWorkerResponse);
          });

          self.postMessage({
            type: 'runSolve:done',
            result: runSolve(data.payload, report),
          } satisfies SolverWorkerResponse);
        } catch (error) {
          self.postMessage({
            type: 'runSolve:error',
            message: error instanceof Error ? error.message : String(error),
          } satisfies SolverWorkerResponse);
        }
        break;
    }
  };
}
