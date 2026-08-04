import {
  type ArkGridGemOptionName,
  ArkGridGemOptionNames,
  ArkGridGemOptionTypes,
} from '../models/arkGridGemSpecs';
import type { SolveAnswer, SolveAnswerScoreSet } from '../state/profile.state.svelte';

/**
 * The grid's progress toward THE BEST ITS CURRENT CORES COULD DO, which is what the solver's
 * `bestScore` already means: a full solve with perfect gems on the cores you actually own. Better
 * gems close the gap to it; better CORES move it. `perfectScore` is the theoretical maximum ignoring
 * your cores, kept only as faint context beyond the ceiling so the ceiling stays the target.
 */
export type GridProgress = {
  /** Current combat power increase, in percent. */
  current: number;
  /** The ceiling: perfect gems on the current cores, in percent. */
  ceiling: number;
  /** Theoretical maximum ignoring current cores, in percent. */
  perfect: number;
  /** Headline: how far to the ceiling, 0-100. */
  pctOfCeiling: number;
  /** Fill width as a percentage of the full track. */
  fillPos: number;
  /** Where the ceiling divider sits on the full track, as a percentage. */
  ceilingPos: number;
};

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

/** Null when there is no usable solve: a missing scoreSet, or the {0,0,0} an assignment-only solve emits. */
export function computeGridProgress(
  scoreSet: SolveAnswerScoreSet | undefined
): GridProgress | null {
  if (!scoreSet) return null;
  const { score, bestScore, perfectScore } = scoreSet;
  if (!(bestScore > 0)) return null;
  // The track runs to `perfect` so the leftover beyond the ceiling can be shown as context. A
  // malformed set where perfect does not exceed the ceiling falls back to a ceiling-length track,
  // which keeps the ceiling reachable at the track end instead of pushing it off the bar.
  const track = perfectScore > bestScore ? perfectScore : bestScore;
  return {
    current: score,
    ceiling: bestScore,
    perfect: perfectScore,
    pctOfCeiling: clampPct((score / bestScore) * 100),
    fillPos: clampPct((score / track) * 100),
    ceilingPos: clampPct((bestScore / track) * 100),
  };
}

export type OptionLevelRow = { name: string; level: number };

/** Summed option levels across every gem the solve assigned, in the canonical option order. */
export function sumOptionLevels(solveAnswer: SolveAnswer | undefined): OptionLevelRow[] {
  const totals = {} as Record<ArkGridGemOptionName, number>;
  for (const n of ArkGridGemOptionNames) totals[n] = 0;
  for (const coreGems of solveAnswer?.assignedGems ?? []) {
    for (const gem of coreGems) {
      totals[gem.option1.optionType] += gem.option1.value;
      totals[gem.option2.optionType] += gem.option2.value;
    }
  }
  return ArkGridGemOptionNames.filter((n) => totals[n] > 0).map((n) => ({
    name: ArkGridGemOptionTypes[n].name.en_us,
    level: totals[n],
  }));
}
