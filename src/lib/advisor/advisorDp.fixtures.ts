// Parsed Processing-window states copied from shizukaziye's astrogem-calculator samples/ (these are
// game-state values, NOT his labeled image corpus, so they are safe to commit). Shape = exactly what
// the vendored topLevelAdvice reads: config + turn state + the four drawn outcomes, flattened.
export interface AdvisorGemConfig {
  baseCost: number;
  gemType: 'order' | 'chaos';
  willpowerLevel: number;
  orderLevel: number;
  effect1: string;
  effect1Level: number;
  effect2: string;
  effect2Level: number;
}
export interface AdvisorOutcome {
  type: string;
  target?: string;
  amount?: number;
  newEffect?: string;
}
export interface AdvisorState {
  config: AdvisorGemConfig;
  currentTurn: number;
  maxTurns: number;
  rerollsRemaining: number;
  processCostMultiplier: number;
  rosterBound: boolean;
  outcomes: AdvisorOutcome[];
}

// t6-15pts: a real mid-cut epic sample (currentTurn 6 of 9), rerolls available, so only 4 turns
//   remain and Reset is not live: a fast Process/Reroll decision.
// uncommon-last-turn: a synthetic uncommon state (maxTurns 5) on its final turn, so Reset IS live.
//   Uncommon depth keeps the fresh-cut reset valuation fast (~0.4s vs ~3s+ at epic depth); the DP is
//   rarity-agnostic, so this still exercises the Reset action path for the smoke test.
export const DP_FIXTURES: Record<string, AdvisorState> = {
  't6-15pts': {
    config: {
      baseCost: 8,
      gemType: 'order',
      willpowerLevel: 5,
      orderLevel: 1,
      effect1: 'Attack Power',
      effect1Level: 5,
      effect2: 'Additional Damage',
      effect2Level: 4,
    },
    currentTurn: 6,
    maxTurns: 9,
    rerollsRemaining: 2,
    processCostMultiplier: 0,
    rosterBound: false,
    outcomes: [
      { type: 'raise_effect', target: 'effect2', amount: 1 },
      { type: 'change_side_option', target: 'effect1' },
      { type: 'lower_effect', target: 'effect1', amount: 1 },
      { type: 'raise_effect', target: 'order', amount: 1 },
    ],
  },
  'uncommon-last-turn': {
    config: {
      baseCost: 8,
      gemType: 'order',
      willpowerLevel: 4,
      orderLevel: 2,
      effect1: 'Attack Power',
      effect1Level: 2,
      effect2: 'Additional Damage',
      effect2Level: 2,
    },
    currentTurn: 5,
    maxTurns: 5,
    rerollsRemaining: 0,
    processCostMultiplier: 0,
    rosterBound: false,
    outcomes: [
      { type: 'raise_effect', target: 'effect1', amount: 1 },
      { type: 'raise_effect', target: 'order', amount: 1 },
      { type: 'lower_effect', target: 'effect2', amount: 1 },
      { type: 'change_side_option', target: 'effect1' },
    ],
  },
};
