import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { ParsedAdvisorState } from './advisorController';
import { FLAG_BAR, buildSuccessors, contradicts, costFromCm, inferAction, seedFromParse, type ApplyOutcomeFn, type FusionPrior } from './fusion';

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

function hardPrior(): FusionPrior {
  return seedFromParse(mkParse({ confidence: undefined })); // all-hard
}

function at(turn: number, over: Partial<ParsedAdvisorState> = {}): ParsedAdvisorState {
  const p = mkParse(over);
  p.state.currentTurn = turn;
  return p;
}

describe('inferAction', () => {
  it('turn delta 0 is still (reroll or re-read)', () => {
    expect(inferAction(hardPrior(), at(3), applyOutcome)).toEqual({ kind: 'still', turnQuality: 'hard' });
  });

  it('turn delta 1 is process with four successors', () => {
    const inf = inferAction(hardPrior(), at(4), applyOutcome);
    expect(inf.kind).toBe('process');
    if (inf.kind === 'process') expect(inf.successors).toHaveLength(4);
  });

  it('turn jumping 2+ or backwards (Reset) is desync', () => {
    expect(inferAction(hardPrior(), at(5), applyOutcome).kind).toBe('desync');
    expect(inferAction(hardPrior(), at(2), applyOutcome).kind).toBe('desync');
  });

  it('confident gem identity mismatch is desync (gem switch)', () => {
    const p = at(4);
    p.config.gemType = 'chaos';
    expect(inferAction(hardPrior(), p, applyOutcome).kind).toBe('desync');
  });

  it('a confident name change is desync at delta 0, allowed at delta 1 with a change tile', () => {
    const changed = at(3);
    changed.config.effect2 = 'Additional Damage';
    expect(inferAction(hardPrior(), changed, applyOutcome).kind).toBe('desync');

    const prior = hardPrior();
    prior.outcomes[3] = { type: 'change_side_option', target: 'effect2' };
    const processed = at(4);
    processed.config.effect2 = 'Additional Damage';
    expect(inferAction(prior, processed, applyOutcome).kind).toBe('process');
  });

  it('soft turn read falls back to config matching', () => {
    const p = at(9); // nonsense turn value, but read softly
    (p.confidence as { state: Record<string, number> }).state.currentTurn = 0.3;
    // config identical to prior means still
    expect(inferAction(hardPrior(), p, applyOutcome).kind).toBe('still');
  });
});

describe('contradicts', () => {
  it('a confident field mismatch kills a successor; a soft one does not', () => {
    const prior = hardPrior();
    const succ = buildSuccessors(prior, applyOutcome);
    const p = at(4);
    p.config.willpowerLevel = 2; // raise-willpower successor expects 3
    expect(contradicts(succ[0], prior, p)).toBe(true); // willpowerLevel conf 0.9 in mkParse
    (p.confidence as { config: Record<string, number> }).config.willpowerLevel = 0.5;
    expect(contradicts(succ[0], prior, p)).toBe(false);
  });

  it('rerollsRemaining never kills a successor (Charge purchases are legal outside tiles)', () => {
    const prior = hardPrior();
    prior.outcomes[0] = { type: 'reroll_increase', change: 1 };
    const succ = buildSuccessors(prior, applyOutcome);
    const p = at(4);
    p.state.rerollsRemaining = 0; // wildly off the +1 expectation, confidently read
    expect(contradicts(succ[0], prior, p)).toBe(false);
  });

  it('a changed-slot name confidently EQUAL to the prior kills that change successor', () => {
    const prior = hardPrior();
    prior.outcomes[3] = { type: 'change_side_option', target: 'effect2' };
    const succ = buildSuccessors(prior, applyOutcome);
    const p = at(4); // effect2 still Boss Damage at 0.95
    expect(contradicts(succ[3], prior, p)).toBe(true);
  });

  it('a changed-slot name confidently DIFFERENT from the prior does not kill that change successor', () => {
    const prior = hardPrior();
    prior.outcomes[3] = { type: 'change_side_option', target: 'effect2' };
    const succ = buildSuccessors(prior, applyOutcome);
    const p = at(4);
    p.config.effect2 = 'Additional Damage'; // changed from Boss Damage at high confidence
    (p.confidence as { config: Record<string, number> }).config.effect2 = 0.95;
    expect(contradicts(succ[3], prior, p)).toBe(false);
  });
});

describe('inferAction soft-turn branches', () => {
  it('soft turn read + config matching exactly one successor returns process', () => {
    const prior = hardPrior();
    const p = at(9); // nonsense turn but read softly
    (p.confidence as { state: Record<string, number> }).state.currentTurn = 0.3;
    // Confidently read willpowerLevel 3, which only the raise-willpower successor has
    p.config.willpowerLevel = 3;
    (p.confidence as { config: Record<string, number> }).config.willpowerLevel = 0.95;
    // Everything else matches prior with high confidence
    const inf = inferAction(prior, p, applyOutcome);
    expect(inf.kind).toBe('process');
    if (inf.kind === 'process') {
      expect(inf.turnQuality).toBe('soft');
      expect(inf.successors).toHaveLength(4); // all successors returned for caller to filter
    }
  });

  it('soft turn read + ambiguous config (matches multiple successors) returns desync', () => {
    const prior = hardPrior();
    const p = at(9); // nonsense turn but read softly
    (p.confidence as { state: Record<string, number> }).state.currentTurn = 0.3;
    // Set a config that matches the prior perfectly (no change detected)
    // but lower enough other confidences that stillContradiction becomes true
    // e.g., raise effect1Level to 4 with high confidence
    p.config.effect1Level = 4;
    (p.confidence as { config: Record<string, number> }).config.effect1Level = 0.95;
    // Soften other confidences so multiple successors could be viable
    (p.confidence as { config: Record<string, number> }).config.effect1 = 0.3;
    const inf = inferAction(prior, p, applyOutcome);
    expect(inf.kind).toBe('desync');
    if (inf.kind === 'desync') {
      expect(inf.reason).toBe('soft turn read and ambiguous config');
    }
  });

  it('soft turn read + no successors viable due to confident mismatch returns desync', () => {
    const prior = hardPrior();
    const p = at(9); // nonsense turn but read softly
    (p.confidence as { state: Record<string, number> }).state.currentTurn = 0.3;
    // Set a config that doesn't match any successor and is read with high confidence
    // e.g., willpowerLevel 5 when all successors expect 2 or 3
    p.config.willpowerLevel = 5;
    (p.confidence as { config: Record<string, number> }).config.willpowerLevel = 0.95;
    // Keep others high to make still clear, but this one mismatch kills all successors
    const inf = inferAction(prior, p, applyOutcome);
    expect(inf.kind).toBe('desync');
  });
});
