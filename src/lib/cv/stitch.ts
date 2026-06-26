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
