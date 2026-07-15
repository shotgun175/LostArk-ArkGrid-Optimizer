import { persistedState } from 'svelte-persisted-state';

import { type ArkGridAttr, ArkGridAttrs, DEFAULT_PROFILE_NAME } from '../constants/enums';
import {
  type ArkGridCore,
  type ArkGridCoreType,
  ArkGridCoreTypes,
  createCore,
} from '../models/arkGridCores';
import { type ArkGridGem, determineGemGrade } from '../models/arkGridGems';
import { BASELINE_MAX_GRADE, BASELINE_MIN_GRADE } from '../scoring/gemScore';
import type { GemSetPackTuple } from '../solver/models';
import { addNewProfile, appConfig, getProfile } from './appConfig.state.svelte';
import {
  type BuildRole,
  type CoreSet,
  initBuildCores,
  migrateProfileToDualBuild,
  otherRole,
} from './dualBuild';

export { otherRole };
export type { BuildRole, CoreSet };

export const currentProfileName = persistedState<string>(
  'currentProfileName',
  DEFAULT_PROFILE_NAME
);
export interface AllGems {
  orderGems: ArkGridGem[];
  chaosGems: ArkGridGem[];
}
export type WeaponInfo = {
  fixed: number;
  percent: number;
};
/** One of a character's two builds: its own cores, solve result, and triage baseline. */
export interface BuildState {
  cores: CoreSet;
  solveInfo: SolveInfo;
  /** Manual triage baseline override; when set, replaces the auto baseline (weakest equipped gem). */
  baselineOverride?: number;
}

export interface CharacterProfile {
  characterName: string;
  gems: AllGems;
  weapon?: WeaponInfo;
  /** Cutting Plan: gold-per-1%-damage bracket (Phase 2b). Underscore form, e.g. '2_5M'. */
  goldPer1Pct?: import('../cutplan/types').GoldBracket;
  /** Cutting Plan: NRB/RB binding mode (Phase 2b). */
  bindingMode?: import('../cutplan/types').BindingMode;
  /** Two independent builds (DPS + Support). The gem pool and weapon are shared across both. */
  builds: Record<BuildRole, BuildState>;
  /** Which build the UI is currently viewing/editing; also the active triage/cutplan role. */
  activeBuild: BuildRole;
  /** True only for characters that play both roles; gates solve-both + cross-build triage. */
  dualRole: boolean;
}

// Result

// Solve result
export type SolveAnswerScoreSet = {
  score: number;
  bestScore: number;
  perfectScore: number;
};
export type SolveAnswer = {
  assignedGems: ArkGridGem[][];
  gemSetPackTuple: GemSetPackTuple;
};
export type AdditionalGemResult = Record<
  ArkGridAttr,
  Record<
    string, // corePointTuple stringified, e.g. "10,17,17"
    {
      corePointTuple: [number, number, number];
      gems: ArkGridGem[];
      score: number;
    }
  >
>;
export type NeedLauncherGem = Record<ArkGridAttr, boolean>;
export type SolveAfter = {
  solveAnswer?: SolveAnswer;
  scoreSet?: SolveAnswerScoreSet;
  answerCores?: Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>;
  additionalGemResult?: AdditionalGemResult;
  needLauncherGem?: NeedLauncherGem;
  /** Signature of the solve inputs (this build's cores + shared gems); see solveInputSignature. */
  inputSig?: string;
};
/** The endgame ("all-Ancient cores") solve of the user's real gems: which gems a fully-maxed grid slots. */
export type EndgameSolve = {
  /** Per-core gem assignment (6 slots: Order Sun/Moon/Star, Chaos Sun/Moon/Star), gem copies. */
  assignedGems: ArkGridGem[][];
  /** Signature of the inputs this endgame solve was computed from (this build's cores + shared gems). */
  inputSig: string;
};
export type SolveInfo = {
  after?: SolveAfter;
  /** Endgame (all-Ancient) solve, computed alongside `after` or via the standalone refresh button. */
  endgame?: EndgameSolve;
};

// --- Active-build accessors --------------------------------------------------
// Cores, solve result, and baseline are per-build. These let the mutators and
// panels read/write "the build currently in view" without threading the role.

