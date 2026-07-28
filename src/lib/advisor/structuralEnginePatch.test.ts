import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Re-sync tripwire for the one local patch in the vendored parser.
 *
 * The vendored files are re-synced by copying from upstream, which would silently drop any local
 * change. This patch is worth keeping: when the narrow-fragment re-mask cannot widen a digit box,
 * upstream still commits the sliver at up to 0.95 confidence — a confident wrong level that the
 * points checksum then propagates into a second field. We abstain instead and let the checksum solve
 * the node. Measured across 17 Force-21:9 captures it took scalar-field accuracy from 89.59% to
 * 94.57%, with the 21:9-off set and upstream's own 67-sample corpus both unchanged and zero silent
 * errors throughout.
 *
 * If this test fails after a re-sync, re-apply the patch (search the file for "LOCAL PATCH") rather
 * than deleting the test.
 */
const SRC = readFileSync(
  new URL('./vendor/ocr/structural-engine.js', import.meta.url),
  'utf8'
);

describe('vendored structural-engine local patch', () => {
  it('still abstains instead of committing an unrescued sliver', () => {
    expect(SRC).toContain('var sliverUnrescued = false;');
    expect(SRC).toContain('sliverUnrescued = true;');
    // the commit condition must actually consult the flag, not merely define it
    expect(SRC).toMatch(/b1 >= 0\.78 && \(b1 - b2\) >= 0\.05 && !sliverUnrescued/);
  });

  it('still rejects an arithmetically impossible OCR-sourced points total', () => {
    expect(SRC).toContain('LOCAL PATCH - FEASIBILITY ON THE OCR FALLBACK');
    // guard the two things that make it correct: it applies ONLY to the OCR-sourced value, and the
    // bounds come from committed reads alone (folding in the S hint vetoes correct totals)
    expect(SRC).toMatch(/if \(ptsT == null && pts != null\) \{/);
    expect(SRC).not.toMatch(/if \(sHint != null && nUnkO > 0\)/);
  });

  it('still reads a zero processing cost from structure alone', () => {
    expect(SRC).toContain('LOCAL PATCH - ZERO COST');
    // a confident non-zero match must still veto; only an inconclusive one defers to structure
    expect(SRC).toMatch(/var zInconclusive = !zd \|\| zd\.score < 0\.5;/);
    // the height floor has to admit the mask fragment this glyph produces
    expect(SRC).toMatch(/zb\.h >= cmedH2 \* 0\.5/);
  });

  it('still refuses to trust a level whose digit slot the matcher declined', () => {
    expect(SRC).toContain('LOCAL PATCH - DECLINED DIGIT SLOT');
    expect(SRC).toMatch(/if \(hasLvPrefix && zoneBoxSeen && \(!db \|\| !db\.isDigit\)\) _declinedSlots\[nodeKind\] = true;/);
    // capping inside the read is NOT enough - the joint solve raises confidence again, so the cap
    // has to be applied where the confidences are published
    expect(SRC).toMatch(/conf4\[di\] = Math\.min\(conf4\[di\], 0\.7\);/);
  });

  it('still reads an unlabelled effect tile as an effect swap, not a +1 raise', () => {
    expect(SRC).toContain('LOCAL PATCH - AN EFFECT TILE WITH NO AMOUNT AND NO ARROW');
    expect(SRC).toMatch(/if \(!hadAmt && !dirUp && !dirDown && \(target === "effect1" \|\| target === "effect2"\)\)/);
  });

  it('documents the divergence in the file header', () => {
    const header = SRC.slice(0, 2000);
    expect(header).toContain('LOCAL PATCH - SLIVER ABSTAIN');
    expect(header).toContain('FEASIBILITY ON THE OCR FALLBACK');
    expect(header).toContain('ZERO COST');
    expect(header).toContain('DECLINED DIGIT SLOT');
    expect(header).toContain('EFFECT TILE');
  });
});
