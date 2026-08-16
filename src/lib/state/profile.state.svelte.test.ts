import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILE_NAME } from '../constants/enums';
import { gradeRows, rankFromGrade } from '../scoring/gemScore';
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

  it('resets saved Minimum Core Points to 0 (feature retired with the Optimization section)', () => {
    const dpsCores = initBuildCores(false);
    const supportCores = initBuildCores(true);
    const profile = {
      characterName: 'MinPoints',
      gems: { orderGems: [], chaosGems: [] },
      builds: {
        dps: { cores: dpsCores, solveInfo: {} },
        support: { cores: supportCores, solveInfo: {} },
      },
      activeBuild: 'dps',
      dualRole: false,
    } as any;
    // A saved non-zero minimum, and a pre-goalPoint payload (field missing entirely).
    profile.builds.dps.cores.Order.Sun.goalPoint = 10;
    profile.builds.support.cores.Chaos.Star.goalPoint = 14;
    delete profile.builds.dps.cores.Order.Moon.goalPoint;

    migrateProfile(profile);

    for (const build of [profile.builds.dps, profile.builds.support]) {
      for (const attr of ['Order', 'Chaos']) {
        for (const ctype of ['Sun', 'Moon', 'Star']) {
          const core = build.cores[attr][ctype];
          if (core) expect(core.goalPoint).toBe(0);
        }
      }
    }

    // Idempotent: a second pass changes nothing.
    const snapshot = JSON.parse(JSON.stringify(profile));
    migrateProfile(profile);
    expect(profile).toEqual(snapshot);
  });

  it('re-expresses a pre-2026-08 baseline override on the new per-axis ladder BY RANK', () => {
    const mk = (dpsOverride: number | undefined, supOverride: number | undefined) =>
      ({
        characterName: 'Ladder',
        gems: { orderGems: [], chaosGems: [] },
        builds: {
          dps: { cores: initBuildCores(false), solveInfo: {}, baselineOverride: dpsOverride },
          support: { cores: initBuildCores(true), solveInfo: {}, baselineOverride: supOverride },
        },
        activeBuild: 'dps',
        dualRole: false,
      }) as any;

    // Old ladder 40..95 step 5 = C- ... S+. "A-" was 70 and is now 80; "S+" was 95 and is now the
    // axis's perfect-c8 grade (96.1 DPS, 94.6 support); "C-" was 40 and is now 60.
    const p1 = mk(70, 95);
    migrateProfile(p1);
    expect(p1.builds.dps.baselineOverride).toBe(gradeRows('dps')[6]); // A- stays A-
    expect(p1.builds.support.baselineOverride).toBe(gradeRows('support')[11]); // S+ stays S+
    expect(p1.builds.dps.baselineLadder).toBe(2);
    expect(p1.builds.support.baselineLadder).toBe(2);
    expect(rankFromGrade(p1.builds.dps.baselineOverride, 'dps')).toBe('A-');
    expect(rankFromGrade(p1.builds.support.baselineOverride, 'support')).toBe('S+');

    // 60 sits on BOTH ladders (old B, new C-): the marker is what disambiguates, so an unmigrated 60
    // becomes B (73.3) and a marked 60 stays C-.
    const p2 = mk(60, undefined);
    migrateProfile(p2);
    expect(p2.builds.dps.baselineOverride).toBe(73.3);
    expect(p2.builds.support.baselineOverride).toBeUndefined();
    const p3 = mk(60, undefined);
    p3.builds.dps.baselineLadder = 2;
    migrateProfile(p3);
    expect(p3.builds.dps.baselineOverride).toBe(60);

    // Idempotent: a second pass changes nothing.
    const snapshot = JSON.parse(JSON.stringify(p1));
    migrateProfile(p1);
    expect(p1).toEqual(snapshot);
  });

  it('marks builds created at runtime as new-ladder, so a fresh override survives the next load', () => {
    const p = initNewProfile('Fresh');
    expect(p.builds.dps.baselineLadder).toBe(2);
    expect(p.builds.support.baselineLadder).toBe(2);
    // an in-session A- (80) must still be A- after the read-time migration runs on it
    p.builds.dps.baselineOverride = 80;
    migrateProfile(p as any);
    expect(p.builds.dps.baselineOverride).toBe(80);
  });

  it('drops an override that is off both ladders (a pre-grade % value or out of range)', () => {
    const profile = {
      characterName: 'Stale',
      gems: { orderGems: [], chaosGems: [] },
      builds: {
        dps: { cores: initBuildCores(false), solveInfo: {}, baselineOverride: 0.85 },
        support: {
          cores: initBuildCores(true),
          solveInfo: {},
          baselineOverride: 200,
          baselineLadder: 2,
        },
      },
      activeBuild: 'dps',
      dualRole: false,
    } as any;
    migrateProfile(profile);
    expect(profile.builds.dps.baselineOverride).toBeUndefined();
    expect(profile.builds.support.baselineOverride).toBeUndefined();
  });
});
