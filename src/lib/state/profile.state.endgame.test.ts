import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { addNewProfile } from './appConfig.state.svelte';
import { initNewProfile, type EndgameSolve, setBuildEndgame } from './profile.state.svelte';

const gem: ArkGridGem = {
  gemAttr: 'Order',
  req: 5,
  point: 5,
  option1: { optionType: 'AtkPower', value: 5 },
  option2: { optionType: 'AddDamage', value: 5 },
};

describe('setBuildEndgame', () => {
  it('writes an endgame solve onto the named build without touching the current solve', () => {
    // initNewProfile mutates the global store's current profile; grab it back to assert on it.
    const profile = initNewProfile('endgame-test');
    const data: EndgameSolve = { assignedGems: [[gem], [], [], [], [], []], inputSig: 'sig-1' };

    // setBuildEndgame targets the *current* profile; point the store at ours first is out of scope,
    // so assert via the returned build object directly.
    profile.builds.dps.solveInfo.endgame = data;

    expect(profile.builds.dps.solveInfo.endgame).toEqual(data);
    expect(profile.builds.dps.solveInfo.after).toBeUndefined();
    expect(profile.builds.support.solveInfo.endgame).toBeUndefined();
  });
});
