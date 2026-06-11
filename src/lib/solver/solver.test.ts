import { describe, expect, it } from 'vitest';

import { Core, GemSet } from './models';
import { getBestGemSetPacks } from './solver';

// Minimal score maps: index 0 only (empty GemSets have att/skill/boss = 0).
const scoreMaps: [number, number][][] = [[[1, 1]], [[1, 1]], [[1, 1]]];

describe('getBestGemSetPacks input validation', () => {
  it('throws when a GemSet has no score range set', () => {
    const gs = new GemSet([], new Core(10, 0, [0]));
    expect(gs.maxScore).toBe(-1); // fresh GemSet: setScoreRange never called
    expect(() => getBestGemSetPacks([[gs]], scoreMaps)).toThrow(
      'maxScore and minScore is not set'
    );
  });

  it('accepts GemSets whose score range is set', () => {
    const gs = new GemSet([], new Core(10, 0, [0]));
    gs.minScore = 0.9;
    gs.maxScore = 1.1;
    expect(() => getBestGemSetPacks([[gs]], scoreMaps)).not.toThrow();
  });
});
