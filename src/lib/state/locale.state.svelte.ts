import { persistedState } from 'svelte-persisted-state';

import type { AppLocale } from '../constants/enums';

// English-only UI. Coerce any previously-persisted value (e.g. an old 'ko_kr') to 'en_us'.
export const appLocale = persistedState<AppLocale>('appLocale', 'en_us', {
  beforeRead: () => 'en_us',
});

export function setLocale(locale: AppLocale) {
  appLocale.current = locale;
}
