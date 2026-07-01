import type { ArkGridAttr } from '../constants/enums';
import type { ArkGridGem } from '../models/arkGridGems';
import type { GemSetPackTuple } from './models';

export type WorkerCore = {
  energy: number;
  point: number;
  coeff: number[];
};

export type SolverScoreSet = {
  score: number;
  bestScore: number;
  perfectScore: number;
};

export type SolverProgressStage =
  | 'preparing'
  | 'searching_order_packs'
  | 'searching_chaos_packs'
  | 'combining_results'
  | 'simulating_launcher_gems'
  | 'finalizing';

export type SolverProgress = {
  stage: SolverProgressStage;
  totalPercent: number;
  stagePercent: number;
  attr?: ArkGridAttr;
  current?: number;
  total?: number;
};

export type SolverAdditionalGemResult = Record<
  ArkGridAttr,
  Record<
    string,
    {
      corePointTuple: [number, number, number];
      gems: ArkGridGem[];
      score: number;
    }
  >
>;

export type SolverRunPayload = {
  orderCores: WorkerCore[];
  chaosCores: WorkerCore[];
  orderGems: ArkGridGem[];
  chaosGems: ArkGridGem[];
  isSupporter: boolean;
  // Per-attr stability tiebreaker bitmasks — separate because order/chaos gem indices are
  // independent arrays, so a single shared bitmask would be meaningless for both sides.
  orderCurrentBitmasks?: bigint[];
  chaosCurrentBitmasks?: bigint[];
  // Compute only the gem assignment: skip the perfect-gems "best score" solve and the launcher-gem
  // simulation. The endgame pass sets this because it consumes only `assignedGemIndexes` — the score
  // set, additional-gem result, and launcher flags it would otherwise produce are discarded. The
  // skipped work never feeds the assignment, so the result is identical to a full run (see
  // solverWorker.assignmentOnly.test.ts).
  assignmentOnly?: boolean;
};

export type SolverRunResult = {
  assignedGemIndexes: number[][];
  gemSetPackTuple: GemSetPackTuple;
  scoreSet: SolverScoreSet;
  additionalGemResult: SolverAdditionalGemResult;
  needLauncherGem: Record<ArkGridAttr, boolean>;
};

export type SolverWorkerRequest = {
  type: 'runSolve';
  payload: SolverRunPayload;
};

export type SolverWorkerResponse =
  | {
      type: 'runSolve:progress';
      progress: SolverProgress;
    }
  | {
      type: 'runSolve:done';
      result: SolverRunResult;
    }
  | {
      type: 'runSolve:error';
      message: string;
    };
