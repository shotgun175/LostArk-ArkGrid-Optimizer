import { describe, expect, it } from 'vitest';
import { countUnconfirmed, type ParsedAdvisorState, parsedToEdited } from './advisorController';

/**
 * `rerollsRemaining` is in MODEL units: the free rerolls the game shows PLUS the one paid "Charge"
 * reroll. Converting a parse back to the edit shape has to survive a re-snap, and zero is the trap —
 * `rerollsShownFree: 0` re-snaps to 1, because the snap reads it as "0 free + 1 paid". A fully spent
 * gem (dimmed grey Charge) that round-trips through `rerollsShownFree` therefore regains a reroll,
 * and the DP starts recommending a Reroll the game will not allow.
 */
function parsed(rerollsRemaining: number): ParsedAdvisorState {
  return {
    config: {
      baseCost: 8,
      gemType: 'order',
      willpowerLevel: 3,
      orderLevel: 1,
      effect1: 'Brand Power',
      effect1Level: 4,
      effect2: 'Ally Damage Enh.',
      effect2Level: 2,
    },
    state: {
      currentTurn: 6,
      maxTurns: 7,
      rerollsRemaining,
      processCostMultiplier: 0,
      rosterBound: false,
    },
    outcomes: [],
  };
}

describe('parsedToEdited reroll conversion', () => {
  it('marks a fully spent gem as charge-spent rather than zero free rerolls', () => {
    const e = parsedToEdited(parsed(0));
    expect(e.state.rerollsChargeSpent).toBe(true);
    expect(e.state.rerollsShownFree).toBeUndefined();
  });

  it('converts model units back to the free count the game shows', () => {
    expect(parsedToEdited(parsed(1)).state.rerollsShownFree).toBe(0); // paid Charge only
    expect(parsedToEdited(parsed(2)).state.rerollsShownFree).toBe(1);
    expect(parsedToEdited(parsed(3)).state.rerollsShownFree).toBe(2);
  });

  it('never emits both reroll signals at once', () => {
    for (const m of [0, 1, 2, 3]) {
      const s = parsedToEdited(parsed(m)).state;
      expect(s.rerollsChargeSpent === true && s.rerollsShownFree !== undefined).toBe(false);
    }
  });

  it('derives rarity from maxTurns when the parse did not supply it', () => {
    const p = parsed(2);
    expect(parsedToEdited({ ...p, state: { ...p.state, maxTurns: 5 } }).rarity).toBe('uncommon');
    expect(parsedToEdited({ ...p, state: { ...p.state, maxTurns: 7 } }).rarity).toBe('rare');
    expect(parsedToEdited({ ...p, state: { ...p.state, maxTurns: 9 } }).rarity).toBe('epic');
    expect(parsedToEdited({ ...p, rarity: 'epic' }).rarity).toBe('epic');
  });
});

describe('countUnconfirmed', () => {
  const withConf = (confidence: unknown): ParsedAdvisorState =>
    ({ ...parsed(2), confidence }) as ParsedAdvisorState;

  it('counts config fields and outcomes below the flag bar', () => {
    expect(
      countUnconfirmed(
        withConf({ config: { willpowerLevel: 0.54, effect1Level: 0.9 }, outcomes: [0.4, 0.95, null] })
      )
    ).toBe(2); // one config field + one outcome
  });

  it('treats a missing confidence block as nothing to confirm', () => {
    expect(countUnconfirmed(withConf(undefined))).toBe(0);
    expect(countUnconfirmed(undefined)).toBe(0);
  });

  it('does not count a field sitting exactly on the bar', () => {
    expect(countUnconfirmed(withConf({ config: { willpowerLevel: 0.8 }, outcomes: [] }))).toBe(0);
  });

  it('ignores state fields, which the window does not highlight', () => {
    // counting them would print a number that disagrees with the highlighted fields on screen
    expect(countUnconfirmed(withConf({ config: {}, state: { currentTurn: 0.1 }, outcomes: [] }))).toBe(0);
  });
});
