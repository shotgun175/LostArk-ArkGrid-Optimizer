import { describe, expect, it } from 'vitest';

import { formatCombatPower, suggestGoldBracket } from './goldBracket';
import { GOLD_BRACKETS } from './types';

describe('suggestGoldBracket (shizukaziye loadout-econ.js cpToGpd bands)', () => {
  it('returns null for an unknown or non-positive combat power', () => {
    for (const cp of [null, undefined, NaN, Infinity, -Infinity, 0, -1]) {
      expect(suggestGoldBracket(cp)).toBeNull();
    }
  });

  it('maps every band edge: below the edge is the lower bracket, the edge itself the next one', () => {
    const cases: [number, string][] = [
      [0.01, '500k'],
      [3499.99, '500k'],
      [3500, '1M'],
      [4499.99, '1M'],
      [4500, '1_5M'],
      [5499.99, '1_5M'],
      [5500, '2_5M'],
      [6499.99, '2_5M'],
      [6500, '3_5M'],
      [7499.99, '3_5M'],
      [7500, '5M'],
      [99999, '5M'],
    ];
    for (const [cp, bracket] of cases) expect(suggestGoldBracket(cp), String(cp)).toBe(bracket);
  });

  it('never suggests the manual-only 7.5M and 10M brackets', () => {
    const suggested = new Set<string | null>();
    for (let cp = 1; cp <= 20000; cp += 50) suggested.add(suggestGoldBracket(cp));
    expect(suggested.has('7_5M')).toBe(false);
    expect(suggested.has('10M')).toBe(false);
    // ...and every suggestion is a real bracket.
    for (const s of suggested) expect(GOLD_BRACKETS).toContain(s);
  });
});

describe('formatCombatPower', () => {
  it('floors, so the shown number never crosses the band edge it was compared on', () => {
    expect(formatCombatPower(7957.43)).toBe('7,957');
    expect(formatCombatPower(7499.6)).toBe('7,499');
    expect(suggestGoldBracket(7499.6)).toBe('3_5M');
  });
});
