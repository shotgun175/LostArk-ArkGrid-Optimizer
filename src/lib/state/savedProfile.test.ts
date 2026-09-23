import { describe, expect, it, vi } from 'vitest';

import { computeGemScore } from '../scoring/gemScore';
import { autoBaselineFromLoadout, effectiveBaseline, triageOwnedGems } from '../scoring/triage';
import { solveInputSignature } from '../solver/solveSignature';
import { appConfig, getProfile } from './appConfig.state.svelte';
import {
  type BuildRole,
  type CharacterProfile,
  buildState,
  otherRole,
} from './profile.state.svelte';

// An appConfig exactly as v0.3.12 saved it: three profiles (one named "42n") and a dual-role
// "Fixture" profile solved twice, so its saved solves carry gemSetPackTuple "123n" bigint strings,
// answerCores and the isNew/replaces/swapIndex markers. Loaded through the real persisted-state read
// path (serializer + beforeRead migrations) by giving it a browser-like localStorage.
await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const fixture = readFileSync(
    new URL('./fixtures/appConfig-v0.3.12.json', import.meta.url),
    'utf8'
  );
  const store = new Map<string, string>([
    ['appConfig', fixture],
    ['currentProfileName', '"Fixture"'],
  ]);
  Object.assign(globalThis, {
    window: { addEventListener: () => {} },
    document: {},
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
});

// Gem Triage's verdicts for one build, computed the way GemTriagePanel does.
function triageActions(profile: CharacterProfile, role: BuildRole) {
  const build = buildState(role, profile);
  const other = buildState(otherRole(role), profile);
  const dual = profile.dualRole;
  const equipped = (build.solveInfo.after?.solveAnswer?.assignedGems ?? []).flat();
  const baseline = effectiveBaseline(
    autoBaselineFromLoadout(equipped, role),
    build.baselineOverride,
    role
  );
  const fresh = (b: typeof build) =>
    b.solveInfo.endgame?.inputSig === solveInputSignature(b.cores, profile.gems);
  const owned = [...profile.gems.orderGems, ...profile.gems.chaosGems];
  return triageOwnedGems(
    owned.map((gem) => ({ gem, grade: computeGemScore(gem, role).grade })),
    {
      activeCurrent: build.solveInfo.after?.solveAnswer?.assignedGems,
      retainAssignments: [
        build.solveInfo.endgame?.assignedGems,
        dual ? other.solveInfo.after?.solveAnswer?.assignedGems : undefined,
        dual ? other.solveInfo.endgame?.assignedGems : undefined,
      ],
      baseline,
      hasEndgameEvidence: fresh(build) && (!dual || fresh(other)),
      role,
    }
  ).map((r) => r.action);
}

describe('an appConfig saved by v0.3.12', () => {
  it('loads every profile, and a profile named "42n" keeps its name as a string', () => {
    expect(appConfig.current.characterProfiles.map((p) => p.characterName)).toEqual([
      'Default',
      '42n',
      'Fixture',
    ]);
    expect(typeof appConfig.current.characterProfiles[1].characterName).toBe('string');
    expect(getProfile('42n')).toBeDefined();
  });

  it('triages its saved solves exactly as v0.3.12 did', () => {
    const profile = getProfile('Fixture')!;
    expect(profile.gems.orderGems).toHaveLength(14);
    expect(profile.gems.chaosGems).toHaveLength(14);
    // Recorded from v0.3.12 on the same saved profile, one letter per owned gem in pool order
    // (e = equipped, u = upgrade, k = keep, r = remove).
    const letters = (role: BuildRole) =>
      triageActions(profile, role)
        .map((a) => a[0])
        .join('');
    expect(letters('dps')).toBe('kkeekeekrerkekkeeeerkekkeker');
    expect(letters('support')).toBe('kkkkkekkrerkkkkeekkrkkkkekkr');
  });
});
