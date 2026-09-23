import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { mergeImportedGems } from './mergeImportedGems';

const gem = (): ArkGridGem => ({
  gemAttr: 'Order',
  req: 3,
  point: 5,
  option1: { optionType: 'AtkPower', value: 5 },
  option2: { optionType: 'AddDamage', value: 5 },
});

describe('mergeImportedGems', () => {
  it('adds every copy of identical gems into an empty list', () => {
    expect(mergeImportedGems([], [gem(), gem()]).length).toBe(2);
  });

  it('adds nothing when the same copies are imported again', () => {
    const list = mergeImportedGems([], [gem(), gem()]);
    expect(mergeImportedGems(list, [gem(), gem()]).length).toBe(0);
  });

  it('adds only the copies beyond those already in the list', () => {
    expect(mergeImportedGems([gem()], [gem(), gem()]).length).toBe(1);
  });

  it('keeps Order and Chaos copies apart', () => {
    expect(mergeImportedGems([gem()], [{ ...gem(), gemAttr: 'Chaos' }]).length).toBe(1);
  });
});
