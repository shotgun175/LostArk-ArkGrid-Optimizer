import { describe, expect, it } from 'vitest';

import { addNewProfile } from './appConfig.state.svelte';
import { initBuildCores } from './dualBuild';
import {
  initNewProfile,
  migrateProfile,
  setCurrentProfileName,
  updateProfileCharacterName,
} from './profile.state.svelte';

describe('profile name rules', () => {
  it('addNewProfile rejects duplicates, empty, and >16 char names', () => {
    expect(addNewProfile(initNewProfile('Alice'))).toBe(true);
    expect(addNewProfile(initNewProfile('Alice'))).toBe(false);
    expect(addNewProfile(initNewProfile(''))).toBe(false);
    expect(addNewProfile(initNewProfile('A'.repeat(17)))).toBe(false);
  });

  it('rename enforces the same rules as creation', () => {
    addNewProfile(initNewProfile('Bob'));
    setCurrentProfileName('Bob');
    expect(updateProfileCharacterName('A'.repeat(17))).toBe(false);
    expect(updateProfileCharacterName('')).toBe(false);
    expect(updateProfileCharacterName('Alice')).toBe(false); // taken
    expect(updateProfileCharacterName('Bobby')).toBe(true);
  });
});

describe('migrateProfile', () => {
  it('strips the retired solveInfo.before from old persisted payloads', () => {
    const profile = {
      characterName: 'Old',
      gems: { orderGems: [], chaosGems: [] },
      builds: {
        dps: {
          cores: initBuildCores(false),
          solveInfo: { before: { coreGoalPoint: [0, 0, 0, 0, 0, 0] } },
        },
        support: {
          cores: initBuildCores(true),
          solveInfo: { before: { coreGoalPoint: [0, 0, 0, 0, 0, 0] } },
        },
      },
      activeBuild: 'dps',
      dualRole: false,
    } as any;

    migrateProfile(profile);

    expect('before' in profile.builds.dps.solveInfo).toBe(false);
    expect('before' in profile.builds.support.solveInfo).toBe(false);
  });
});
