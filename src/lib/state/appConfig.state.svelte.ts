import { persistedState } from 'svelte-persisted-state';

import { DEFAULT_PROFILE_NAME } from '../constants/enums';
import { type CharacterProfile, initNewProfile, migrateProfile } from './profile.state.svelte';

interface UIConfig {
  showCoreCoeff: boolean;
  debugMode: boolean;
  darkMode: boolean;
  /** True once the user has explicitly toggled the theme; from then on the
   *  persisted darkMode wins over the OS prefers-color-scheme at startup. */
  themeSetByUser: boolean;
  deferredScreenSharingInit: boolean;
  newGemAddStyle: boolean;
}
const defaultUIConfig: UIConfig = {
  showCoreCoeff: false,
  debugMode: false,
  darkMode: false,
  themeSetByUser: false,
  deferredScreenSharingInit: false,
  newGemAddStyle: false,
};

// Per-section collapse markers (true = expanded). Deliberately NOT part of the persisted appConfig:
// persisting them meant a collapse wrote to localStorage, and svelte-persisted-state's cross-tab
// `storage` sync re-applied the "always start expanded" reset on the receiving tab and echoed it
// back — so with two tabs open a collapsed section snapped straight back open. Plain in-memory
// $state keeps collapse per-tab, never written to storage, and expanded again on every page load.
interface SectionVisibility {
  showGemRecognitionPanel: boolean;
  showGemTriage: boolean;
  showCuttingPlan: boolean;
  showOptimization: boolean;
}
export const sectionUI = $state<SectionVisibility>({
  showGemRecognitionPanel: true,
  showGemTriage: true,
  showCuttingPlan: true,
  showOptimization: true,
});
export function toggleSection(name: keyof SectionVisibility) {
  sectionUI[name] = !sectionUI[name];
}
export function setSection(name: keyof SectionVisibility, value: boolean) {
  sectionUI[name] = value;
}

interface AppConfig {
  characterProfiles: CharacterProfile[];
  uiConfig: UIConfig;
}

// serializer object for svelte-persisted-state
export const bigIntSerializer = {
  // For bigInt, serialize as a string with an 'n' suffix appended
  stringify: (value: any) => {
    return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v));
  },

  // If it's a string representing an integer ending in 'n', convert it back to BigInt
  parse: (text: string) => {
    return JSON.parse(text, (_, v) => {
      if (typeof v === 'string' && /^\d+n$/.test(v)) {
        return BigInt(v.slice(0, -1));
      }
      return v;
    });
  },
};
export function migrateAppConfig(appConfig: Partial<AppConfig>) {
  // themeSetByUser (added with the OS-preference fix; old payloads predate it).
  // Payloads that already carry a darkMode value are treated as an explicit
  // user choice: backfilling false instead would let the OS preference clobber
  // every existing install's saved theme on its next load. Must run before the
  // darkMode backfill below so "already carried" is observable.
  if (appConfig.uiConfig && appConfig.uiConfig.themeSetByUser === undefined) {
    appConfig.uiConfig.themeSetByUser = appConfig.uiConfig.darkMode !== undefined;
  }
  // Add uiConfig.darkMode
  if (appConfig.uiConfig && appConfig.uiConfig.darkMode === undefined) {
    appConfig.uiConfig.darkMode = false;
  }
  // Remove appLocale
  if ('appLocale' in appConfig) {
    delete appConfig.appLocale;
  }
  // deferredScreenSharingInit
  if (appConfig.uiConfig && appConfig.uiConfig.deferredScreenSharingInit === undefined) {
    appConfig.uiConfig.deferredScreenSharingInit = false;
  }
  // newGemAddStyle
  if (appConfig.uiConfig && appConfig.uiConfig.newGemAddStyle === undefined) {
    appConfig.uiConfig.newGemAddStyle = false;
  }
  // Section collapse markers moved out of the persisted config into the in-memory `sectionUI`
  // $state above. Drop the now-unused keys so they don't linger in old localStorage payloads.
  if (appConfig.uiConfig) {
    const ui = appConfig.uiConfig as unknown as Record<string, unknown>;
    delete ui.showGemRecognitionPanel;
    delete ui.showGemTriage;
    delete ui.showCuttingPlan;
    delete ui.showOptimization;
  }
}

export const appConfig = persistedState<AppConfig>(
  'appConfig',
  {
    characterProfiles: [initNewProfile(DEFAULT_PROFILE_NAME)],
    uiConfig: defaultUIConfig,
  },
  {
    serializer: bigIntSerializer,
    beforeRead: (value) => {
      migrateAppConfig(value);
      // What's in localStorage may not match the shape the app expects
      for (const profile of value.characterProfiles) {
        migrateProfile(profile);
      }
      return value;
    },
  }
);

export function getProfile(name: string) {
  // Look up the profile with the given name in the current appConfig.
  return appConfig.current.characterProfiles.find((p) => p.characterName === name);
}
export function addNewProfile(profile: CharacterProfile) {
  // Register a new CharacterProfile in appConfig.
  // Returns true if registration succeeds, false otherwise.
  const name = profile.characterName;
  if (name.length == 0 || name.length > 16) return false;
  const existProfile = appConfig.current.characterProfiles.findIndex(
    (p) => p.characterName === name
  );
  if (existProfile != -1) return false;
  appConfig.current.characterProfiles.push(profile);
  return true;
}
export function toggleUI(optionName: keyof UIConfig) {
  appConfig.current.uiConfig[optionName] = !appConfig.current.uiConfig[optionName];
}
export function updateUI(optionName: keyof UIConfig, value: boolean) {
  appConfig.current.uiConfig[optionName] = value;
}

export function toggleDarkMode() {
  appConfig.current.uiConfig.darkMode = !appConfig.current.uiConfig.darkMode;
  appConfig.current.uiConfig.themeSetByUser = true;
}
export function applyOsThemePreference(prefersDark: boolean) {
  // Seed the theme from the OS only while the user has never chosen one;
  // an explicit toggle persists and must survive reloads.
  if (appConfig.current.uiConfig.themeSetByUser) return;
  appConfig.current.uiConfig.darkMode = prefersDark;
}
export function toggleDeferredScreenSharingInit() {
  appConfig.current.uiConfig.deferredScreenSharingInit =
    !appConfig.current.uiConfig.deferredScreenSharingInit;
}
