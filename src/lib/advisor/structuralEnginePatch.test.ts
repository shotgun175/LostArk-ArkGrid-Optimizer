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

  it('still refuses a fuzzy gem-name win supported only by grams the runner-up shares', () => {
    expect(SRC).toContain('LOCAL PATCH - A FUZZY NAME WIN NEEDS EVIDENCE THE RUNNER-UP LACKS');
    // the check needs all three pieces: the matched grams per candidate, the runner-up's identity,
    // and the flag actually being raised when no matched gram separates them
    expect(SRC).toMatch(/if \(letters\.indexOf\(g\) !== -1\) \{ hits\+\+; grams\.push\(g\); \}/);
    expect(SRC).toMatch(/secondSfx = bestS \? bestS\.sfx : null;/);
    expect(SRC).toMatch(
      /!bestS\.grams\.some\(function \(g\) \{ return secondSfx\.indexOf\(g\) === -1; \}\)\)\s*suffixAmbig = true;/
    );
  });

  it('still refuses "Attack Power" on the "attack" inside "Ally Attack Enh."', () => {
    expect(SRC).toContain('LOCAL PATCH - "ATTACK POWER" MUST NOT WIN ON THE "ATTACK" INSIDE "ALLY ATTACK ENH."');
    // the trailing y of "Ally" is the glyph most often lost, so both Ally rungs must tolerate it
    expect(SRC).toMatch(/\["Ally Attack Enh\.", \/a\[li1\|\]\{2\}y\?\\s\*at/);
    expect(SRC).toMatch(/\["Ally Damage Enh\.", \/a\[li1\|\]\{2\}y\?\\s\*dam/);
    // the generic rung carries its veto pattern AND the rival it defers to
    expect(SRC).toMatch(/\["Attack Power", \/atk\|attack\/, \/[^/]+\/, "Ally Attack Enh\."\]/);
    // the veto only applies where the rival is a legal candidate, else cost-8 gems lose the read
    expect(SRC).toMatch(
      /if \(veto && veto\.test\(t\) && rival !== avoid && \(!pool \|\| pool\.indexOf\(rival\) !== -1\)\) continue;/
    );
  });

  it('still refuses to let the effect pair overrule a cleanly-read gem name', () => {
    expect(SRC).toContain('LOCAL PATCH - THE PAIR MAY ONLY OVERRULE A GEM NAME THAT WAS ITSELF UNSURE');
    expect(SRC).toMatch(/var nameSuffixWasClean = \(confidence\.config\.baseCost \|\| 0\) >= 0\.85;/);
    // defining the flag is not enough - the override condition has to consult it
    expect(SRC).toMatch(/costsWithPair\[0\] !== out\.config\.baseCost && !nameSuffixWasClean\)/);
  });

  it('still recovers a one-word caption that only one pool effect can match', () => {
    expect(SRC).toContain('LOCAL PATCH - INSIDE A POOL, A SHARED WORD BECOMES DISCRIMINATIVE');
    expect(SRC).toMatch(/function lexPoolWord\(t, pool, avoid\)/);
    // uniqueness within the pool is the whole safeguard: two candidates must decline
    expect(SRC).toMatch(/if \(cand\.length === 1\) return cand\[0\];/);
    // and it must run only as a fallback, after the ordered rungs
    expect(SRC).toMatch(/return lexIn\(t, poolNames, avoid\) \|\| lexPoolWord\(t, poolNames, avoid\);/);
  });

  it('still reconciles a low-confidence wheel effect against the tile that names it', () => {
    expect(SRC).toContain('LOCAL PATCH - A TILE THAT NAMES AN EFFECT IS A SECOND READ OF THAT EFFECT');
    // a tile whose target is a near-tie between the two effect hues is not evidence for either
    expect(SRC).toMatch(/if \(target && Math\.abs\(dW - dE\) >= 12\) effCap\[target\] \+= " " \+ cap;/);
    // only a slot the wheel left below the flag bar may be revisited...
    expect(SRC).toMatch(/if \(\(confidence\.config\[slot\] \|\| 0\) >= 0\.8\) return;/);
    // ...and what it adopts must itself stay below that bar, so this cannot create a silent error
    expect(SRC).toMatch(/confidence\.config\[slot\] = 0\.7;/);
    // the guard reads the PUBLISHED confidence, so it has to run after the panel attenuation
    const atten = SRC.indexOf('panel-quality attenuation on the art-region fields');
    const tile = SRC.indexOf('LOCAL PATCH - A TILE THAT NAMES AN EFFECT IS A SECOND READ');
    expect(atten).toBeGreaterThan(-1);
    expect(tile).toBeGreaterThan(atten);
  });

  it('documents the divergence in the file header', () => {
    const header = SRC.slice(0, 6000);
    expect(header).toContain('LOCAL PATCH - SLIVER ABSTAIN');
    expect(header).toContain('FEASIBILITY ON THE OCR FALLBACK');
    expect(header).toContain('ZERO COST');
    expect(header).toContain('DECLINED DIGIT SLOT');
    expect(header).toContain('EFFECT TILE');
    expect(header).toContain('A FUZZY NAME WIN NEEDS EVIDENCE THE RUNNER-UP LACKS');
    expect(header).toContain('ATTACK POWER MUST NOT WIN ON THE ATTACK INSIDE ALLY ATTACK ENH.');
    expect(header).toContain('THE PAIR MAY ONLY OVERRULE A GEM NAME THAT WAS ITSELF UNSURE');
    expect(header).toContain('INSIDE A POOL, A SHARED WORD BECOMES DISCRIMINATIVE');
    expect(header).toContain('A TILE THAT NAMES AN EFFECT IS A SECOND READ OF THAT EFFECT');
  });
});
