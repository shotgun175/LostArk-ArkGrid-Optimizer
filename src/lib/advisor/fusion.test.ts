import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ParsedAdvisorState } from './advisorController';
import {
  type ApplyOutcomeFn,
  FLAG_BAR,
  type FusionPrior,
  buildSuccessors,
  contradicts,
  costFromCm,
  inferAction,
  seedFromParse,
} from './fusion';
import {
  ADOPT_HARD,
  ADOPT_SOFT,
  LIFT_AGREE_HARD,
  LIFT_AGREE_SOFT,
  LIFT_CEILING,
  fuse,
} from './fusion';

const require_ = createRequire(import.meta.url);
const applyOutcome = require_('./vendor/model/nested.js').applyOutcome as ApplyOutcomeFn;

export function mkParse(over: Partial<ParsedAdvisorState> = {}): ParsedAdvisorState {
  return {
    config: {
      baseCost: 8,
      gemType: 'order',
      willpowerLevel: 2,
      orderLevel: 1,
      effect1: 'Attack Power',
      effect1Level: 3,
      effect2: 'Boss Damage',
      effect2Level: 1,
    },
    state: {
      currentTurn: 3,
      maxTurns: 9,
      rerollsRemaining: 2,
      processCost: 900,
      processCostMultiplier: 0,
      rosterBound: false,
    },
    outcomes: [
      { type: 'raise_effect', target: 'willpower', amount: 1 },
      { type: 'lower_effect', target: 'effect1', amount: 1 },
      { type: 'change_gold_cost', change: -100 },
      { type: 'do_nothing' },
    ],
    rarity: 'epic',
    confidence: {
      config: {
        baseCost: 0.95,
        gemType: 0.95,
        willpowerLevel: 0.9,
        orderLevel: 0.7,
        effect1: 0.95,
        effect1Level: 0.85,
        effect2: 0.95,
        effect2Level: 0.85,
      },
      state: {
        currentTurn: 0.96,
        maxTurns: 0.96,
        rerollsRemaining: 0.92,
        processCost: 0.85,
        processCostMultiplier: 0.85,
      },
      outcomes: [0.9, 0.9, 0.75, 0.9],
    },
    ...over,
  } as ParsedAdvisorState;
}

/** Mirrors the ground-truth convention of omitting `outcomes` entirely for tooltip-occluded
 * captures (e.g. c10corpus/c10_7.json), not just leaving it empty. */
