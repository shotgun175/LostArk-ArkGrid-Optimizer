import { type ArkGridAttr, type LocalizationName, type LostArkGrade } from '../constants/enums';

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

export type ArkGridGemOption = {
  optionType: ArkGridGemOptionName;
  value: number;
};

export interface ArkGridGem {
  name?: ArkGridGemName;
  grade?: LostArkGrade;
  gemAttr: ArkGridAttr;
  req: number;
  point: number;
  option1: ArkGridGemOption;
  option2: ArkGridGemOption;
  assign?: number;
  isNew?: boolean;
  replaces?: ArkGridGem;
  swapIndex?: number;
}

export function gemFingerprint(gem: ArkGridGem): string {
  return `${gem.req}|${gem.point}|${gem.option1.optionType}|${gem.option1.value}|${gem.option2.optionType}|${gem.option2.value}`;
}

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

export function isSameArkGridGem(a: ArkGridGem | undefined, b: ArkGridGem | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return (
    (a.name !== undefined && b.name !== undefined ? a.name === b.name : true) &&
    a.gemAttr === b.gemAttr &&
    a.req === b.req &&
    a.point === b.point &&
    isSameOption(a.option1, b.option1) &&
    isSameOption(a.option2, b.option2)
  );
}

function isSameOption(a: ArkGridGemOption, b: ArkGridGemOption): boolean {
  return a.optionType === b.optionType && a.value === b.value;
}

const MapGemNameImage: Record<ArkGridGemName, string> = {
  'Order Astrogem: Stability': 'order_0',
  'Order Astrogem: Solidity': 'order_1',
  'Order Astrogem: Immutability': 'order_2',
  'Chaos Astrogem: Corrosion': 'chaos_0',
  'Chaos Astrogem: Distortion': 'chaos_1',
  'Chaos Astrogem: Destruction': 'chaos_2',
};
const gemImages = import.meta.glob<string>('/src/assets/gems/*.png', {
  eager: true,
  import: 'default',
});

export function getGemImage(gemAttr?: ArkGridAttr, gemName?: ArkGridGemName): string {
  if (!gemName) {
    return gemAttr == 'Order'
      ? gemImages['/src/assets/gems/order_0.png']
      : gemImages['/src/assets/gems/chaos_0.png'];
  }
  return gemImages[`/src/assets/gems/${MapGemNameImage[gemName] ?? 'order_0'}.png`];
}
