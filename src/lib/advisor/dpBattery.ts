// The equivalence battery behind the five local patches in vendor/model/dp.js.
//
// dp.js is a DECISION engine: a mistake there changes what the advisor recommends rather than a
// number on screen, and no OCR corpus would ever catch it. So the bar for touching it is
// bit-identical output, and this is what measures it. Every state below is run through
// evaluateActionsDP and every returned float is written out as its raw IEEE-754 bit pattern (not
// ==, not toFixed), so a difference of one ULP shows up as a different line.
//
// Used two ways:
//   * dpPatch.test.ts compares the live dump against the committed golden (dpBattery.golden.txt),
//     which was generated from the PRISTINE upstream dp.js. So the golden proves the patched engine
//     still agrees with unpatched upstream, and it keeps proving it after a re-sync.
//   * the same function can be pointed at any other copy of dp.js to diff two builds directly.
//
// The battery deliberately spans all three rarities, both scoring axes, all three base costs,
// roster-bound on and off, cost multiplier -100/0/+100, EVERY turn of every rarity, and resets both
// available and already spent. dpPatch.test.ts asserts that coverage, so the battery cannot be
// quietly shrunk to make a failure go away.

export interface DpBatteryRow {
  label: string;
  state: Record<string, unknown>;
  opts: { axis: 'dps' | 'support'; includeSim2?: boolean };
  grade: number;
}

const POOLS: Record<number, string[]> = {
  8: ['Additional Damage', 'Attack Power', 'Brand Power', 'Ally Damage Enh.'],
  9: ['Boss Damage', 'Attack Power', 'Ally Damage Enh.', 'Ally Attack Enh.'],
  10: ['Boss Damage', 'Additional Damage', 'Brand Power', 'Ally Attack Enh.'],
};

// Three outcome shapes: plain raises/lowers, an UNNAMED change_side_option (fans out uniformly over
// the candidate effects, the only multi-branch top-level case), a reroll grant, and both cost flips.
const OUTCOME_SETS = [
  [
    { type: 'raise_effect', target: 'order', amount: 1 },
    { type: 'raise_effect', target: 'willpower', amount: 1 },
    { type: 'raise_effect', target: 'effect1', amount: 2 },
    { type: 'change_gold_cost', change: -100 },
  ],
  [
    { type: 'lower_effect', target: 'effect2', amount: 1 },
    { type: 'change_side_option', target: 'effect1' },
    { type: 'reroll_increase', change: 2 },
    { type: 'do_nothing' },
  ],
  [
    { type: 'raise_effect', target: 'effect2', amount: 4 },
    { type: 'change_gold_cost', change: 100 },
    { type: 'change_side_option', target: 'effect2' },
    { type: 'raise_effect', target: 'order', amount: 3 },
  ],
];

const RARITIES: Array<{ name: string; maxTurns: number; maxRerolls: number }> = [
  { name: 'uncommon', maxTurns: 5, maxRerolls: 1 },
  { name: 'rare', maxTurns: 7, maxRerolls: 2 },
  { name: 'epic', maxTurns: 9, maxRerolls: 3 },
];

// A fresh gem's whole state space is re-solved whenever Reset is a live option (topLevelAdvice
// values it, then resetCombos values all six effect pairs), which costs the same at every turn. So
// resets-available rows are the expensive ones and each rarity gets exactly two; the rest walk the
// turns with the reset already spent, where the horizon actually shrinks.
const RESET_AVAILABLE_TURNS: Record<string, number[]> = {
  uncommon: [1, 5],
  rare: [1, 4],
  epic: [1, 9],
};

