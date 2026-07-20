// Smoke gate for the vendored parser stack. Proves the whole ocr/ UMD chain self-wires under our
// setup (structural-engine -> engine + layout + tesseract-engine + glyphs + level-refs -> model), and
// that the constraint solver repairs a messy parse to a legal game state. The full image-in ->
// parse-out accuracy is his (99.7% corpus, frozen); it is validated in the browser worker, not here,
// because it needs image decode + tesseract. These pure-logic checks need neither.
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Requiring structural-engine pulls the entire ocr stack + the model core through the relative
// require() chain (no OpenCV, no tesseract at module scope, so it is Vitest-safe).
const S = require('./vendor/ocr/structural-engine.js');
const E = require('./vendor/ocr/engine.js');
const A = require('./vendor/model/astrogem.js');

describe('advisor parser stack wiring', () => {
  it('self-wires: parseStructural and constraintSnap are callable', () => {
    expect(typeof S.parseStructural).toBe('function');
    expect(typeof E.constraintSnap).toBe('function');
  });
});

describe('constraintSnap repairs a messy parse to a legal state', () => {
  it('snaps impossible fields into the legal game domain', () => {
    const out = E.constraintSnap({
      config: {
        baseCost: 99, // impossible -> snapped to {8,9,10}
        willpowerLevel: 9, // out of range -> clamped 1..5
        effect1: 'Attack Power',
        effect2: 'Attack Power', // duplicate -> forced distinct
        effect1Level: 8, // -> clamped 1..5
        effect2Level: 0, // -> clamped 1..5
      },
      state: {},
      outcomes: [], // -> padded to exactly 4
    });
    expect([8, 9, 10]).toContain(out.config.baseCost);
    expect(out.config.effect1).not.toBe(out.config.effect2);
    // Both effects must belong to the snapped cost's pool.
    const pool: string[] = A.EFFECT_POOLS[out.config.baseCost];
    expect(pool).toContain(out.config.effect1);
    expect(pool).toContain(out.config.effect2);
    for (const lvl of [
      out.config.willpowerLevel,
      out.config.orderLevel,
      out.config.effect1Level,
      out.config.effect2Level,
    ]) {
      expect(lvl).toBeGreaterThanOrEqual(1);
      expect(lvl).toBeLessThanOrEqual(5);
    }
    expect(out.outcomes).toHaveLength(4);
    expect(out.state.maxTurns).toBeGreaterThan(0);
    expect(out.state.currentTurn).toBeGreaterThanOrEqual(1);
    expect(out.state.currentTurn).toBeLessThanOrEqual(out.state.maxTurns);
  });

  it('passes a clean manual entry through without corrupting it', () => {
    const clean = {
      config: {
        baseCost: 9,
        gemType: 'order',
        willpowerLevel: 5,
        orderLevel: 3,
        effect1: 'Boss Damage',
        effect1Level: 4,
        effect2: 'Attack Power',
        effect2Level: 2,
      },
      state: { currentTurn: 4, maxTurns: 9, rerollsRemaining: 2 },
      outcomes: [
        { type: 'raise_effect', target: 'effect1', amount: 1 },
        { type: 'raise_effect', target: 'order', amount: 1 },
        { type: 'lower_effect', target: 'effect2', amount: 1 },
        { type: 'do_nothing' },
      ],
    };
    const out = E.constraintSnap(clean);
    expect(out.config.baseCost).toBe(9);
    expect(out.config.effect1).toBe('Boss Damage');
    expect(out.config.effect2).toBe('Attack Power');
    expect(out.config.willpowerLevel).toBe(5);
    expect(out.outcomes).toHaveLength(4);
  });
});
