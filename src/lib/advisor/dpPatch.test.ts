// Re-sync tripwire AND equivalence proof for the five local patches in vendor/model/dp.js.
//
// dp.js is the DECISION engine. A mistake in it changes what the advisor tells you to do, not a
// number on a screen, and no OCR corpus would catch it. The five patches are therefore held to a
// harder bar than the parser ones: they must produce BIT-IDENTICAL output, not merely equal-looking
// output. dpBattery.golden.txt is the whole battery dumped from the PRISTINE upstream dp.js, every
// returned float written as its raw IEEE-754 bit pattern; the first test re-runs the battery through
// the patched engine and demands the same bytes. One ULP anywhere fails it.
//
// If this fails after a re-sync:
//   * the marker tests below tell you whether a patch was dropped (re-apply it, don't delete the
//     test);
//   * if the markers pass and only the golden fails, UPSTREAM changed the model. That is a real
//     behaviour change and needs its own decision, exactly like re-freezing the solver's GOLDEN.
//     Regenerate the golden only after deciding the new numbers are the ones you want, by dumping
//     dumpDpBattery() from a pristine copy of the new upstream.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { buildDpBattery, dumpDpBattery } from './dpBattery';

const require = createRequire(import.meta.url);
const A = require('./vendor/model/astrogem.js');
const DP = require('./vendor/model/dp.js');

const SRC = readFileSync(new URL('./vendor/model/dp.js', import.meta.url), 'utf8');
const GOLDEN = readFileSync(new URL('./dpBattery.golden.txt', import.meta.url), 'utf8');

/** First differing line, rendered for a readable failure (the dump is 13KB of hex). */
function firstDiff(expected: string, actual: string): string | null {
  if (expected === actual) return null;
  const a = expected.split('\n');
  const b = actual.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i])
      return `line ${i + 1}\n  golden (pristine upstream): ${a[i]}\n  live   (patched engine):    ${b[i]}`;
  }
  return `same lines, different length: ${a.length} vs ${b.length}`;
}

describe('vendored dp.js: the patched engine is bit-identical to pristine upstream', () => {
  it('reproduces the pristine golden across the whole battery', () => {
    expect(firstDiff(GOLDEN, dumpDpBattery(DP, A))).toBeNull();
  }, 60000);

  // The battery is only proof if it keeps covering the space. Shrinking it must fail loudly rather
  // than quietly make a divergence unobservable.
  it('still spans the whole input space the patches have to be right on', () => {
    const rows = buildDpBattery();
    const st = (k: string) => rows.map((r) => (r.state as Record<string, unknown>)[k]);
    const cfg = (k: string) => rows.map((r) => (r.state.config as Record<string, unknown>)[k]);
    const uniq = (xs: unknown[]) =>
      [...new Set(xs)].sort((a, b) =>
        typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
      );

    expect(uniq(st('maxTurns'))).toEqual([5, 7, 9]); // uncommon, rare, epic
    expect(uniq(rows.map((r) => r.opts.axis))).toEqual(['dps', 'support']);
    expect(uniq(cfg('baseCost'))).toEqual([8, 9, 10]);
    expect(uniq(st('rosterBound'))).toEqual([false, true]);
    expect(uniq(st('processCostMultiplier'))).toEqual([-100, 0, 100]);
    expect(uniq(st('resetsRemaining'))).toEqual([0, 1]);
    // every turn of every rarity
    for (const maxTurns of [5, 7, 9]) {
      const turns = rows
        .filter((r) => r.state.maxTurns === maxTurns)
        .map((r) => r.state.currentTurn as number)
        .sort((x, y) => x - y);
      expect(turns).toEqual(Array.from({ length: maxTurns }, (_, i) => i + 1));
    }
    // and the outcome shapes that fan out, since those are the multi-branch top-level path
    const kinds = new Set(
      rows.flatMap((r) => (r.state.outcomes as Array<{ type: string }>).map((o) => o.type))
    );
    expect(kinds.has('change_side_option')).toBe(true);
    expect(kinds.has('reroll_increase')).toBe(true);
    expect(kinds.has('change_gold_cost')).toBe(true);
  });
});

