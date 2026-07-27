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

  it('documents the divergence in the file header', () => {
    expect(SRC.slice(0, 1500)).toContain('LOCAL PATCH - SLIVER ABSTAIN');
  });
});