export function buildDpBattery(): DpBatteryRow[] {
  const rows: DpBatteryRow[] = [];
  let i = 0;
  for (const rarity of RARITIES) {
    for (let turn = 1; turn <= rarity.maxTurns; turn++) {
      const baseCost = [8, 9, 10][i % 3];
      const pool = POOLS[baseCost];
      // levels stay in 1..5 (the game's range) but rotate so no two rows share a config
      const wp = 1 + ((i * 2) % 5);
      const order = 1 + ((i * 3 + 1) % 5);
      const e1l = 1 + ((i + 2) % 5);
      const e2l = 1 + ((i * 4 + 3) % 5);
      const e1 = pool[i % 4];
      const e2 =
        pool[(i + 1 + (i % 3)) % 4] === e1 ? pool[(i + 2) % 4] : pool[(i + 1 + (i % 3)) % 4];
      rows.push({
        label: `${rarity.name}-t${turn}/${rarity.maxTurns}`,
        state: {
          config: {
            baseCost,
            gemType: i % 2 === 0 ? 'order' : 'chaos',
            willpowerLevel: wp,
            orderLevel: order,
            effect1: e1,
            effect1Level: e1l,
            effect2: e2,
            effect2Level: e2l,
          },
          currentTurn: turn,
          maxTurns: rarity.maxTurns,
          rerollsRemaining: i % (rarity.maxRerolls + 1),
          resetsRemaining: RESET_AVAILABLE_TURNS[rarity.name].indexOf(turn) !== -1 ? 1 : 0,
          processCost: 900,
          processCostMultiplier: [0, 100, -100][i % 3],
          rosterBound: i % 4 === 3,
          outcomes: OUTCOME_SETS[i % OUTCOME_SETS.length],
        },
        // every 7th row also drops Complete out of the ranking ("Consider Complete" off)
        opts:
          i % 7 === 6
            ? { axis: i % 2 === 0 ? 'dps' : 'support', includeSim2: false }
            : { axis: i % 2 === 0 ? 'dps' : 'support' },
        grade: 48 + (i % 6) * 9,
      });
      i++;
    }
  }
  return rows;
}

// Raw IEEE-754 bits as 16 hex digits: -0, NaN and a one-ULP drift all read differently.
const bitsBuf = new DataView(new ArrayBuffer(8));
function bits(x: unknown): string {
  if (typeof x !== 'number') return String(x);
  bitsBuf.setFloat64(0, x);
  return bitsBuf.getBigUint64(0).toString(16).padStart(16, '0');
}

/** Run the whole battery through one build of dp.js and render every returned float bit-exactly. */
export function dumpDpBattery(DP: any, A: any): string {
  const lines: string[] = [];
  const rows = buildDpBattery();
  for (let i = 0; i < rows.length; i++) {
    const { label, state, opts, grade } = rows[i];
    const baseline = opts.axis === 'support' ? A.supportGradeToScore(grade) : A.gradeToScore(grade);
    const r = DP.evaluateActionsDP(state, baseline, 5_000_000 / 100, 1, null, opts);
    lines.push(
      `#${i} ${label} best=${r.bestAction} incl=${r.includeSim2} curVal=${bits(r.currentValue)} nodes=${r._solverNodes}`
    );
    for (const a of r.allActions) {
      lines.push(
        `  act ${a.name} v=${bits(a.value)} es=${bits(a.expectedScore)} ec=${bits(a.expectedCost)} ab=${bits(a.aboveBaselineOdds)}`
      );
    }
    lines.push(
      `  ev p=${bits(r.expectedValues.process)} r=${bits(r.expectedValues.reroll)} d=${bits(r.expectedValues.delete)}`
    );
    lines.push(
      `  es p=${bits(r.expectedScores.process)} r=${bits(r.expectedScores.reroll)} d=${bits(r.expectedScores.delete)}`
    );
    if (r.resetCombos) {
      for (const c of r.resetCombos) {
        lines.push(
          `  combo ${c.effect1}/${c.effect2} net=${bits(c.net)} es=${bits(c.expectedScore)} cur=${c.current}`
        );
      }
    } else {
      lines.push('  combo (null)');
    }
  }
  return lines.join('\n') + '\n';
}
