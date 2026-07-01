import { describe, expect, it } from 'vitest';

// appConfig must be imported before profile.state to resolve the circular
// dep initialization order (appConfig calls initNewProfile at module level).
import '../state/appConfig.state.svelte';
import { initNewProfile } from '../state/profile.state.svelte';
import { buildEndgameSolverCores } from './solverController';

describe('buildEndgameSolverCores', () => {
  it('makes every core Ancient (energy 17, point target 0), including filled-in empty slots', () => {
    const profile = initNewProfile('endgame-cores-test');
    // Null out one slot to prove empty slots are filled with an Ancient core, not left at energy 0.
    profile.builds.dps.cores.Order.Sun = null;

    const { orderCores, chaosCores } = buildEndgameSolverCores(profile, 'dps');

    expect(orderCores).toHaveLength(3);
    expect(chaosCores).toHaveLength(3);
    for (const core of [...orderCores, ...chaosCores]) {
      expect(core.energy).toBe(17); // Ancient energy — real capacity, incl. the nulled slot
      expect(core.point).toBe(0); // permissive: maximize CP, never a forced threshold
      expect(core.coeff.some((c) => c > 0)).toBe(true); // real Ancient coefficients, not a zeroed stub
    }
  });
});
