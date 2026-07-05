import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILE_NAME } from '../constants/enums';
import { addNewProfile, appConfig, getProfile } from './appConfig.state.svelte';
import { initBuildCores } from './dualBuild';
import {
  deleteProfile,
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

  it('refuses to rename the default profile (keeps the always-present fallback)', () => {
    setCurrentProfileName(DEFAULT_PROFILE_NAME);
    expect(updateProfileCharacterName('Renamed')).toBe(false);
    // The default must keep its name so deleteProfile can never remove it.
    expect(getProfile(DEFAULT_PROFILE_NAME)).toBeDefined();
  });
});

describe('deleteProfile', () => {
  it('does not crash deleting the current profile at index 0', () => {
    // Force the crash state the old code hit: a deletable, current profile at index 0, where
    // `profiles[index - 1]` is profiles[-1] === undefined. (The default normally occupies index 0.)
    addNewProfile(initNewProfile('Zed'));
    const profiles = appConfig.current.characterProfiles;
    const [zed] = profiles.splice(
      profiles.findIndex((p) => p.characterName === 'Zed'),
      1
    );
    profiles.unshift(zed); // Zed now at index 0
    setCurrentProfileName('Zed');

    expect(() => deleteProfile('Zed')).not.toThrow();
    expect(getProfile('Zed')).toBeUndefined();
    // The default profile invariant survives.
    expect(getProfile(DEFAULT_PROFILE_NAME)).toBeDefined();
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
