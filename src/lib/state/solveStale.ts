import { solveInputSignature } from '../solver/solveSignature';
import { type BuildRole, otherRole } from './dualBuild';
import type { CharacterProfile } from './profile.state.svelte';

/**
 * "Out of sync": a stored solve no longer matches the live cores + gems, so its verdicts (and any
 * withheld removals) are stale until the user re-optimizes. For a dual-role profile BOTH builds
 * count, since Optimize re-solves both. A solve with no signature (pre-feature / never run) never
 * reads as stale. Shared by GemTriagePanel and the nav rail's Optimize button so the two can't
 * drift. Runtime imports stay off profile.state.svelte (types only) to avoid its module cycle
 * with appConfig.state.svelte.
 */
export function isSolveStale(profile: CharacterProfile): boolean {
  const buildStaleFor = (r: BuildRole) => {
    const b = profile.builds[r];
    const s = solveInputSignature(b.cores, profile.gems);
    const after = b.solveInfo.after;
    const endgame = b.solveInfo.endgame;
    return (
      (!!after?.inputSig && after.inputSig !== s) || (!!endgame?.inputSig && endgame.inputSig !== s)
    );
  };
  if (buildStaleFor(profile.activeBuild)) return true;
  return profile.dualRole && buildStaleFor(otherRole(profile.activeBuild));
}

/**
 * First-run state: gems exist but the active build has never been solved, so there is no evidence
 * yet and Optimize is step 1. Shared by GemTriagePanel's nudge and the nav rail's Optimize button.
 */
export function isSolveNeverRun(profile: CharacterProfile): boolean {
  const b = profile.builds[profile.activeBuild];
  return (
    profile.gems.orderGems.length + profile.gems.chaosGems.length > 0 &&
    !b.solveInfo.after &&
    !b.solveInfo.endgame
  );
}
