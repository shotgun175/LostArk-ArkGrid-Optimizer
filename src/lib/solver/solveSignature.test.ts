import { describe, expect, it } from 'vitest';

import type { ArkGridGem } from '../models/arkGridGems';
import { initBuildCores } from '../state/dualBuild';
import { solveInputSignature } from './solveSignature';

function gem(req: number, point: number): ArkGridGem {
  return {
    gemAttr: 'Order',
    req,
    point,
    option1: { optionType: 'AtkPower', value: 1 },
    option2: { optionType: 'AtkPower', value: 1 },
  };
}

const noGems = { orderGems: [] as ArkGridGem[], chaosGems: [] as ArkGridGem[] };

describe('solveInputSignature', () => {
  it('is stable for identical inputs', () => {
    const cores = initBuildCores(false);
    expect(solveInputSignature(cores, noGems)).toBe(solveInputSignature(cores, noGems));
  });

  it('changes when a core grade changes', () => {
    const a = initBuildCores(false);
    const b = initBuildCores(false);
    b.Order.Sun!.grade = 'Ancient';
    expect(solveInputSignature(a, noGems)).not.toBe(solveInputSignature(b, noGems));
  });

  it('changes when a gem is added or edited', () => {
    const cores = initBuildCores(false);
    const base = solveInputSignature(cores, noGems);
    const added = solveInputSignature(cores, { orderGems: [gem(5, 5)], chaosGems: [] });
    expect(added).not.toBe(base);
    const edited = solveInputSignature(cores, { orderGems: [gem(5, 4)], chaosGems: [] });
    expect(edited).not.toBe(added);
  });

  it('is order-independent across the gem pool', () => {
    const cores = initBuildCores(false);
    const g1 = gem(5, 5);
    const g2 = gem(8, 2);
    const s1 = solveInputSignature(cores, { orderGems: [g1, g2], chaosGems: [] });
    const s2 = solveInputSignature(cores, { orderGems: [g2, g1], chaosGems: [] });
    expect(s1).toBe(s2);
  });

  it('distinguishes DPS vs Support cores (different coefficient tables)', () => {
    expect(solveInputSignature(initBuildCores(false), noGems)).not.toBe(
      solveInputSignature(initBuildCores(true), noGems)
    );
  });
});
