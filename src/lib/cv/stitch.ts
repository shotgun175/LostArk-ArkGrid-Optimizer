/**
 * Sequence-overlap stitching for multi-screenshot gem capture — the engine for the
 * count-checksum iteration (see Reference Projects/count-checksum-stitching-spec.md).
 *
 * Generalizes the live Panel `applyCurrentGems` merge into a pure, testable function: gems sit in a
 * fixed in-game order, so overlapping screenshots share a CONTIGUOUS run; we splice in only the
 * non-overlapping remainder. Matching is SEQUENCE-based (a run of ≥ minOverlap consecutive content
 * matches), NOT content-fingerprint — so two genuinely-identical gems that legitimately appear twice
 * are preserved. The in-game owned-count footer (per attribute) is the eventual CHECKSUM:
 * `assessCount` compares the assembled length to the target and flags under/over-count.
 *
 * First cut: an in-order fold with the same conservative ≥4-overlap rule as the live path (an
 * unplaceable screenshot is left out, surfaced via the step `mode` / the count checksum rather than
 * blindly concatenated). Order-tolerant jigsaw assembly + count-driven overlap relaxation are the
 * documented next steps.
 */
import { isSameArkGridGem } from '../models/arkGridGemSpecs';
import type { ArkGridGem } from '../models/arkGridGems';

/** Minimum consecutive-gem overlap to accept a merge (matches the live path's SAME_COUNT_THRESHOLD). */
export const DEFAULT_MIN_OVERLAP = 4;

/** Merge fragments, dropping only gems that duplicate (by `eq`) one from an EARLIER fragment. Within a
 *  fragment nothing is removed, so a fragment's own legitimate repeats (e.g. two cuts that differ only
 *  in willpower) survive; only the cross-fragment overlap a sequence merge couldn't reach is collapsed. */
function crossDedupeFragments(
  fragments: ArkGridGem[][],
  eq: (a: ArkGridGem, b: ArkGridGem) => boolean
): ArkGridGem[] {
  const out: ArkGridGem[] = [];
  for (const frag of fragments) {
    const keep = frag.filter((g) => !out.some((o) => eq(o, g)));
    out.push(...keep);
  }
  return out;
}
/** Gem equality ignoring willpower (req) — the OCR-fragile digit that can read differently between
 *  shots of the same gem, making one gem look like two. Used only as a count-gated last resort. */
function sameGemIgnoringWillpower(a: ArkGridGem, b: ArkGridGem): boolean {
  return (
    a.name === b.name &&
    a.gemAttr === b.gemAttr &&
    a.point === b.point &&
    a.option1.optionType === b.option1.optionType &&
    a.option1.value === b.option1.value &&
    a.option2.optionType === b.option2.optionType &&
    a.option2.value === b.option2.value
  );
}

