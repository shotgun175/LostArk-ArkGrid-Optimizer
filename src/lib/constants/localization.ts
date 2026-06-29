import { type ArkGridCoreType, ArkGridCoreTypeTypes } from '../models/arkGridCores';
import { type AppLocale, type ArkGridAttr, ArkGridAttrTypes, type LocalizationName } from './enums';

export const L_DEFAULT_PROFILE_NAME: LocalizationName = {
  en_us: 'Default',
};
export const LConfirm: LocalizationName = {
  en_us: 'Confirm',
};
export const LCancel: LocalizationName = {
  en_us: 'Cancel',
};
export const LOrder: LocalizationName = {
  en_us: 'Order',
};
export const LChaos: LocalizationName = {
  en_us: 'Chaos',
};
export const LDealer: LocalizationName = {
  en_us: 'DPS',
};
export const LSupporter: LocalizationName = {
  en_us: 'Support',
};

export function formatCoreType(
  attr: ArkGridAttr,
  ctype: ArkGridCoreType,
  locale: AppLocale,
  noSuffix?: boolean
) {
  // e.g. "Order Star" / "Order Star Core"
  const attrName = ArkGridAttrTypes[attr].name[locale];
  const typeName = ArkGridCoreTypeTypes[ctype].name[locale];
  return noSuffix ? `${attrName} ${typeName}` : `${attrName} ${typeName} Core`;
}
