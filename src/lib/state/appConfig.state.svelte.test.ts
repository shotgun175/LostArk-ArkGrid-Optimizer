import { beforeEach, describe, expect, it } from 'vitest';

import {
  appConfig,
  applyOsThemePreference,
  migrateAppConfig,
  toggleDarkMode,
} from './appConfig.state.svelte';

describe('theme startup decision', () => {
  beforeEach(() => {
    appConfig.current.uiConfig.darkMode = false;
    appConfig.current.uiConfig.themeSetByUser = false;
  });

  it('follows the OS preference when the user never chose a theme', () => {
    applyOsThemePreference(true);
    expect(appConfig.current.uiConfig.darkMode).toBe(true);
  });

  it('keeps an explicit light choice even when the OS prefers dark', () => {
    appConfig.current.uiConfig.themeSetByUser = true;
    appConfig.current.uiConfig.darkMode = false;
    applyOsThemePreference(true);
    expect(appConfig.current.uiConfig.darkMode).toBe(false);
  });

  it('toggleDarkMode records that the user chose explicitly', () => {
    toggleDarkMode();
    expect(appConfig.current.uiConfig.themeSetByUser).toBe(true);
  });

  it('migrateAppConfig backfills themeSetByUser on old payloads', () => {
    const old = { uiConfig: { darkMode: true } } as never;
    migrateAppConfig(old);
    expect((old as { uiConfig: { themeSetByUser: boolean } }).uiConfig.themeSetByUser).toBe(false);
  });
});
