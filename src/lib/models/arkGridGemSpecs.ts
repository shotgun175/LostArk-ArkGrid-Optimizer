// Pure gem data: option types and per-gem specs. Kept free of Vite-only APIs
// (import.meta.glob lives in arkGridGems.ts) so node-side tooling — the
// support-table generator and the CV accuracy harness — can import the same
// canonical data and grade logic the app uses.
import { type ArkGridAttr, type LocalizationName } from '../constants/enums';
import type { ArkGridGem, ArkGridGemOption } from './arkGridGems';

export type ArkGridGemOptionType = {
  name: LocalizationName;
};
export const ArkGridGemOptionTypes = {
  AtkPower: {
    name: {
      en_us: 'Atk. Power',
    },
  },
  BossDamage: {
    name: {
      en_us: 'Boss Damage',
    },
  },
  AddDamage: {
    name: {
      en_us: 'Additional Damage',
    },
  },
  BrandPower: {
    name: {
      en_us: 'Brand Power',
    },
  },
  AllyAttackEnh: {
    name: {
      en_us: 'Ally Attack Enh.',
    },
  },
  AllyDamageEnh: {
    name: {
      en_us: 'Ally Damage Enh.',
    },
  },
} as const satisfies Record<string, ArkGridGemOptionType>;
export type ArkGridGemOptionName = keyof typeof ArkGridGemOptionTypes;
export const ArkGridGemOptionNames = Object.keys(ArkGridGemOptionTypes) as ArkGridGemOptionName[];

export type ArkGridGemSpec = {
  attr: ArkGridAttr;
  name: LocalizationName;
  req: number;
  availableOptions: ArkGridGemOptionName[];
};
export const ArkGridGemSpecs = {
  'Order Astrogem: Stability': {
    attr: 'Order',
    name: {
      en_us: 'Order Astrogem: Stability',
    },
    req: 8,
    availableOptions: ['AtkPower', 'AddDamage', 'BrandPower', 'AllyDamageEnh'],
  },
  'Order Astrogem: Solidity': {
    attr: 'Order',
    name: {
      en_us: 'Order Astrogem: Solidity',
    },
    req: 9,
    availableOptions: ['AtkPower', 'BossDamage', 'AllyDamageEnh', 'AllyAttackEnh'],
  },
  'Order Astrogem: Immutability': {
    attr: 'Order',
    name: {
      en_us: 'Order Astrogem: Immutability',
    },
    req: 10,
    availableOptions: ['AddDamage', 'BossDamage', 'BrandPower', 'AllyAttackEnh'],
  },
  'Chaos Astrogem: Corrosion': {
    attr: 'Chaos',
    name: {
      en_us: 'Chaos Astrogem: Corrosion',
    },
    req: 8,
    availableOptions: ['AtkPower', 'AddDamage', 'BrandPower', 'AllyDamageEnh'],
  },
  'Chaos Astrogem: Distortion': {
    attr: 'Chaos',
    name: {
      en_us: 'Chaos Astrogem: Distortion',
    },
    req: 9,
    availableOptions: ['AtkPower', 'BossDamage', 'AllyDamageEnh', 'AllyAttackEnh'],
  },
  'Chaos Astrogem: Destruction': {
    attr: 'Chaos',
    name: {
      en_us: 'Chaos Astrogem: Destruction',
    },
    req: 10,
    availableOptions: ['AddDamage', 'BossDamage', 'BrandPower', 'AllyAttackEnh'],
  },
} as const satisfies Record<string, ArkGridGemSpec>;
export type ArkGridGemName = keyof typeof ArkGridGemSpecs;

// Grade is derived purely from the gem's numbers + base req, so it lives here with the
// canonical specs (no Vite-only deps) and is re-exported from arkGridGems.ts for existing
// importers. The accuracy harness needs it node-side to grade recognized gems.
export function determineGemGrade(
  req: number,
  point: number,
  option1: ArkGridGemOption,
  option2: ArkGridGemOption,
  name?: ArkGridGemName
) {
  const basePoint = name ? ArkGridGemSpecs[name].req : 8;
  const totalPoint = basePoint - req + point + option1.value + option2.value;
  return totalPoint < 16 ? 'Legendary' : totalPoint < 19 ? 'Relic' : 'Ancient';
}
export function determineGemGradeByGem(gem: ArkGridGem) {
  const basePoint = gem.name ? ArkGridGemSpecs[gem.name].req : 8;
  const totalPoint = basePoint - gem.req + gem.point + gem.option1.value + gem.option2.value;
  return totalPoint < 16 ? 'Legendary' : totalPoint < 19 ? 'Relic' : 'Ancient';
}
