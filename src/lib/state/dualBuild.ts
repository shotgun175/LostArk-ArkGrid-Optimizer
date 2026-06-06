import { type ArkGridAttr, ArkGridAttrs } from '../constants/enums';
import {
  type ArkGridCore,
  type ArkGridCoreType,
  ArkGridCoreTypes,
  createCore,
} from '../models/arkGridCores';

/**
 * A character can run two independent builds: a DPS build and a Support build. Each build owns
 * its own 6 cores (rarities can differ), its own solve result, and its own triage baseline. The
 * gem pool and weapon are shared. `dualRole` marks the (minority of) characters that actually
 * play both — single-role characters keep one live build and behave exactly as before.
 */
export type BuildRole = 'dps' | 'support';

// A function declaration (not a const arrow) on purpose: it is hoisted/initialized at module-link
// time, so the load-time profile migration (run synchronously from persistedState's beforeRead,
// before this module's body has evaluated in the appConfig <-> profile.state import cycle) can call
// it without hitting a temporal-dead-zone ReferenceError.
export function otherRole(role: BuildRole): BuildRole {
  return role === 'dps' ? 'support' : 'dps';
}

/** The 6-core grid for one build: keyed by attribute (Order/Chaos) then type (Sun/Moon/Star). */
export type CoreSet = Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>;

/**
 * Six enabled Epic cores (one per attr x type) with role-correct default coefficients. The DPS
 * and Support coefficient tables differ, so the role must be passed in; a fresh Support build is
 * `initBuildCores(true)`, a fresh DPS build `initBuildCores(false)`. No weapon yet (defaults are
 * assumed) — matches what clicking "+" does on a fresh slot.
 */
export function initBuildCores(isSupporter = false): CoreSet {
  const cores = {} as CoreSet;
  for (const attr of Object.values(ArkGridAttrs)) {
    cores[attr] = {} as Record<ArkGridCoreType, ArkGridCore | null>;
    for (const type of Object.values(ArkGridCoreTypes)) {
      cores[attr][type] = createCore(attr, type, 'Epic', isSupporter, undefined);
    }
  }
  return cores;
}

function emptySolveInfo() {
  return { before: { coreGoalPoint: [0, 0, 0, 0, 0, 0] } };
}

/**
 * Migrate a legacy single-role profile (top-level `cores` / `isSupporter` / `solveInfo` /
 * `baselineOverride`) into the dual-build shape (`builds.{dps,support}` + `activeBuild` +
 * `dualRole`). Idempotent: a profile that already has `builds` is left untouched.
 *
 * The existing core set — whose coefficients were already computed for the player's role — becomes
 * the build for that role; the other build is created dormant (fresh Epic, role-correct coeffs).
 * `dualRole` defaults to false, so a migrated single-role user keeps today's exact behavior until
 * they explicitly mark the character as playing both roles.
 *
 * Operates on the raw persisted object (pre-typed), so the parameter is intentionally loose.
 */
export function migrateProfileToDualBuild(p: Record<string, unknown>): void {
  if (!p || p.builds) return;

  const role: BuildRole = p.isSupporter ? 'support' : 'dps';
  const other = otherRole(role);

  p.builds = {
    [role]: {
      cores: (p.cores as CoreSet) ?? initBuildCores(role === 'support'),
      solveInfo: p.solveInfo ?? emptySolveInfo(),
      baselineOverride: p.baselineOverride,
    },
    [other]: {
      cores: initBuildCores(other === 'support'),
      solveInfo: emptySolveInfo(),
      baselineOverride: undefined,
    },
  };
  p.activeBuild = role;
  if (p.dualRole === undefined) p.dualRole = false;

  delete p.cores;
  delete p.isSupporter;
  delete p.solveInfo;
  delete p.baselineOverride;
}