/** The build the UI is currently viewing/editing. */
export function activeBuildState(p: CharacterProfile = getCurrentProfile()): BuildState {
  return p.builds[p.activeBuild];
}
/** A specific build by role (used by cross-build triage, which reaches into both). */
export function buildState(role: BuildRole, p: CharacterProfile = getCurrentProfile()): BuildState {
  return p.builds[role];
}
/** Whether the active build is the Support build (the role used for scoring/coeffs). */
export function isActiveSupporter(p: CharacterProfile = getCurrentProfile()): boolean {
  return p.activeBuild === 'support';
}
/** Non-destructively switch which build is in view; never mutates stored build data. */
export function setActiveBuild(role: BuildRole) {
  getCurrentProfile().activeBuild = role;
}
/** Mark whether this character plays both roles; never mutates stored build data. */
export function setDualRole(v: boolean) {
  getCurrentProfile().dualRole = v;
}

/** Write a solve result into a specific build (used by solve-both for dual-role characters). */
export function setBuildSolveAfter(role: BuildRole, data: SolveAfter) {
  buildState(role).solveInfo.after = data;
}

/** Write the endgame (all-Ancient) solve result into a specific build. */
export function setBuildEndgame(role: BuildRole, data: EndgameSolve) {
  buildState(role).solveInfo.endgame = data;
}

export function initNewProfile(name: string): CharacterProfile {
  return {
    characterName: name,
    gems: {
      orderGems: [],
      chaosGems: [],
    },
    builds: {
      dps: {
        cores: initBuildCores(false),
        solveInfo: {},
      },
      support: {
        cores: initBuildCores(true),
        solveInfo: {},
      },
    },
    activeBuild: 'dps',
    dualRole: false,
  };
}

export function migrateProfile(profile: Partial<CharacterProfile>) {
  // Dual-build: wrap legacy single-role fields (cores/isSupporter/solveInfo/baselineOverride)
  // into builds.{dps,support} + activeBuild + dualRole. Idempotent for already-migrated profiles.
  migrateProfileToDualBuild(profile as Record<string, unknown>);

  // Drop the retired solveInfo.before (its only field, coreGoalPoint, was never
  // read; per-core goalPoint replaced it) from persisted payloads.
  for (const role of ['dps', 'support'] as BuildRole[]) {
    const solveInfo = profile.builds?.[role]?.solveInfo as Record<string, unknown> | undefined;
    if (solveInfo && 'before' in solveInfo) {
      delete solveInfo.before;
    }
  }

  // Minimum Core Points retired with the Optimization section (0.3.0): the editor UI is gone and
  // the solver always receives point 0, so reset any saved non-zero minimum. Setting every core to
  // 0 also covers the old backfill for pre-goalPoint payloads (undefined !== 0).
  for (const role of ['dps', 'support'] as BuildRole[]) {
    const cores = profile.builds?.[role]?.cores;
    if (!cores) continue;
    for (const attr of Object.values(ArkGridAttrs)) {
      for (const ctype of Object.values(ArkGridCoreTypes)) {
        const core = cores[attr][ctype];
        if (core && core.goalPoint !== 0) {
          core.goalPoint = 0;
        }
      }
    }
  }

  // The triage/cut-plan baseline override moved from a % damage value (≤ 2) to a 0-100 grade tier.
  // Drop any pre-migration override (out of the grade range) so the baseline re-derives from the
  // loadout instead of being read as grade ≈ F.
  for (const role of ['dps', 'support'] as BuildRole[]) {
    const build = profile.builds?.[role];
    if (
      build?.baselineOverride !== undefined &&
      (build.baselineOverride < BASELINE_MIN_GRADE || build.baselineOverride > BASELINE_MAX_GRADE)
    ) {
      build.baselineOverride = undefined;
    }
  }
}

export function getCurrentProfile() {
  // Always returns the current profile.
  // Return the profile if found
  const profile = getProfile(currentProfileName.current);
  if (profile) return profile;
  else {
    // If the default profile exists, switch to it and return
    const defaultProfile = getProfile(DEFAULT_PROFILE_NAME);
    setCurrentProfileName(DEFAULT_PROFILE_NAME);
    if (defaultProfile) return defaultProfile;

    // If no default profile exists, create and return one
    const newDefaultProfile = initNewProfile(DEFAULT_PROFILE_NAME);
    if (!addNewProfile(newDefaultProfile)) {
      throw Error('Failed to create the default profile!');
    }
    return newDefaultProfile;
  }
}

