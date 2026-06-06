import { persistedState } from 'svelte-persisted-state';

import { DEFAULT_PROFILE_NAME } from '../constants/enums';
import { type CharacterProfile, initNewProfile, migrateProfile } from './profile.state.svelte';

interface UIConfig {
  showGemRecognitionPanel: boolean;
  showGemRecognitionGuide: boolean;
  showCoreCoeff: boolean;
  debugMode: boolean;
  darkMode: boolean;
  deferredScreenSharingInit: boolean;
  newGemAddStyle: boolean;
  // Per-section collapse state (true = expanded).
  showGemTriage: boolean;
  showCuttingPlan: boolean;
  showOptimization: boolean;
}
const defaultUIConfig: UIConfig = {
  showGemRecognitionPanel: true,
  showGemRecognitionGuide: true,
  showCoreCoeff: false,
  debugMode: false,
  darkMode: false,
  deferredScreenSharingInit: false,
  newGemAddStyle: false,
  showGemTriage: true,
  showCuttingPlan: true,
  showOptimization: true,
};

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
  // Collapse markers always start expanded on each page load (collapsed state is not persisted).
  if (appConfig.uiConfig) {
    appConfig.uiConfig.showGemRecognitionPanel = true;
    appConfig.uiConfig.showGemTriage = true;
    appConfig.uiConfig.showCuttingPlan = true;
    appConfig.uiConfig.showOptimization = true;
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
}
export function enableDarkMode() {
  appConfig.current.uiConfig.darkMode = true;
}
export function toggleDeferredScreenSharingInit() {
  appConfig.current.uiConfig.deferredScreenSharingInit =
    !appConfig.current.uiConfig.deferredScreenSharingInit;
}