describe('vendored dp.js local patches', () => {
  it('still keys the effect-class map without building a string', () => {
    expect(SRC).toContain('LOCAL PATCH 1 - EFFECT-CLASS MAP ON A NUMERIC CACHE KEY');
    expect(SRC).toMatch(/var ck = \(baseCost << 1\) \| \(axis === "support" \? 1 : 0\);/);
    // the class VALUE has to stay what upstream returned, including 0 for an off-axis effect
    expect(SRC).toMatch(/map\[pool\[i\]\] = Math\.round\(esFn\(pool\[i\], 1\) \* 1e6\);/);
    expect(SRC).toMatch(
      /function effectClass\(baseCost, effectName, axis\) \{\s*\n\s*var v = effectMapFor\(baseCost, axis\)\[effectName\];\s*\n\s*return v == null \? 0 : v;/
    );
  });

  it('still holds the memo in a Map', () => {
    expect(SRC).toContain('LOCAL PATCH 2 - MAP MEMO');
    expect(SRC).toContain('this.memo = new Map();');
    // both ends have to move together, or every probe misses and the DP silently recomputes
    expect(SRC).toContain('var hit = this.memo.get(key);');
    expect(SRC).toContain('this.memo.set(key, rec);');
  });

  it('still memoises the outcome possibility list on its full signature', () => {
    expect(SRC).toContain('LOCAL PATCH 3 - OUTCOME POSSIBILITY LIST MEMO');
    // the two CLASS terms are what make the key complete: the cost rules test costMult against
    // +/-100 and the cost/reroll rules test turnsRemaining <= 1. Drop either and two genuinely
    // different possibility sets share a slot.
    expect(SRC).toMatch(/var cmc = cm >= 100 \? 2 : \(cm <= -100 \? 0 : 1\);/);
    expect(SRC).toMatch(
      /var k = \(\(\(\(wp \* 6 \+ od\) \* 6 \+ l1\) \* 6 \+ l2\) \* 3 \+ cmc\) \* 2 \+ \(t <= 1 \? 1 : 0\);/
    );
    // an out-of-range level would alias in the packed key, so it must bypass the cache
    expect(SRC).toMatch(/return outcomeProbabilitiesRaw\(config, t, cm\);\s*\n\s*\}/);
  });

  it('still reuses the draw scratch buffers, sentinels and all', () => {
    expect(SRC).toContain('LOCAL PATCH 4 - HOISTED DRAW SCRATCH BUFFERS');
    expect(SRC).toMatch(/var NMAX = 32, MMAX = \(NMAX \* \(NMAX - 1\)\) \/ 2;/);
    // reused buffers do not arrive zeroed, so the four suffix-sum sentinels must be written
    expect(SRC).toMatch(/QP\[n\] = 0; QV\[n\] = 0;/);
    expect(SRC).toMatch(/TP\[m\] = 0; TV\[m\] = 0;/);
    // and an oversized draw must fall back to allocating, never overflow the shared buffers
    expect(SRC).toMatch(/var big = n > NMAX;/);
    for (const decl of [
      /var u = big \? new Float64Array\(n\) : _u, q = big \? new Float64Array\(n\) : _q;/,
      /var QP = big \? new Float64Array\(n \+ 1\) : _QP, QV = big \? new Float64Array\(n \+ 1\) : _QV;/,
      /var sv = big \? new Float64Array\(m\) : _sv, sp = big \? new Float64Array\(m\) : _sp;/,
      /var TP = big \? new Float64Array\(m \+ 1\) : _TP, TV = big \? new Float64Array\(m \+ 1\) : _TV;/,
    ])
      expect(SRC).toMatch(decl);
    // the size assumption itself: n is bounded by the outcome table
    expect(A.OUTCOME_RATES.length).toBeLessThanOrEqual(32);
  });

  it('still keys the memo on an integer, with the string key as the escape hatch', () => {
    expect(SRC).toContain('LOCAL PATCH 5 - INTEGER MEMO KEY');
    // Ordinals are assigned in ASCENDING class-value order, which is what makes `o1 < o2` literally
    // `c1 < c2` and the swap below inspectable without a case analysis. This pins the argument
    // written in the file rather than a computed result: any INJECTIVE assignment would preserve
    // the equivalence relation, and dropping this sort was measured to leave the battery
    // byte-identical. What is load-bearing is injectivity, and the battery does see that - dropping
    // the cost-multiplier term from the key below moves 62 golden lines.
    expect(SRC).toMatch(/vals\.sort\(function \(a, b\) \{ return a - b; \}\);/);
    expect(SRC).toMatch(
      /if \(o1 < o2 \|\| \(o1 === o2 && l1 <= l2\)\) \{ a1 = o1; b1 = l1; a2 = o2; b2 = l2; \}/
    );
    // every component range-guarded...
    expect(SRC).toMatch(
      /if \(!\(wp >= 0 && wp <= 5 && od >= 0 && od <= 5 && l1 >= 0 && l1 <= 5 && l2 >= 0 && l2 <= 5\)\) return null;/
    );
    expect(SRC).toMatch(/if \(!\(t >= 0 && t < 16 && r >= 0 && r < 32\)\) return null;/);
    expect(SRC).toMatch(/if \(om\.n > 5\) return null;/);
    expect(SRC).toMatch(/if \(ci > 7\) return null;/);
    // ...and anything out of range falls back to the vendored string key
    expect(SRC).toMatch(
      /if \(key === null\) key = configKey\(config, this\.axis\) \+ "#" \+ t \+ "#" \+ r \+ "#" \+ cm;/
    );
  });

  it('documents the divergence in the file header', () => {
    const header = SRC.slice(0, 6000);
    expect(header).toContain('EFFECT-CLASS MAP ON A NUMERIC CACHE KEY');
    expect(header).toContain('MAP MEMO');
    expect(header).toContain('OUTCOME POSSIBILITY LIST MEMO');
    expect(header).toContain('HOISTED DRAW SCRATCH BUFFERS');
    expect(header).toContain('INTEGER MEMO KEY');
  });
});
