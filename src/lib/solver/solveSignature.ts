import { ArkGridAttrs } from '../constants/enums';
import { ArkGridCoreTypes } from '../models/arkGridCores';
import { type ArkGridGem, gemFingerprint } from '../models/arkGridGems';
import type { CoreSet } from '../state/dualBuild';

/**
 * A stable signature of everything that affects a build's solve: its cores (grade, tier, goalPoint,
 * coefficients) and the shared gem pool (each gem's fingerprint, order-independent). Stored on the
 * solve result; when the live inputs no longer match, the result is stale and the user should
 * re-optimize. Because the gem pool is shared, editing gems changes both builds' signatures, while
 * editing one build's cores changes only that build's.
 */
export function solveInputSignature(
  cores: CoreSet,
  gems: { orderGems: ArkGridGem[]; chaosGems: ArkGridGem[] }
): string {
  const coreSig: string[] = [];
  for (const attr of Object.values(ArkGridAttrs)) {
    for (const ctype of Object.values(ArkGridCoreTypes)) {
      const c = cores[attr][ctype];
      coreSig.push(
        c
          ? `${attr}.${ctype}:${c.grade}/${c.tier}/${c.goalPoint}/` +
              `${c.coeffs.p10},${c.coeffs.p14},${c.coeffs.p17},${c.coeffs.p18},${c.coeffs.p19},${c.coeffs.p20}`
          : `${attr}.${ctype}:-`
      );
    }
  }
  // Order-independent: reordering the pool does not invalidate a solve, but adding/removing/editing
  // a gem does.
  const gemSig = [
    ...gems.orderGems.map((g) => `O|${gemFingerprint(g)}`),
    ...gems.chaosGems.map((g) => `C|${gemFingerprint(g)}`),
  ].sort();
  return JSON.stringify({ cores: coreSig, gems: gemSig });
}