export function setCurrentProfileName(name: string) {
  currentProfileName.current = name;
}

export function deleteProfile(name: string) {
  if (name === DEFAULT_PROFILE_NAME) return;
  const profiles = appConfig.current.characterProfiles;
  const index = profiles.findIndex((p) => p.characterName === name);

  if (index === -1) return;
  if (currentProfileName.current === name) {
    // Switch to a neighbour before splicing. At index 0 `profiles[index - 1]` is undefined (the
    // old crash), so fall back to the next profile, then to the default name — getCurrentProfile()
    // recreates the default if it somehow no longer exists.
    const fallback = profiles[index - 1] ?? profiles[index + 1];
    setCurrentProfileName(fallback?.characterName ?? DEFAULT_PROFILE_NAME);
  }
  profiles.splice(index, 1);
  // If the deleted profile was the currently selected one, reset it
}

export function updateProfileCharacterName(name: string) {
  // Update the name of the current profile (same rules as addNewProfile:
  // non-empty, max 16 chars, unique).
  if (name.length == 0 || name.length > 16) return false;
  // The default profile must keep its name: it's the guaranteed always-present fallback that
  // deleteProfile refuses to remove, so renaming it away would let it be deleted and break that
  // invariant (and could crash deleteProfile at index 0).
  if (currentProfileName.current === DEFAULT_PROFILE_NAME) return false;
  const existProfile = appConfig.current.characterProfiles.findIndex(
    (p) => p.characterName === name
  );
  if (existProfile != -1) return false;
  const profile = getCurrentProfile();
  profile.characterName = name;
  return true;
}

export function addGem(gem: ArkGridGem) {
  const gems = getCurrentProfile().gems;
  const targetGems = gem.gemAttr == 'Order' ? gems.orderGems : gems.chaosGems;
  gem.grade = determineGemGrade(gem.req, gem.point, gem.option1, gem.option2, gem.name);
  // validate gem (e.g. options on a Stability gem)
  targetGems.push(gem);
}

export function clearGems(gemAttr?: ArkGridAttr) {
  const gems = getCurrentProfile().gems;
  switch (gemAttr) {
    case 'Order':
      gems.orderGems.length = 0;
      break;
    case 'Chaos':
      gems.chaosGems.length = 0;
      break;
    default:
      gems.orderGems.length = 0;
      gems.chaosGems.length = 0;
  }
}

export function deleteGem(gem: ArkGridGem) {
  const gems = getCurrentProfile().gems;
  const targetGems = gem.gemAttr === 'Order' ? gems.orderGems : gems.chaosGems;

  // Remove the gem from the array
  const index = targetGems.indexOf(gem);
  if (index !== -1) {
    targetGems.splice(index, 1);
  }
}
export function getCore(attr: ArkGridAttr, ctype: ArkGridCoreType) {
  return activeBuildState().cores[attr][ctype];
}
export function addCore(attr: ArkGridAttr, ctype: ArkGridCoreType) {
  const profile = getCurrentProfile();
  activeBuildState(profile).cores[attr][ctype] = createCore(
    attr,
    ctype,
    'Epic',
    isActiveSupporter(profile),
    profile.weapon
  );
}
export function resetCore(attr: ArkGridAttr, ctype: ArkGridCoreType) {
  activeBuildState().cores[attr][ctype] = null;
}

export function updateBaselineOverride(baseline: number | undefined) {
  activeBuildState().baselineOverride = Number.isFinite(baseline) ? baseline : undefined;
}

export function updateGoldPer1Pct(bracket: import('../cutplan/types').GoldBracket) {
  getCurrentProfile().goldPer1Pct = bracket;
}

export function updateBindingMode(mode: import('../cutplan/types').BindingMode) {
  getCurrentProfile().bindingMode = mode;
}

export const roleImages = import.meta.glob<string>('/src/assets/role/*.webp', {
  eager: true,
  import: 'default',
});
export const imgRoleCombat = roleImages['/src/assets/role/combat.webp'];
export const imgRoleSupporter = roleImages['/src/assets/role/supporter.webp'];
