// Tests for the watch loop's re-read gate (watchReadGate), the pure decision behind "should this
// settled frame be parsed". The replay numbers in the first test are real: they were captured live
// via advisorWatchDebug during a missed gem swap on a 677px Force-21:9 window (2026-08-04).
import { describe, expect, it } from 'vitest';

import { watchReadGate } from './advisorController';

/** Shorthand: a polled frame after the first read, not busy, in the shape the gate takes. */
const frame = (motion: number, content: number, stableFor: number, spikeSeen = true) => ({
  busy: false,
  motion,
  content,
  stableFor,
  firstRead: false,
  spikeSeen,
});

describe('watchReadGate', () => {
  it('re-reads a settled spike whose content never clears the ambient bar (the missed gem swap)', () => {
    // Live capture: the swap flashed motion=87/88 (spike latched), then settled with content 12-23,
    // below CONTENT=36 forever. Without a fallback the gate never fired and the app sat 26s stale.
    const replay = [
      frame(0, 12, 312),
      frame(0, 13, 624),
      frame(0, 13, 935),
      frame(0, 13, 1250),
      frame(0, 14, 1559),
      frame(2, 17, 1873),
      frame(3, 18, 2186),
      frame(3, 22, 2498),
      frame(9, 22, 2816),
      frame(11, 23, 3127),
    ];
    const decisions = replay.map(watchReadGate);
    // The settled-spike fallback fires exactly once the latched spike has stayed calm past its
    // window; every earlier frame still waits.
    expect(decisions.indexOf(true)).toBe(8); // stableFor=2816, the first frame past 2500ms
    expect(decisions.slice(0, 8)).not.toContain(true);
  });

  it('stays quiet on ambient motion alone, no matter how long the screen sits still', () => {
    // A static screen spends zero parses: without a latched spike, ambient shimmer (motion 0-11,
    // content under the bar) must never trigger, even after minutes.
    expect(watchReadGate(frame(5, 24, 60_000, false))).toBe(false);
    expect(watchReadGate(frame(0, 17, 300_000, false))).toBe(false);
    // Content alone (however large) must never fire without a spike: the diff vs the last-parsed
    // frame accumulates ambient drift, so an unlatched high content is not evidence of an event.
    expect(watchReadGate(frame(0, 98, 60_000, false))).toBe(false);
  });

  it('fires the normal content-confirmed path at STABLE_MS, not delayed to the fallback window', () => {
    expect(watchReadGate(frame(0, 98, 900))).toBe(true);
    expect(watchReadGate(frame(0, 98, 850))).toBe(false);
  });

  it('never parses a frame still settling, or while a parse is in flight', () => {
    // motion 38 is the between-flash lull of the two-phase process animation; above QUIET.
    expect(watchReadGate(frame(38, 98, 3000))).toBe(false);
    expect(watchReadGate({ ...frame(0, 98, 3000), busy: true })).toBe(false);
  });

  it('takes the first read after the share settles, with no spike required', () => {
    const first = {
      busy: false,
      motion: 0,
      content: Infinity,
      stableFor: 900,
      firstRead: true,
      spikeSeen: false,
    };
    expect(watchReadGate(first)).toBe(true);
    expect(watchReadGate({ ...first, stableFor: 300 })).toBe(false);
  });
});
