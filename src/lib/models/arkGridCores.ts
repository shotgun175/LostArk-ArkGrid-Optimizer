import { type ArkGridAttr, type LocalizationName, type LostArkGrade } from '../constants/enums';
import type { WeaponInfo } from '../state/profile.state.svelte';

export type ArkGridCoreTypeType = {
  name: LocalizationName;
};
export const ArkGridCoreTypeTypes = {
  Sun: {
    name: {
      en_us: 'Sun',
    },
  },
  Moon: {
    name: {
      en_us: 'Moon',
    },
  },
  Star: {
    name: {
      en_us: 'Star',
    },
  },
} as const satisfies Record<string, ArkGridCoreTypeType>;
export type ArkGridCoreType = keyof typeof ArkGridCoreTypeTypes;
export const ArkGridCoreTypes = Object.keys(ArkGridCoreTypeTypes) as ArkGridCoreType[];

export type ArkGridCoreCoeffs = {
  p10: number;
  p14: number;
  p17: number;
  p18: number;
  p19: number;
  p20: number;
};

export interface ArkGridCore {
  attr: ArkGridAttr;
  type: ArkGridCoreType;
  grade: LostArkGrade;
  coeffs: ArkGridCoreCoeffs;
  tier: number;
  goalPoint: number;
  /*
  DPS
  0: Brilliant, Burning
  1: Stable, Quick, Absorbing, Crushing
  2: Others

  Support
  0: Conviction, Brand, Weapon
  1: Flowing Mana, Indomitable, Steel Mark, Critical Mark
  2: Others
  */
}

export function resetCoreCoeff(
  core: ArkGridCore,
  isSupporter: boolean,
  weapon: WeaponInfo | undefined
) {
  core.coeffs = getDefaultCoreCoeff(core, isSupporter, weapon);
  cutoffCoeff(core);
  adjustCoeff(core, isSupporter);
  // If weapon info is provided, do not apply the Relic - Ancient additional coefficient
}
function cutoffCoeff(core: ArkGridCore) {
  // Adjust coefficients for Epic and Legendary grade cores
  if (core.grade === 'Epic') {
    // Epic grade: only options up to 10P exist
    core.coeffs.p14 = core.coeffs.p10;
    core.coeffs.p17 = core.coeffs.p10;
    core.coeffs.p18 = core.coeffs.p10;
    core.coeffs.p19 = core.coeffs.p10;
    core.coeffs.p20 = core.coeffs.p10;
  } else if (core.grade === 'Legendary') {
    // Legendary grade: only options up to 14P exist
    core.coeffs.p17 = core.coeffs.p14;
    core.coeffs.p18 = core.coeffs.p14;
    core.coeffs.p19 = core.coeffs.p14;
    core.coeffs.p20 = core.coeffs.p14;
  }
}
function adjustCoeff(core: ArkGridCore, isSupporter: boolean) {
  // Apply the Ancient core additional coefficient

  // Skip cases already handled in getDefaultCoreCoeff
  if (
    !isSupporter &&
    core.grade == 'Ancient' &&
    core.attr == 'Chaos' &&
    core.type == 'Star' &&
    core.tier == 1
  )
    // DPS - for the Ancient Chaos Star (weapon) core, the Ancient bonus is not applied
    return;

  if (
    isSupporter &&
    core.grade == 'Ancient' &&
    core.attr == 'Chaos' &&
    core.type == 'Star' &&
    core.tier == 0
  )
    // Support - for the Ancient Chaos Star (weapon) core, the Ancient bonus is not applied
    return;

  if (core.grade === 'Ancient' && core.coeffs.p17) {
    /*
      Ancient grade 17-20P option additional coefficient
      DPS:  +100
      Support
        - Order Sun, Moon: 120
        - Order Star: 90
        - Chaos Sun, Moon
          - tier 1: 180
          - tier 2: 120
    */
    let additionalCoeff = 100; // DPS 100
    if (isSupporter) {
      switch (core.attr) {
        case 'Order':
          switch (core.type) {
            case 'Sun':
            case 'Moon':
              additionalCoeff = 120; // Support Order Sun/Moon +120
              break;
            case 'Star':
              additionalCoeff = 90; // Support Order Star +90
              break;
            default:
              throw Error('additionalCoeff is not set');
          }
          break;
        case 'Chaos':
          switch (core.type) {
            case 'Sun': // Support Chaos tier 1 Sun/Moon +180
            case 'Moon': // Support Chaos tier 2 Sun/Moon +120
              additionalCoeff = core.tier == 0 ? 180 : 120;
              break;
            case 'Star':
              additionalCoeff = 100; // Weapon +100, is this right?
              break;
            default:
              throw Error('additionalCoeff is not set');
          }
      }
    }
    core.coeffs.p17 += additionalCoeff;
    core.coeffs.p18 += additionalCoeff;
    core.coeffs.p19 += additionalCoeff;
    core.coeffs.p20 += additionalCoeff;
  }
}

