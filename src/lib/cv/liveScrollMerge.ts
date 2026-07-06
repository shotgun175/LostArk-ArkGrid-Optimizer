// Pure merge for the LIVE screen-share path: given the gems already collected (`totalGems`) and the
// nine gems currently on screen (`currentGems`), decide what to append/prepend as the user scrolls.
// Extracted from GemRecognition/Panel.svelte so the overlap logic is unit-testable in isolation; the
// component keeps the UI side-effects (tab select + scroll). The upload path uses stitch.ts instead.
import { isSameArkGridGem } from '../models/arkGridGemSpecs';
import type { ArkGridGem } from '../models/arkGridGems';

type LiveScrollMerge = {
  /** The resulting list (a new array when changed; the same reference when not). */
  gems: ArkGridGem[];
  /** Whether any gems were added. */
  changed: boolean;
  /** Where the list grew, so the caller can scroll to the newest rows. */
  scroll: 'top' | 'bottom' | null;
};

// Require this many of the nine on-screen gems to already be known before merging — excludes
// too-fast scrolls, and a single same-option false match (which yields an overlap of 1).
const SAME_COUNT_THRESHOLD = 4;

/**
 * Merge the current screenful into the running list.
 *
 * - Empty list: seed it with whatever is on screen (need not be a full nine).
 * - Otherwise, only a full, normally-recognized screen (exactly nine) merges into a not-yet-full
 *   (<100) list. Anchor on the first on-screen gem to detect a downward scroll (append the
 *   non-overlapping tail); if that gem isn't known at all, anchor on the last to detect an upward
 *   scroll (prepend the non-overlapping head).
 *
 * Stops after the FIRST qualifying overlap. Several identical gems can make the anchor match at more
 * than one position; merging each would append the same tail once per match and double-count the
 * owned list — this returns on the first merge so the tail is added exactly once.
 */
export function mergeScrolledGems(
  totalGems: ArkGridGem[],
  currentGems: ArkGridGem[],
  threshold: number = SAME_COUNT_THRESHOLD
): LiveScrollMerge {
  if (totalGems.length === 0 && currentGems.length > 0) {
    return { gems: [...currentGems], changed: true, scroll: 'bottom' };
  }
  if (currentGems.length !== 9 || totalGems.length >= 100) {
    return { gems: totalGems, changed: false, scroll: null };
  }

  // Downward scroll: where does the first on-screen gem sit in the known list? Keep every candidate
  // in case identical gems share options.
  const downIndices: number[] = [];
  for (let i = 0; i < totalGems.length; i++) {
    if (isSameArkGridGem(totalGems[i], currentGems[0])) downIndices.push(i);
  }
  for (const foundIndex of downIndices) {
    let sameCount = 1;
    for (let i = 1; i < currentGems.length; i++) {
      if (foundIndex + i >= totalGems.length) break;
      if (isSameArkGridGem(totalGems[foundIndex + i], currentGems[i])) sameCount += 1;
      else break;
    }
    if (sameCount === 9) continue; // whole screen already known
    if (sameCount >= threshold) {
      return {
        gems: [...totalGems, ...currentGems.slice(sameCount, 9)],
        changed: true,
        scroll: 'bottom',
      };
    }
  }

  // Upward scroll — only when the first on-screen gem is missing entirely: anchor on the last.
  if (downIndices.length === 0) {
    const upIndices: number[] = [];
    for (let i = 0; i < totalGems.length; i++) {
      if (isSameArkGridGem(totalGems[i], currentGems[8])) upIndices.push(i);
    }
    for (const foundIndex of upIndices) {
      let sameCount = 1;
      for (let i = 1; i < currentGems.length; i++) {
        if (foundIndex - i < 0) break;
        if (isSameArkGridGem(totalGems[foundIndex - i], currentGems[8 - i])) sameCount += 1;
        else break;
      }
      if (sameCount === 9) continue;
      if (sameCount >= threshold) {
        return {
          gems: [...currentGems.slice(0, 9 - sameCount), ...totalGems],
          changed: true,
          scroll: 'top',
        };
      }
    }
  }

  return { gems: totalGems, changed: false, scroll: null };
}
