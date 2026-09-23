import { isSameArkGridGem } from '../models/arkGridGemSpecs';
import type { ArkGridGem } from '../models/arkGridGems';

/**
 * The imported gems to add to a list that already holds `existing`. Identical gems are legal, so
 * each existing gem absorbs at most one matching import: importing two copies next to one already
 * listed adds one, and re-importing the same loadout adds none.
 */
export function mergeImportedGems(existing: ArkGridGem[], imported: ArkGridGem[]): ArkGridGem[] {
  const unmatched = [...existing];
  const toAdd: ArkGridGem[] = [];
  for (const gem of imported) {
    const i = unmatched.findIndex((g) => isSameArkGridGem(g, gem));
    if (i === -1) toAdd.push(gem);
    else unmatched.splice(i, 1);
  }
  return toAdd;
}