function getWeaponCoeff(base: WeaponInfo, income: WeaponInfo) {
  // Combat-power coefficient given the current weapon power and the additional weapon power
  const v1 = base.fixed * ((base.percent + 100) / 100);
  const v2 = (base.fixed + income.fixed) * ((base.percent + income.percent + 100) / 100);
  const diff = Math.sqrt(v2 / v1);
  return Math.floor((diff - 1) * 10000);
}

export function getDefaultCoreCoeff(
  core: ArkGridCore,
  isSupporter = false,
  weapon: WeaponInfo | undefined
): ArkGridCoreCoeffs {
  // If no weapon is provided, assume Serka +25, Enlightenment lv30, and two high-tier earrings
  if (!weapon) weapon = { fixed: 241367, percent: 9 };

  const attr = core.attr,
    type = core.type,
    tier = core.tier;

  if (!isSupporter) {
    // DPS
    if (attr == 'Order') {
      if (type == 'Sun' || type == 'Moon') {
        // Order Sun, Moon
        return {
          p10: 150,
          p14: 400,
          p17: 750,
          p18: 767,
          p19: 783,
          p20: 800,
        };
      } else if (type == 'Star') {
        // Order Star
        return {
          p10: 100,
          p14: 250,
          p17: 450,
          p18: 467,
          p19: 483,
          p20: 500,
        };
      }
    } else if (attr == 'Chaos') {
      if (type == 'Sun' || type == 'Moon') {
        // Chaos Sun, Moon
        if (tier == 0) {
          // Brilliant Attack, Burning Strike
          return {
            p10: 50,
            p14: 100,
            p17: 250,
            p18: 267,
            p19: 283,
            p20: 300,
          };
        } else if (tier == 1) {
          // Stable Attack, Quick Attack, Absorbing Strike, Crushing Strike
          return {
            p10: 0,
            p14: 50,
            p17: 150,
            p18: 167,
            p19: 183,
            p20: 200,
          };
        }
      } else if (type == 'Star') {
        // Chaos Star
        if (tier == 0) {
          // Attack
          return {
            p10: 50,
            p14: 100,
            p17: 250,
            p18: 267,
            p19: 283,
            p20: 300,
          };
        }
        if (tier == 1) {
          // Weapon
          return {
            p10: getWeaponCoeff(weapon, { fixed: 1300, percent: 0 }), // Weapon power +1300
            p14: getWeaponCoeff(weapon, { fixed: 1300, percent: 0.75 }), // Weapon power +0.75%
            p17: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: core.grade === 'Ancient' ? 3 : 2.25,
            }), // Weapon power +1.5/2.25%, weapon power +2600/3900
            p18: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: (core.grade === 'Ancient' ? 3 : 2.25) + 0.23,
            }), // Weapon power +0.23%
            p19: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: (core.grade === 'Ancient' ? 3 : 2.25) + 0.23 * 2,
            }), // Weapon power +0.23%
            p20: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: (core.grade === 'Ancient' ? 3 : 2.25) + 0.23 * 3,
            }), // Weapon power +0.23%
          };
        }
      }
    }
  } else {
    // Support
    if (attr === 'Order') {
      if (type == 'Sun' || type == 'Moon') {
        // Order Sun, Moon
        return {
          p10: 120,
          p14: 120,
          p17: 780,
          p18: 798,
          p19: 810,
          p20: 822,
        };
      } else if (type == 'Star') {
        // Order Star
        return {
          p10: 0,
          p14: 60,
          p17: 210,
          p18: 220,
          p19: 230,
          p20: 240,
        };
      }
    } else if (attr === 'Chaos') {
      if (type == 'Sun' || type == 'Moon') {
        // Chaos Sun, Chaos Moon
        if (tier == 0) {
          // Chaos Sun, Moon
          // tier 1: Conviction Enhancement, Mark of Brand
          return {
            p10: 60,
            p14: 120,
            p17: 360,
            p18: 378,
            p19: 396,
            p20: 420,
          };
        } else if (tier == 1) {
          // tier 2
          if (type == 'Sun') {
            // Sun - Flowing Mana, Indomitable Enhancement
            return {
              p10: 0,
              p14: 48,
              p17: 132,
              p18: 148,
              p19: 164,
              p20: 180,
            };
          } else if (type == 'Moon') {
            // Moon - Steel Mark, Critical Mark
            return {
              p10: 60,
              p14: 60,
              p17: 180,
              p18: 180,
              p19: 180,
              p20: 180,
            };
          }
        }
      } else if (type == 'Star') {
        // Chaos Star
        if (tier == 0) {
          // Weapon TODO weapon power
          return {
            p10: getWeaponCoeff(weapon, { fixed: 1300, percent: 0 }), // Weapon power +1300
            p14: getWeaponCoeff(weapon, { fixed: 1300, percent: 0.75 }), // Weapon power +0.75%
            p17: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: core.grade === 'Ancient' ? 3 : 2.25,
            }), // Weapon power +1.5/2.25%, weapon power +2600/3900
            p18: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: (core.grade === 'Ancient' ? 3 : 2.25) + 0.23,
            }), // Weapon power +0.23%
            p19: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: (core.grade === 'Ancient' ? 3 : 2.25) + 0.23 * 2,
            }), // Weapon power +0.23%
            p20: getWeaponCoeff(weapon, {
              fixed: core.grade === 'Ancient' ? 5200 : 3900,
              percent: (core.grade === 'Ancient' ? 3 : 2.25) + 0.23 * 3,
            }), // Weapon power +0.23%
          };
        } // TODO Life
      }
    }
  }
  return {
    p10: 0,
    p14: 0,
    p17: 0,
    p18: 0,
    p19: 0,
    p20: 0,
  };
}

