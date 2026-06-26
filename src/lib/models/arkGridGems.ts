import { type ArkGridAttr, type LostArkGrade } from '../constants/enums';
// Pure gem data (option types, specs) lives in arkGridGemSpecs.ts so the
// support-table generator can import it without Vite. Re-exported here so
// existing importers keep working.
import { type ArkGridGemName, type ArkGridGemOptionName } from './arkGridGemSpecs';

export {
  ArkGridGemOptionNames,
  ArkGridGemOptionTypes,
  ArkGridGemSpecs,
  // Grade + gem-equality logic live in the Vite-free specs module so node-side tooling can
  // import them; re-exported here so existing `from '../models/arkGridGems'` importers keep working.
  determineGemGrade,
  determineGemGradeByGem,
  isSameArkGridGem,
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
  /** Retired (write-only; equipped state derives from solveAnswer.assignedGems).
   *  Kept only because old persisted snapshots may still carry the key. */
  assign?: number;
  isNew?: boolean;
  replaces?: ArkGridGem;
  swapIndex?: number;
}

export function gemFingerprint(gem: ArkGridGem): string {
  return `${gem.req}|${gem.point}|${gem.option1.optionType}|${gem.option1.value}|${gem.option2.optionType}|${gem.option2.value}`;
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
