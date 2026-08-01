import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { ParsedAdvisorState } from './advisorController';
import { FLAG_BAR, buildSuccessors, costFromCm, seedFromParse, type ApplyOutcomeFn } from './fusion';

const require_ = createRequire(import.meta.url);
const applyOutcome = require_('./vendor/model/nested.js').applyOutcome as ApplyOutcomeFn;

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

describe('buildSuccessors', () => {
  it('raise/lower go through the vendored applyOutcome with level clamping', () => {
    const prior = seedFromParse(mkParse());
    const succ = buildSuccessors(prior, applyOutcome);
    expect(succ[0].config.willpowerLevel).toBe(3); // raise willpower +1 from 2
    expect(succ[1].config.effect1Level).toBe(2); // lower effect1 -1 from 3
    expect(succ[0].config.effect1Level).toBe(3); // untouched fields carry over
  });

  it('clamps at the 1 and 5 bounds', () => {
    const p = mkParse();
    p.config.willpowerLevel = 5;
    p.outcomes[0] = { type: 'raise_effect', target: 'willpower', amount: 2 };
    p.outcomes[1] = { type: 'lower_effect', target: 'order', amount: 3 };
    p.config.orderLevel = 1;
    const succ = buildSuccessors(seedFromParse(p), applyOutcome);
    expect(succ[0].config.willpowerLevel).toBe(5);
    expect(succ[1].config.orderLevel).toBe(1);
  });

  it('change_gold_cost moves the multiplier via tile.change and derives the display cost', () => {
    const succ = buildSuccessors(seedFromParse(mkParse()), applyOutcome);
    expect(succ[2].state.processCostMultiplier).toBe(-100);
    expect(succ[2].state.processCost).toBe(0);
    expect(costFromCm(100)).toBe(1800);
    expect(costFromCm(0)).toBe(900);
  });

  it('change_side_option pins levels and marks the slot as a fresh name read', () => {
    const p = mkParse();
    p.outcomes[3] = { type: 'change_side_option', target: 'effect2' };
    const succ = buildSuccessors(seedFromParse(p), applyOutcome);
    expect(succ[3].nameChangeSlot).toBe('effect2');
    expect(succ[3].config.effect2Level).toBe(1); // level preserved from prior
    expect(succ[3].config.effect2).toBe('Boss Damage'); // name field left as prior; matching treats it specially
  });

  it('reroll_increase adds tile.change to rerolls; do_nothing changes nothing', () => {
    const p = mkParse();
    p.outcomes[3] = { type: 'reroll_increase', change: 2 };
    const succ = buildSuccessors(seedFromParse(p), applyOutcome);
    expect(succ[3].state.rerollsRemaining).toBe(4);
    const still = buildSuccessors(seedFromParse(mkParse()), applyOutcome)[3];
    expect(still.state).toEqual({});
    expect(still.config).toEqual(mkParse().config);
  });

  it('tileQuality mirrors the remembered per-tile quality', () => {
    const succ = buildSuccessors(seedFromParse(mkParse()), applyOutcome);
    expect(succ.map((s) => s.tileQuality)).toEqual(['hard', 'hard', 'soft', 'hard']);
  });
});