export function getDefaultCoreEnergy(core: ArkGridCore | undefined | null): number {
  if (!core) return 0;
  switch (core.grade) {
    case 'Epic':
      return 9;
    case 'Legendary':
      return 12;
    case 'Relic':
      return 15;
    case 'Ancient':
      return 17;
    default:
      return 0;
  }
}
export function getDefaultCoreGoalPoint(core: ArkGridCore | undefined | null): number {
  if (!core) return 0;
  switch (core.grade) {
    case 'Epic':
      return 10;
    case 'Legendary':
      return 14;
    case 'Relic':
      return 17;
    case 'Ancient':
      return 17;
    default:
      return 0;
  }
}
export function getMaxCorePoint(core: ArkGridCore | undefined | null): number {
  if (!core) return 0;
  switch (core.grade) {
    case 'Epic':
      return 10;
    case 'Legendary':
      return 14;
    case 'Relic':
      return 20;
    case 'Ancient':
      return 20;
    default:
      return 0;
  }
}

export function createCore(
  attr: ArkGridAttr,
  type: ArkGridCoreType,
  grade: LostArkGrade,
  isSupporter: boolean,
  weapon: WeaponInfo | undefined,
  tier?: number
): ArkGridCore {
  const core: ArkGridCore = {
    attr,
    type,
    grade,
    coeffs: {
      p10: 0,
      p14: 0,
      p17: 0,
      p18: 0,
      p19: 0,
      p20: 0,
    },
    tier: tier ? tier : 0,
    goalPoint: 0,
  };
  resetCoreCoeff(core, isSupporter, weapon);
  return core;
}

export const coreImages = import.meta.glob<string>('/src/assets/cores/*.png', {
  eager: true,
  import: 'default',
});

export function getCoreImage(attr: ArkGridAttr, ctype: ArkGridCoreType) {
  const attrMap = {
    ['Order']: 'order',
    ['Chaos']: 'chaos',
  };
  const typeMap = {
    Sun: 'sun',
    Moon: 'moon',
    Star: 'star',
  };
  const key = `/src/assets/cores/${attrMap[attr]}_${typeMap[ctype]}.png`;
  return coreImages[key];
}
