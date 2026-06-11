// Pure gem data: option types and per-gem specs. Kept free of Vite-only APIs
// (import.meta.glob lives in arkGridGems.ts) so node-side tooling — the
// support-table generator — can import the same canonical data the app uses.
import { type ArkGridAttr, type LocalizationName } from '../constants/enums';

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
export const ArkGridGemNames = Object.keys(ArkGridGemSpecs) as ArkGridGemName[];
