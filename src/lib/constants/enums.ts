export const ArkGridAttrTypes = {
  Order: {
    name: {
      en_us: 'Order',
    },
  },
  Chaos: {
    name: {
      en_us: 'Chaos',
    },
  },
} as const;
export type ArkGridAttr = keyof typeof ArkGridAttrTypes;
export const ArkGridAttrs = Object.keys(ArkGridAttrTypes) as ArkGridAttr[];

export const LostArkGradeTypes = {
  Epic: {
    name: {
      en_us: 'Epic',
    },
  },
  Legendary: {
    name: {
      en_us: 'Legendary',
    },
  },
  Relic: {
    name: {
      en_us: 'Relic',
    },
  },
  Ancient: {
    name: {
      en_us: 'Ancient',
    },
  },
} as const;
export type LostArkGrade = keyof typeof LostArkGradeTypes;
export const LostArkGrades = Object.keys(LostArkGradeTypes) as LostArkGrade[];

export const L_DEFAULT_PROFILE_NAME: LocalizationName = {
  en_us: 'Default',
};
export const DEFAULT_PROFILE_NAME = 'Default';

export type ScrollCommand = 'top' | 'bottom' | null;

// English-only UI. (GemRecognitionLocale below is separate — it covers which game
// CLIENT language the CV can read, and still supports ko/en/ru game clients.)
export type AppLocale = 'en_us';

export type GemRecognitionLocale = 'ko_kr' | 'en_us' | 'ru_ru';
export const supportedGemRecognitionLocales: GemRecognitionLocale[] = ['ko_kr', 'en_us', 'ru_ru'];

// English-only display strings. (Kept as a record so the existing `L[locale]` access
// pattern still works with the single `en_us` locale.)
export type LocalizationName = Record<AppLocale, string>;
