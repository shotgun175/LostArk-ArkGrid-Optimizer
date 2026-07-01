import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { addNewProfile } from './appConfig.state.svelte';
import {
  type EndgameSolve,
  getCurrentProfile,
  initNewProfile,
  setBuildEndgame,
  setCurrentProfileName,
} from './profile.state.svelte';

const gem: ArkGridGem = {
  gemAttr: 'Order',
  req: 5,
  point: 5,
  option1: { optionType: 'AtkPower', value: 5 },
  option2: { optionType: 'AddDamage', value: 5 },
};

describe('setBuildEndgame', () => {
  it('writes an endgame solve onto the named build without touching the current solve', () => {
    addNewProfile(initNewProfile('endgame-test'));
    setCurrentProfileName('endgame-test');

    const data: EndgameSolve = { assignedGems: [[gem], [], [], [], [], []], inputSig: 'sig-1' };
    setBuildEndgame('dps', data);

    const profile = getCurrentProfile();
    expect(profile.builds.dps.solveInfo.endgame).toEqual(data);
    expect(profile.builds.dps.solveInfo.after).toBeUndefined();
    expect(profile.builds.support.solveInfo.endgame).toBeUndefined();
  });
});
