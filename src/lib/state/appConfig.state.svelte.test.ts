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

  it('migrateAppConfig treats an existing darkMode value as a user choice', () => {
    // Old payloads carrying a theme keep it: backfilling false would let the
    // OS preference clobber every existing install's saved theme once.
    const withTheme = { uiConfig: { darkMode: true } } as never;
    migrateAppConfig(withTheme);
    expect((withTheme as { uiConfig: { themeSetByUser: boolean } }).uiConfig.themeSetByUser).toBe(
      true
    );

    const withoutTheme = { uiConfig: {} } as never;
    migrateAppConfig(withoutTheme);
    const ui = (withoutTheme as { uiConfig: { themeSetByUser: boolean; darkMode: boolean } })
      .uiConfig;
    expect(ui.themeSetByUser).toBe(false);
    expect(ui.darkMode).toBe(false);
  });
});