/** Largest k in [1..min(a,b)] for which a's LAST k gems equal b's FIRST k gems; 0 if none. */
export function suffixPrefixOverlap(a: ArkGridGem[], b: ArkGridGem[]): number {
  const max = Math.min(a.length, b.length);
  for (let k = max; k >= 1; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (!isSameArkGridGem(a[a.length - k + i], b[i])) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  return 0;
}

export type StitchMode = 'seed' | 'append' | 'prepend' | 'contained' | 'nomatch';
export interface StitchStep {
  gems: ArkGridGem[];
  mode: StitchMode;
  /** The contiguous overlap that was used (or the best found, for `nomatch`). */
  overlap: number;
}

/**
 * Merge one screenshot's gems into an accumulated sequence by maximal contiguous overlap:
 * - empty `acc` → seed with `incoming`.
 * - `acc` suffix == `incoming` prefix (scrolled DOWN) → append `incoming`'s remainder.
 * - `acc` prefix == `incoming` suffix (scrolled UP) → prepend `incoming`'s remainder.
 * - `incoming` fully overlaps `acc` (re-upload) → `contained`, no change.
 * - best overlap < `minOverlap` → `nomatch`, `acc` returned unchanged (the count checksum flags the gap).
 */
export function stitchScreenshot(
  acc: ArkGridGem[],
  incoming: ArkGridGem[],
  minOverlap: number = DEFAULT_MIN_OVERLAP
): StitchStep {
  if (incoming.length === 0) return { gems: acc, mode: 'nomatch', overlap: 0 };
  if (acc.length === 0) return { gems: incoming.slice(), mode: 'seed', overlap: 0 };

  const down = suffixPrefixOverlap(acc, incoming); // acc above, incoming below
  const up = suffixPrefixOverlap(incoming, acc); // incoming above, acc below
  const best = Math.max(down, up);
  if (best < minOverlap) return { gems: acc, mode: 'nomatch', overlap: best };

  if (down >= up) {
    if (down === incoming.length) return { gems: acc, mode: 'contained', overlap: down };
    return { gems: acc.concat(incoming.slice(down)), mode: 'append', overlap: down };
  }
  if (up === incoming.length) return { gems: acc, mode: 'contained', overlap: up };
  return {
    gems: incoming.slice(0, incoming.length - up).concat(acc),
    mode: 'prepend',
    overlap: up,
  };
}

/** Fold screenshots left-to-right into one de-duplicated sequence (in-order, first cut). */
export function stitchScreenshots(
  screens: ArkGridGem[][],
  minOverlap: number = DEFAULT_MIN_OVERLAP
): ArkGridGem[] {
  let acc: ArkGridGem[] = [];
  for (const screen of screens) acc = stitchScreenshot(acc, screen, minOverlap).gems;
  return acc;
}

export interface CountStatus {
  /** Per-attribute owned count from the in-game footer (null until OCR provides it). */
  target: number | null;
  count: number;
  /** count === target (null with no target). */
  complete: boolean | null;
  /** count > target — a stitch error or extra/foreign captures. */
  overcount: boolean;
  /** max(0, target − count) still to capture (null with no target). */
  remaining: number | null;
}

/** Relaxed overlap used once a target count is available to vouch for the assembly (see
 *  {@link assembleScreenshots}). Low enough to bridge the real 3-gem `Order 2/3` overlap, above the
 *  1-gem coincidence floor; the exact-count acceptance test is the actual safety net. */
export const RELAXED_MIN_OVERLAP = 2;

export interface AssemblyResult {
  /** The de-duplicated sequence (a single fragment when count-confirmed; else the longest fragment). */
  gems: ArkGridGem[];
  /** Checksum status of `gems.length` vs the target. NOTE: `status.complete` reflects only the
   *  returned fragment — a UI must also require `fragments === 1` before showing "complete". */
  status: CountStatus;
  /** How the sequence was assembled:
   *  - `count-confirmed`: a relaxed assembly whose length the footer target vouches for (trusted);
   *  - `conservative`: a clean chain at the ≥{@link DEFAULT_MIN_OVERLAP} overlap (or, when fragmented,
   *     the longest fragment, with `fragments` > 1 flagging the unbridged gap);
   *  - `relaxed`: a single sequence recovered only at the ≥{@link RELAXED_MIN_OVERLAP} floor with no
   *     count to confirm it — the UI surfaces it as unverified rather than dropping the orphaned shot. */
  method: 'count-confirmed' | 'conservative' | 'relaxed';
  /** Disjoint fragments in the chosen assembly; > 1 means an unbridged gap (a shot didn't connect). */
  fragments: number;
}

/**
 * Order-tolerant greedy overlap assembly: treat each screenshot as a fragment and repeatedly merge
 * the fragment pair with the largest suffix→prefix overlap (any ordering) ≥ `minOverlap`, until no
 * pair qualifies. Returns the surviving fragments, longest first. A fully-contained fragment is
 * absorbed (its remainder is empty). Pure; n (screenshots) is small so the O(n²·merges) loop is fine.
 */
export function greedyAssemble(screens: ArkGridGem[][], minOverlap: number): ArkGridGem[][] {
  const minOv = Math.max(1, minOverlap); // floor at 1: a zero-overlap pair must never merge (no double-count)
  let frags = screens.filter((s) => s.length > 0).map((s) => s.slice());
  for (;;) {
    let bi = -1;
    let bj = -1;
    let bestOverlap = minOv - 1;
    let merged: ArkGridGem[] | null = null;
    for (let i = 0; i < frags.length; i++) {
      for (let j = 0; j < frags.length; j++) {
        if (i === j) continue;
        const ov = suffixPrefixOverlap(frags[i], frags[j]); // frags[i] above frags[j]
        if (ov > bestOverlap) {
          bestOverlap = ov;
          bi = i;
          bj = j;
          merged = frags[i].concat(frags[j].slice(ov)); // slice(ov)=[] when j is fully contained
        }
      }
    }
    if (bi < 0 || !merged) break;
    frags = frags.filter((_, k) => k !== bi && k !== bj);
    frags.push(merged);
  }
  return frags.sort((a, b) => b.length - a.length);
}

/**
 * Assemble several single-attribute screenshots into one de-duplicated inventory, using the in-game
 * owned-count footer as the referee:
 * - With a `target`: progressively RELAX the overlap floor (from {@link RELAXED_MIN_OVERLAP} down to a
 *   single shared gem) and accept the first assembly that collapses to ONE sequence whose length equals
 *   the count exactly → `count-confirmed`. The exact-count match is the safety net: it lets a 1-gem
 *   bridge through (which a dropped row can shrink a real overlap to) because a coincidental short match
 *   almost never lands on the exact owned total.
 * - A clean CONSERVATIVE chain (≥ {@link DEFAULT_MIN_OVERLAP} throughout) → `conservative`, fragments 1.
 * - A single RELAXED chain (≥ {@link RELAXED_MIN_OVERLAP}) with no confirming count → `relaxed` (unverified).
 * - Otherwise the UNION of every fragment's gems (overlap-deduped within each fragment) is returned —
 *   uploads always accumulate rather than dropping the orphaned shot — with `fragments > 1` flagging the
 *   unverified contiguity. Boundary gems shared below the floor may double-count; a present count flags
 *   that as an overcount.
 */
export function assembleScreenshots(
  screens: ArkGridGem[][],
  target: number | null | undefined,
  opts: { conservativeMin?: number; relaxedMin?: number } = {}
): AssemblyResult {
  const conservativeMin = opts.conservativeMin ?? DEFAULT_MIN_OVERLAP;
  const relaxedMin = opts.relaxedMin ?? RELAXED_MIN_OVERLAP;

  // With a footer count, relax the overlap floor step by step until one sequence matches the count.
  if (target != null) {
    for (let min = relaxedMin; min >= 1; min--) {
      const frags = greedyAssemble(screens, min);
      if (frags.length === 1 && frags[0].length === target) {
        return { gems: frags[0], status: assessCount(target, target), method: 'count-confirmed', fragments: 1 };
      }
    }
  }

  const conservative = greedyAssemble(screens, conservativeMin);
  if (conservative.length === 1) {
    return { gems: conservative[0], status: assessCount(conservative[0].length, target ?? null), method: 'conservative', fragments: 1 };
  }
  // Conservative left a gap. A single relaxed chain is the next-best (unverified) assembly.
  const relaxed = greedyAssemble(screens, relaxedMin);
  if (relaxed.length === 1) {
    return { gems: relaxed[0], status: assessCount(relaxed[0].length, target ?? null), method: 'relaxed', fragments: 1 };
  }
  // Still fragmented: return the UNION of all gems rather than dropping orphans, so uploads accumulate.
  const union = relaxed.flat();
  // A union over the count double-counts gems shared across non-merging fragments — overlapping or
  // redundant captures whose shared run sits mid-sequence (the suffix/prefix merge can't absorb it),
  // sometimes with a willpower digit read differently per shot. Remove duplicates with increasing
  // tolerance and accept the level that hits the owned count EXACTLY (the checksum gates the looser pass
  // so it never silently merges gems the player genuinely owns twice).
  if (target != null && union.length > target) {
    for (const eq of [isSameArkGridGem, sameGemIgnoringWillpower]) {
      const merged = crossDedupeFragments(relaxed, eq);
      if (merged.length === target) {
        return { gems: merged, status: assessCount(target, target), method: 'count-confirmed', fragments: 1 };
      }
    }
  }
  return { gems: union, status: assessCount(union.length, target ?? null), method: 'relaxed', fragments: relaxed.length };
}

/** Compare an assembled gem count to the footer target (the checksum). */
export function assessCount(count: number, target: number | null | undefined): CountStatus {
  if (target == null) {
    return { target: null, count, complete: null, overcount: false, remaining: null };
  }
  return {
    target,
    count,
    complete: count === target,
    overcount: count > target,
    remaining: Math.max(0, target - count),
  };
}
