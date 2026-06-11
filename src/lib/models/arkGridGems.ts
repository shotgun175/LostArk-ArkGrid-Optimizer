import { type ArkGridAttr, type LostArkGrade } from '../constants/enums';
// Pure gem data (option types, specs) lives in arkGridGemSpecs.ts so the
// support-table generator can import it without Vite. Re-exported here so
// existing importers keep working.
import {
  type ArkGridGemName,
  type ArkGridGemOptionName,
  ArkGridGemSpecs,
} from './arkGridGemSpecs';

export {
  ArkGridGemNames,
  ArkGridGemOptionNames,
  ArkGridGemOptionTypes,
  ArkGridGemSpecs,
} from './arkGridGemSpecs';
export type {
  ArkGridGemName,
  ArkGridGemOptionName,
  ArkGridGemOptionType,
  ArkGridGemSpec,
} from './arkGridGemSpecs';

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
