import { describe, expect, it } from 'vitest';
import type { ParsedAdvisorState } from './advisorController';
import { FLAG_BAR, seedFromParse } from './fusion';

export function mkParse(over: Partial<ParsedAdvisorState> = {}): ParsedAdvisorState {
  return {
    config: {
      baseCost: 8, gemType: 'order',
      willpowerLevel: 2, orderLevel: 1,
      effect1: 'Attack Power', effect1Level: 3,
      effect2: 'Boss Damage', effect2Level: 1,
    },
    state: { currentTurn: 3, maxTurns: 9, rerollsRemaining: 2, processCost: 900, processCostMultiplier: 0, rosterBound: false },
    outcomes: [
      { type: 'raise_effect', target: 'willpower', amount: 1 },
      { type: 'lower_effect', target: 'effect1', amount: 1 },
      { type: 'change_gold_cost', change: -100 },
      { type: 'do_nothing' },
    ],
    rarity: 'epic',
    confidence: {
      config: { baseCost: 0.95, gemType: 0.95, willpowerLevel: 0.9, orderLevel: 0.7, effect1: 0.95, effect1Level: 0.85, effect2: 0.95, effect2Level: 0.85 },
      state: { currentTurn: 0.96, maxTurns: 0.96, rerollsRemaining: 0.92, processCost: 0.85, processCostMultiplier: 0.85 },
      outcomes: [0.9, 0.9, 0.75, 0.9],
    },
    ...over,
  } as ParsedAdvisorState;
}

describe('seedFromParse', () => {
  it('maps confidences to hard/soft at the flag bar', () => {
    const prior = seedFromParse(mkParse());
    expect(prior.quality.config.willpowerLevel).toBe('hard'); // 0.9
    expect(prior.quality.config.orderLevel).toBe('soft'); // 0.7
    expect(prior.quality.outcomes).toEqual(['hard', 'hard', 'soft', 'hard']);
    expect(FLAG_BAR).toBe(0.8);
  });

  it('treats an absent confidence map as all-hard (manual entry semantics)', () => {
    const prior = seedFromParse(mkParse({ confidence: undefined }));
    expect(prior.quality.config.orderLevel).toBe('hard');
    expect(prior.quality.state.currentTurn).toBe('hard');
    expect(prior.quality.outcomes).toEqual(['hard', 'hard', 'hard', 'hard']);
  });

  it('deep-copies so later mutation of the parse cannot corrupt the memory', () => {
    const p = mkParse();
    const prior = seedFromParse(p);
    p.config.willpowerLevel = 5;
    p.outcomes[0].amount = 4;
    expect(prior.config.willpowerLevel).toBe(2);
    expect(prior.outcomes[0].amount).toBe(1);
  });
});
