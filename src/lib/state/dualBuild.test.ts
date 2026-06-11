import { describe, expect, it } from 'vitest';

import { initBuildCores, migrateProfileToDualBuild, otherRole } from './dualBuild';

describe('otherRole', () => {
  it('flips the role', () => {
    expect(otherRole('dps')).toBe('support');
    expect(otherRole('support')).toBe('dps');
  });
});

describe('initBuildCores', () => {
  it('builds 6 Epic cores (Order/Chaos x Sun/Moon/Star)', () => {
    const cores = initBuildCores(false);
    for (const attr of ['Order', 'Chaos'] as const) {
      for (const type of ['Sun', 'Moon', 'Star'] as const) {
        expect(cores[attr][type]?.grade).toBe('Epic');
      }
    }
  });

  it('uses role-specific coefficient tables (DPS vs Support differ on the same slot)', () => {
    // Order Sun Epic p10: DPS 150, Support 120 (getDefaultCoreCoeff tables).
    expect(initBuildCores(false).Order.Sun?.coeffs.p10).toBe(150);
    expect(initBuildCores(true).Order.Sun?.coeffs.p10).toBe(120);
  });
});

describe('migrateProfileToDualBuild', () => {
  it('moves a DPS single-role profile into builds.dps and creates a dormant support build', () => {
    const oldCores = initBuildCores(false);
    const oldSolve = {
      before: { coreGoalPoint: [1, 2, 3, 4, 5, 6] },
      after: { scoreSet: { score: 9, bestScore: 9, perfectScore: 9 } },
    };
    const p: Record<string, unknown> = {
      characterName: 'X',
      gems: { orderGems: [], chaosGems: [] },
      cores: oldCores,
      isSupporter: false,
      baselineOverride: 7,
      solveInfo: oldSolve,
    };

    migrateProfileToDualBuild(p);

    const builds = p.builds as Record<string, any>;
    expect(p.activeBuild).toBe('dps');
    expect(p.dualRole).toBe(false);
    // The old set (with its already-computed DPS coeffs) is preserved by reference.
    expect(builds.dps.cores).toBe(oldCores);
    expect(builds.dps.solveInfo).toBe(oldSolve);
    expect(builds.dps.baselineOverride).toBe(7);
    // The other build is fresh and dormant.
    expect(builds.support.cores).not.toBe(oldCores);
    expect(builds.support.cores.Order.Sun.grade).toBe('Epic');
    expect(builds.support.solveInfo.after).toBeUndefined();
    expect(builds.support.baselineOverride).toBeUndefined();
    // Legacy top-level fields are removed.
    expect('cores' in p).toBe(false);
    expect('isSupporter' in p).toBe(false);
    expect('solveInfo' in p).toBe(false);
    expect('baselineOverride' in p).toBe(false);
  });

  it('puts the old data in builds.support when the profile was a supporter', () => {
    const oldCores = initBuildCores(true);
    const p: Record<string, unknown> = {
      isSupporter: true,
      cores: oldCores,
      solveInfo: { before: { coreGoalPoint: [0, 0, 0, 0, 0, 0] } },
    };

    migrateProfileToDualBuild(p);

    const builds = p.builds as Record<string, any>;
    expect(p.activeBuild).toBe('support');
    expect(builds.support.cores).toBe(oldCores);
    expect(builds.dps.cores).not.toBe(oldCores);
    expect(builds.dps.cores.Order.Sun.grade).toBe('Epic');
  });

  it('is idempotent — an already-migrated profile is untouched', () => {
    const p: Record<string, unknown> = {
      builds: { dps: { marker: 1 } },
      activeBuild: 'dps',
      dualRole: true,
    };
    const before = JSON.stringify(p);

    migrateProfileToDualBuild(p);

    expect(JSON.stringify(p)).toBe(before);
  });

  it('handles a very old profile missing cores and solveInfo', () => {
    const p: Record<string, unknown> = { isSupporter: false };

    migrateProfileToDualBuild(p);

    const builds = p.builds as Record<string, any>;
    expect(builds.dps.cores.Order.Sun.grade).toBe('Epic');
    expect(builds.dps.solveInfo).toEqual({});
    expect(builds.support.cores.Chaos.Star.grade).toBe('Epic');
  });
});
