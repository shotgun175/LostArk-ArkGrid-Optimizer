// Smoke gate for the vendored parser stack. Proves the whole ocr/ UMD chain self-wires under our
// setup (structural-engine -> engine + layout + tesseract-engine + glyphs + level-refs + the three
// generated models -> model), and that the constraint solver repairs a messy parse to a legal game
// state. The full image-in -> parse-out accuracy is measured OUTSIDE the unit lane, by the harness under
// Reference Projects/advisor-fixtures/groundtruth (needs image decode + tesseract); see the vendored
// structural-engine.js header for the numbers pinned at the last re-sync. These checks need neither.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  // The 2026-08 re-sync added three GENERATED trained models the engine consults for its joint level,
  // name and tile solves. The engine swallows a missing model silently (try/catch at load), which would
  // quietly degrade accuracy, so pin that each one exists and exports its table. Under Node the require
  // chain loads them all; the worker's own load list is pinned by the next test.
  it('ships the level, name and tile models the engine consults', () => {
    expect(require('./vendor/ocr/level-model.js').LEVEL_MODEL).toBeTruthy();
    const nm = require('./vendor/ocr/name-model.js');
    expect(nm.NAME_MODEL).toBeTruthy();
    expect(Array.isArray(nm.NAME_MODEL_NAMES)).toBe(true);
    expect(require('./vendor/ocr/tile-model.js').TILE_MODEL).toBeTruthy();
  });

  // In the browser the worker evals a hand-kept list of ?raw sources and structural-engine reads each
  // model off self, so a vendored file missing from that list (or evaluated after structural-engine)
  // degrades accuracy with no error. Read advisorWorker.ts as text and pin the list to the vendor tree.
  it('the worker imports and evals every vendored file, astrogem first and structural-engine last', () => {
    const worker = readFileSync(new URL('./advisorWorker.ts', import.meta.url), 'utf8');
    const imports = new Map(
      [...worker.matchAll(/^import (\w+) from '\.\/vendor\/(.+\.js)\?raw';$/gm)].map((m) => [
        m[2],
        m[1],
      ])
    );
    const vendorDir = fileURLToPath(new URL('./vendor', import.meta.url));
    const vendored = readdirSync(vendorDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.split(sep).join('/'));
    expect([...imports.keys()].sort()).toEqual(vendored.sort());

    const list = worker.match(/for \(const src of \[([^\]]*)\]\)/)?.[1] ?? '';
    const evaled = list
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect([...evaled].sort()).toEqual([...imports.values()].sort());
    expect(evaled[0]).toBe('astrogemSrc');
    expect(evaled.at(-1)).toBe('structuralSrc');
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