function withoutOutcomes(over: Partial<ParsedAdvisorState> = {}): ParsedAdvisorState {
  const raw = mkParse(over) as unknown as Record<string, unknown>;
  delete raw.outcomes;
  return raw as unknown as ParsedAdvisorState;
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

  it('tolerates a parse with no outcomes key: prior outcomes and quality.outcomes are both empty', () => {
    const prior = seedFromParse(withoutOutcomes()); // must not throw
    expect(prior.outcomes).toEqual([]);
    expect(prior.quality.outcomes).toEqual([]);
  });

  it('processCost quality borrows from the multiplier confidence (finding 3): a soft multiplier means soft processCost', () => {
    const p = mkParse();
    (p.confidence as { state: Record<string, number> }).state.processCostMultiplier = 0.4;
    const prior = seedFromParse(p);
    expect(prior.quality.state.processCost).toBe('soft');
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
    expect(inferAction(hardPrior(), at(3), applyOutcome)).toEqual({
      kind: 'still',
      turnQuality: 'hard',
    });
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

  it('a mismatched processCost never kills a change_gold_cost successor: it is derived, not checked at all', () => {
    const prior = hardPrior(); // mkParse's tile 2 is already change_gold_cost, change: -100
    const succ = buildSuccessors(prior, applyOutcome);
    const p = at(4);
    p.state.processCostMultiplier = -100; // matches the successor: isolates the test to processCost
    p.state.processCost = 12345; // wildly different from the expected costFromCm(-100) = 0
    // processCost is bijectively derived from processCostMultiplier (fuse() re-derives it after
    // fusing the multiplier), so contradicts() never inspects it, at any confidence.
    expect(contradicts(succ[2], prior, p)).toBe(false);
  });

  it('a genuinely contradicting processCostMultiplier, read confidently, kills the change_gold_cost successor', () => {
    const prior = hardPrior();
    const succ = buildSuccessors(prior, applyOutcome);
    const p = at(4);
    p.state.processCostMultiplier = 50; // genuinely different from the expected -100
    (p.confidence as { state: Record<string, number> }).state.processCostMultiplier = 0.9;
    expect(contradicts(succ[2], prior, p)).toBe(true);
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

const conf = (r: ParsedAdvisorState, f: string) =>
  (r.confidence as { config: Record<string, number> }).config[f];

describe('fuse', () => {
  it('no prior seeds and passes the parse through untouched', () => {
    const p = mkParse();
    const out = fuse(null, p, applyOutcome);
    expect(out.status).toBe('seeded');
    expect(out.result).toBe(p);
    expect(out.nextPrior.config.willpowerLevel).toBe(2);
  });

  it('still frame pins config: a soft misread level is adopted from a hard prior at ADOPT_HARD', () => {
    const p = mkParse(); // same turn as prior
    p.config.orderLevel = 3; // misread; prior says 1
    (p.confidence as { config: Record<string, number> }).config.orderLevel = 0.4;
    const out = fuse(hardPrior(), p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(out.result.config.orderLevel).toBe(1);
    expect(conf(out.result, 'orderLevel')).toBe(ADOPT_HARD);
  });

  it('soft chain caps adoption at ADOPT_SOFT (stays amber)', () => {
    const softPrior = seedFromParse(mkParse()); // orderLevel prior quality is soft (0.7)
    const p = mkParse();
    p.config.orderLevel = 3;
    (p.confidence as { config: Record<string, number> }).config.orderLevel = 0.4;
    const out = fuse(softPrior, p, applyOutcome);
    expect(out.result.config.orderLevel).toBe(1);
    expect(conf(out.result, 'orderLevel')).toBe(ADOPT_SOFT);
    expect(ADOPT_SOFT).toBeLessThan(0.8);
  });

  it('agreement lifts but never lowers pixel confidence', () => {
    const p = mkParse();
    const out = fuse(hardPrior(), p, applyOutcome);
    expect(conf(out.result, 'effect1')).toBe(0.95); // stays above the lift
    expect(conf(out.result, 'orderLevel')).toBe(LIFT_AGREE_HARD); // 0.7 lifted
    expect(LIFT_AGREE_HARD).toBeLessThanOrEqual(LIFT_CEILING);
  });

  it('process frame: unique viable successor pins the moved level', () => {
    const prior = hardPrior();
    const p = at(4);
    p.config.willpowerLevel = 3; // matches the raise-willpower successor
    // every other read confident, so the other three successors are contradicted
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(out.result.config.willpowerLevel).toBe(3);
    expect(conf(out.result, 'willpowerLevel')).toBeGreaterThanOrEqual(LIFT_AGREE_HARD);
  });

  it('adoption is observable: a soft misread field is actually rewritten, not left as a no-op', () => {
    const prior = hardPrior();
    const p = at(4);
    p.config.willpowerLevel = 3; // read confidently (0.9 default); uniquely selects raise-willpower,
    // killing lower_effect / change_gold_cost / do_nothing
    p.config.orderLevel = 3; // misread; prior/every viable successor says 1
    (p.confidence as { config: Record<string, number> }).config.orderLevel = 0.4;
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(out.result.config.orderLevel).toBe(1); // adopted, not left at the misread 3
    expect(conf(out.result, 'orderLevel')).toBe(ADOPT_HARD);
  });

  it('fields differing across multiple viable successors get no lift and no adoption', () => {
    // Prior is seeded from mkParse's OWN confidences (not hardPrior) so remembered tile 3's
    // 0.75 confidence stays soft, capping the whole process-frame chain (finding 1).
    const prior = seedFromParse(mkParse());
    const p = at(4);
    // Soften every read that distinguishes the four successors so all stay viable.
    const c = p.confidence as { config: Record<string, number>; state: Record<string, number> };
    c.config.willpowerLevel = 0.5;
    c.config.effect1Level = 0.5;
    c.state.processCost = 0.5;
    c.state.processCostMultiplier = 0.5;
    // Read low enough that the soft-capped lift (0.7) is distinguishable from a no-op fuse.
    c.config.effect2Level = 0.5;
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(out.result.config.willpowerLevel).toBe(p.config.willpowerLevel); // untouched
    expect(conf(out.result, 'willpowerLevel')).toBe(0.5); // no lift
    // effect2Level is identical across ALL successors, so it still fuses, but the remembered
    // tile set has a soft member (tile 3, 0.75), so the chain caps at LIFT_AGREE_SOFT.
    expect(conf(out.result, 'effect2Level')).toBe(LIFT_AGREE_SOFT);
  });

  it('one soft remembered tile caps the whole process-frame chain, even for a field an unrelated tile determines', () => {
    const seed = mkParse();
    const oc = (seed.confidence as { outcomes: number[] }).outcomes;
    oc[0] = 0.9;
    oc[1] = 0.5;
    oc[2] = 0.9;
    oc[3] = 0.9; // exactly one remembered tile is soft
    const prior = seedFromParse(seed);
    const p = at(4);
    p.config.willpowerLevel = 3; // read confidently; uniquely selects the raise-willpower successor
    // effect2Level agrees with every viable successor's value, but is itself read softly so the
    // lift is observable (a no-op fuse would leave it at 0.5, not raise it to 0.7).
    (p.confidence as { config: Record<string, number> }).config.effect2Level = 0.5;
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(conf(out.result, 'effect2Level')).toBe(LIFT_AGREE_SOFT);
  });

  it('soft turn inference caps the still-frame chain', () => {
    const prior = hardPrior();
    const p = at(3); // same turn as the prior, but the read itself is soft
    (p.confidence as { state: Record<string, number> }).state.currentTurn = 0.3;
    // config identical to prior (no confident differences), so inferAction falls back to still.
    // effect1Level agrees but is read softly, so the lift is observable.
    (p.confidence as { config: Record<string, number> }).config.effect1Level = 0.5;
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(conf(out.result, 'effect1Level')).toBe(LIFT_AGREE_SOFT);
  });

  it('confidence constants respect the ceiling and flag-bar invariants', () => {
    expect(ADOPT_HARD).toBeLessThanOrEqual(LIFT_CEILING);
    expect(LIFT_AGREE_SOFT).toBeLessThan(FLAG_BAR);
    expect(ADOPT_SOFT).toBeLessThan(FLAG_BAR);
  });

  it('zero viable successors is desync and reseeds from the parse', () => {
    const prior = hardPrior();
    const p = at(4);
    p.config.willpowerLevel = 5; // no tile explains a jump to 5 (raise is +1 from 2)
    p.config.effect1Level = 3;
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('desync');
    expect(out.result).toBe(p);
    expect(out.nextPrior.config.willpowerLevel).toBe(5);
  });

  it('rerollsRemaining is lift-only: never adopted from the prior', () => {
    const prior = hardPrior();
    // All four tiles reroll +1 so rerollsRemaining is DETERMINED (+1) across every viable
    // successor; only then does the adopt branch trigger, which the lift-only rule must block.
    // (The game never draws duplicate tiles, but buildSuccessors does not care and this is the
    // only shape that isolates the rule.)
    for (let i = 0; i < 4; i++) prior.outcomes[i] = { type: 'reroll_increase', change: 1 };
    const p = at(4);
    p.state.rerollsRemaining = 0; // soft, disagreeing with every determined expectation
    (p.confidence as { state: Record<string, number> }).state.rerollsRemaining = 0.4;
    const out = fuse(prior, p, applyOutcome);
    expect(out.result.state.rerollsRemaining).toBe(0); // pixel value stands
    expect(
      (out.result.confidence as { state: Record<string, number> }).state.rerollsRemaining
    ).toBe(0.4);
  });

  it('nextPrior quality derives from the FUSED confidences', () => {
    const p = mkParse();
    p.config.orderLevel = 3;
    (p.confidence as { config: Record<string, number> }).config.orderLevel = 0.4;
    const out = fuse(hardPrior(), p, applyOutcome);
    expect(out.nextPrior.quality.config.orderLevel).toBe('hard'); // adopted at ADOPT_HARD = 0.85
  });

  it('still frame works without outcomes on the CURRENT frame: config still pins normally', () => {
    const p = withoutOutcomes(); // same turn as the prior; no outcomes key at all
    p.config.orderLevel = 3; // misread; prior says 1
    (p.confidence as { config: Record<string, number> }).config.orderLevel = 0.4;
    const out = fuse(hardPrior(), p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(out.result.config.orderLevel).toBe(1); // adopted just like any other still frame
  });

  it('process frame with a prior that remembers no tiles cannot be explained and desyncs', () => {
    const priorWithNoTiles = seedFromParse(withoutOutcomes());
    const out = fuse(priorWithNoTiles, at(4), applyOutcome);
    expect(out.status).toBe('desync');
  });

  it('regression (finding 2): a fused processCost never goes stale relative to the fused multiplier', () => {
    // Still frame: hard prior at mult 0 / cost 900. The parse misreads mult 50 softly (0.5) with a
    // self-consistent-looking but wrong cost of 1350 (costFromCm(50)). Under the pre-fix STATE_FUSABLE
    // ordering bug, adopting the multiplier first mutated cf.state.processCostMultiplier to ADOPT_HARD
    // (0.85) BEFORE processCost's own turn in the loop, and processCost's parseConf lookup borrowed
    // that already-adopted value, so it read as confident and skipped its own adoption -- the misread
    // 1350 survived into the result and nextPrior even though the multiplier got corrected to 0.
    const prior = hardPrior(); // mult 0, cost 900, all-hard
    const p = mkParse(); // same turn as the prior: a still frame
    p.state.processCostMultiplier = 50; // misread; prior says 0
    p.state.processCost = 1350; // costFromCm(50): internally consistent with the misread, but wrong
    (p.confidence as { state: Record<string, number> }).state.processCostMultiplier = 0.5;
    const out = fuse(prior, p, applyOutcome);
    expect(out.status).toBe('fused');
    expect(out.result.state.processCostMultiplier).toBe(0); // adopted back to the prior
    expect(out.result.state.processCost).toBe(900); // re-derived from the corrected multiplier:
    // a consistent pair, not the stale misread 1350

    // A following frame that reads both fields confidently and correctly must not desync: nextPrior
    // no longer carries a stale processCost the way the pre-fix ordering bug would have baked in.
    const next = mkParse();
    next.state.processCostMultiplier = 0;
    next.state.processCost = 900;
    (next.confidence as { state: Record<string, number> }).state.processCostMultiplier = 0.95;
    (next.confidence as { state: Record<string, number> }).state.processCost = 0.95;
    const out2 = fuse(out.nextPrior, next, applyOutcome);
    expect(out2.status).toBe('fused');
  });
});

const GT = join(process.cwd(), 'Reference Projects/advisor-fixtures/groundtruth/corpora/c219');
const seqFrames = ['r0of2', 'r1of2', 'rcharge'];
const haveSeq = seqFrames.every((n) => existsSync(join(GT, `${n}.json`)));
const loadTruth = (n: string) =>
  JSON.parse(readFileSync(join(GT, `${n}.json`), 'utf8')) as ParsedAdvisorState;

// The four reroll fixtures are PILL-STATE samples, not consecutive frames: their labelled
// turns are r2of2=1, r1of2=6, r0of2=8, rcharge=9. Only r0of2 to rcharge is one legal action
// apart; every other hop spans missed turns and MUST desync (that is the designed gap
// behavior, worth asserting against real data too).
// Truth JSONs carry no confidence maps, so seedFromParse treats them all-hard: these two tests
// exercise turn-delta / contradiction INFERENCE against real data, not the confidence-lift math.
describe.skipIf(!haveSeq)('c219 ground truth replay', () => {
  it('the consecutive hop r0of2 to rcharge fuses from an all-hard prior', () => {
    const out = fuse(seedFromParse(loadTruth('r0of2')), loadTruth('rcharge'), applyOutcome);
    expect(out.status).toBe('fused');
  });

  it('a multi-turn gap (r1of2 to r0of2, turns 6 to 8) desyncs instead of guessing', () => {
    const out = fuse(seedFromParse(loadTruth('r1of2')), loadTruth('r0of2'), applyOutcome);
    expect(out.status).toBe('desync');
  });
});
