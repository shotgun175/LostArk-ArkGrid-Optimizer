export class Core {
  constructor(
    public energy: number,
    public point: number,
    public coeff: number[]
  ) {}
}

export class Gem {
  constructor(
    public index: bigint,
    public req: number,
    public point: number,
    public att: number,
    public skill: number,
    public boss: number
  ) {}
}

export function buildScoreMap(coeff: number, maxLevel: number) {
  const result: [number, number][] = [];
  for (let v = 0; v <= maxLevel; v++) {
    let minScore = 100;
    let maxScore = 0;

    // #6: Precompute the upper bound to reduce loop overhead
    const limit = maxLevel - v;
    for (let base = 0; base <= limit; base++) {
      const coeffAfter = Math.floor(((base + v) * coeff) / 120) + 10000;
      const coeffBefore = Math.floor((base * coeff) / 120) + 10000;

      const upgradeValue = coeffAfter / coeffBefore;
      if (upgradeValue > maxScore) {
        maxScore = upgradeValue;
      }
      if (upgradeValue < minScore) {
        minScore = upgradeValue;
      }
    }
    result[v] = [minScore, maxScore];
  }
  return result;
}

export class GemSet {
  // State of a core with gems equipped
  att: number;
  skill: number;
  boss: number;
  point: number;
  bitmask: bigint;
  coreCoeff: number;
  core: Core;
  maxScore: number;
  minScore: number;
  constructor(gems: Gem[], core: Core) {
    this.att = 0;
    this.skill = 0;
    this.boss = 0;
    this.point = 0;

    this.bitmask = 0n;
    for (const gem of gems) {
      this.bitmask |= 1n << gem.index;
      this.att += gem.att;
      this.skill += gem.skill;
      this.boss += gem.boss;
      this.point += gem.point;
    }
    this.coreCoeff = core.coeff[this.point];
    if (this.coreCoeff == undefined) {
      throw Error('Core coeffient is incorrect.');
    }
    this.core = core;
    this.minScore = -1;
    this.maxScore = -1;
  }
  setScoreRange(scoreMaps: [number, number][][]) {
    // Knowing the max AtkPower, AddDamage, and BossDamage obtainable across all systems lets us
    // bound the range of combat power achievable with this GemSet.
    const coreScore = (this.coreCoeff + 10000) / 10000;

    // Maximum combat-power increase
    this.maxScore =
      coreScore *
      scoreMaps[0][this.att][1] *
      scoreMaps[1][this.skill][1] *
      scoreMaps[2][this.boss][1];

    // Minimum combat-power increase
    this.minScore =
      coreScore *
      scoreMaps[0][this.att][0] *
      scoreMaps[1][this.skill][0] *
      scoreMaps[2][this.boss][0];

    if (this.maxScore < this.minScore) {
      console.log(this);
      throw Error(`${this.maxScore} is less than ${this.minScore}.`);
    }
  }
}
export class GemSetPack {
  // The 3 GemSets assigned to the 3 cores of either Order or Chaos
  att: number;
  skill: number;
  boss: number;
  coreScore: number;
  minScore: number;
  maxScore: number;
  constructor(
    public gs1: GemSet | null,
    public gs2: GemSet | null,
    public gs3: GemSet | null,
    scoreMaps: [number, number][][],
    public stability: number
  ) {
    this.att = (gs1?.att ?? 0) + (gs2?.att ?? 0) + (gs3?.att ?? 0);
    this.skill = (gs1?.skill ?? 0) + (gs2?.skill ?? 0) + (gs3?.skill ?? 0);
    this.boss = (gs1?.boss ?? 0) + (gs2?.boss ?? 0) + (gs3?.boss ?? 0);

    this.coreScore =
      ((((((gs1?.coreCoeff ?? 0) + 10000) / 10000) * ((gs2?.coreCoeff ?? 0) + 10000)) / 10000) *
        ((gs3?.coreCoeff ?? 0) + 10000)) /
      10000;

    // Maximum combat-power increase
    this.maxScore =
      this.coreScore *
      scoreMaps[0][this.att][1] *
      scoreMaps[1][this.skill][1] *
      scoreMaps[2][this.boss][1];

    // Minimum combat-power increase
    this.minScore =
      this.coreScore *
      scoreMaps[0][this.att][0] *
      scoreMaps[1][this.skill][0] *
      scoreMaps[2][this.boss][0];

    // if (this.maxScore < this.minScore) {
    //   console.log(this);
    //   throw Error(`${this.maxScore} is less than ${this.minScore}.`);
    // }
  }
}

export const gemOptionLevelCoeffs = [400, 700, 1000]; // AtkPower, AddDamage, BossDamage
export const gemOptionLevelCoeffsSupporter = [600, 1050, 1500]; // AllyDamageEnh, BrandPower, AllyAttackEnh

export class GemSetPackTuple {
  // A pair of GemSetPacks, i.e. one completed Ark Grid
  att: number;
  skill: number;
  boss: number;
  score: number;
  stability: number;
  constructor(
    public gsp1: GemSetPack | null,
    public gsp2: GemSetPack | null,
    public isSupporter: boolean
  ) {
    this.att = (gsp1?.att ?? 0) + (gsp2?.att ?? 0);
    this.skill = (gsp1?.skill ?? 0) + (gsp2?.skill ?? 0);
    this.boss = (gsp1?.boss ?? 0) + (gsp2?.boss ?? 0);
    const coeffs = isSupporter ? gemOptionLevelCoeffsSupporter : gemOptionLevelCoeffs;
    this.score =
      ((((((gsp1?.coreScore ?? 1) *
        (gsp2?.coreScore ?? 1) *
        (Math.floor((this.att * coeffs[0]) / 120) + 10000)) /
        10000) *
        (Math.floor((this.skill * coeffs[1]) / 120) + 10000)) /
        10000) *
        (Math.floor((this.boss * coeffs[2]) / 120) + 10000)) /
      10000;
    this.stability = (gsp1?.stability ?? 0) + (gsp2?.stability ?? 0);
  }
}
