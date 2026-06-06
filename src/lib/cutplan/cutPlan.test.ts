import { describe, expect, it } from 'vitest';

import { actionLabel, bracketLabel, getDpsPlan, getSupportPlan, weeksBand } from './cutPlan';
import type { PipelineTable } from './types';
import type { SupportCutQuality } from './types';

// Minimal fake table: bracket 500k has BL window 5-6.
const table = {
  '500k': {
    nrb: [
      { baseline: 5, archetypes: {} as any, pipeline: { weeks: '6.8' } as any },
      { baseline: 6, archetypes: {} as any, pipeline: { weeks: '9.7' } as any },
    ],
    rb: [],
  },
} as unknown as PipelineTable;

describe('getDpsPlan', () => {
  it('returns the row when the baseline is inside the bracket window', () => {
    const r = getDpsPlan(table, '500k', 'nrb', 5);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.row.baseline).toBe(5);
  });
  it('reports below-window when the baseline is under the bracket min', () => {
    const r = getDpsPlan(table, '500k', 'nrb', 3);
    expect(r.kind).toBe('below-window');
    if (r.kind === 'below-window') expect(r.minBaseline).toBe(5);
  });
  it('reports above-window when the baseline is over the bracket max', () => {
    const r = getDpsPlan(table, '500k', 'nrb', 9);
    expect(r.kind).toBe('above-window');
    if (r.kind === 'above-window') expect(r.maxBaseline).toBe(6);
  });
  it('reports no-data for a missing binding/bracket or empty rows', () => {
    expect(getDpsPlan(table, '500k', 'rb', 5).kind).toBe('no-data'); // empty array
    expect(getDpsPlan(table, '1M', 'nrb', 5).kind).toBe('no-data'); // missing bracket
  });
});

describe('actionLabel / bracketLabel / weeksBand', () => {
  it('maps actions to labels', () => {
    expect(actionLabel('cut-reset')).toBe('Cut + reset');
    expect(actionLabel('cut')).toBe('Cut');
    expect(actionLabel('fuse')).toBe('Fuse first');
    expect(actionLabel('dont-cut')).toBe("Don't cut");
  });
  it('renders bracket keys with the dotted display form', () => {
    expect(bracketLabel('1_5M')).toBe('1.5M');
    expect(bracketLabel('500k')).toBe('500k');
  });
  it('bands weeks fast/med/slow', () => {
    expect(weeksBand(6.8)).toBe('fast'); // <=8
    expect(weeksBand(20)).toBe('med'); // 8-26
    expect(weeksBand(40)).toBe('slow'); // >26
  });
});

const support = {
  '10': {
    E9: {
      '2D': { pct: 50, avg: 13.5 },
      Op: { pct: 30, avg: 12.9 },
      Sub: { pct: 5, avg: 10.7 },
      No: { pct: 0, avg: null },
    },
    UC8: {
      '2D': { pct: 4, avg: 8.2 },
      Op: { pct: 1, avg: 7.9 },
      Sub: { pct: 0, avg: null },
      No: { pct: 0, avg: null },
    },
  },
} as unknown as SupportCutQuality;

describe('getSupportPlan', () => {
  it('ranks archetypes by their best single-cut % at the baseline, best first', () => {
    const plan = getSupportPlan(support, 10);
    expect(plan.ranks.map((r) => r.archetype)).toEqual(['E9', 'UC8']);
    expect(plan.ranks[0].best).toBe(50);
    expect(plan.ranks[0].buckets['2D']).toBe(50); // per-bucket % extracted for the cards
  });
  it('computes the summary tiles from the best-chance target', () => {
    const { summary } = getSupportPlan(support, 10);
    expect(summary.bestPct).toBe(50);
    expect(summary.cutsPerHit).toBe(2); // round(100 / 50)
    expect(summary.bestTarget).toEqual({ archetype: 'E9', bucket: '2D' });
    expect(summary.avgScore).toBe(13.5);
    expect(summary.totalScore).toBe(Math.round(13.5 * 24)); // avg × grid slots
  });
  it('returns empty ranks + a null summary when the baseline is out of range', () => {
    const plan = getSupportPlan(support, 99);
    expect(plan.ranks).toEqual([]);
    expect(plan.summary.bestPct).toBe(0);
    expect(plan.summary.avgScore).toBeNull();
    expect(plan.summary.cutsPerHit).toBeNull();
  });
});
