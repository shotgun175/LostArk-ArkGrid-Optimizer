import { describe, expect, it } from 'vitest';

import { Core, Gem, GemSet } from './models';
import { getBestGemSetPacks, getPossibleGemSets } from './solver';

// Minimal score maps: index 0 only (empty GemSets have att/skill/boss = 0).
const scoreMaps: [number, number][][] = [[[1, 1]], [[1, 1]], [[1, 1]]];

describe('getPossibleGemSets (single-gem enumeration)', () => {
  // Regression: gems sort ascending by req, so after a gem that fits but leaves < 3 energy the old
  // `if (ei < 3) break;` exited the whole loop and dropped every later valid single-gem set. `req`
  // is base 8/9/10 minus willpower (max 5), so the minimum is 3 — no multi-gem set is lost by
  // skipping the inner nest at ei < 3, but the later singles must still be enumerated.
  const point5 = new Array(11).fill(0); // core coeff by total point (singles use point 5)

  it('enumerates every valid single on a 9-energy core (req-8 + req-9)', () => {
    const core = new Core(9, 5, point5);
    const g8 = new Gem(0n, 8, 5, 1, 0, 0);
    const g9 = new Gem(1n, 9, 5, 0, 1, 0);
    const sets = getPossibleGemSets(core, [g8, g9]);
    // Both fit as singles (req <= 9); neither leaves room for a second gem. The req-9 single was
    // dropped before the fix.
    expect(sets.some((s) => s.bitmask === 1n << 0n)).toBe(true); // req-8 single
    expect(sets.some((s) => s.bitmask === 1n << 1n)).toBe(true); // req-9 single
    expect(sets.length).toBe(2);
  });

  it('enumerates both req-10 singles on a 12-energy core', () => {
    const core = new Core(12, 5, point5);
    const a = new Gem(0n, 10, 5, 1, 0, 0);
    const b = new Gem(1n, 10, 5, 0, 1, 0);
    const sets = getPossibleGemSets(core, [a, b]);
    // Each leaves 12 - 10 = 2 energy (< 3): both are valid singles, no pair is possible.
    expect(sets.length).toBe(2);
  });
});

describe('getBestGemSetPacks input validation', () => {
  it('throws when a GemSet has no score range set', () => {
    const gs = new GemSet([], new Core(10, 0, [0]));
    expect(gs.maxScore).toBe(-1); // fresh GemSet: setScoreRange never called
    expect(() => getBestGemSetPacks([[gs]], scoreMaps)).toThrow('maxScore and minScore is not set');
  });

  it('accepts GemSets whose score range is set', () => {
    const gs = new GemSet([], new Core(10, 0, [0]));
    gs.minScore = 0.9;
    gs.maxScore = 1.1;
    expect(() => getBestGemSetPacks([[gs]], scoreMaps)).not.toThrow();
  });
});
