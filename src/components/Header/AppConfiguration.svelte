<script lang="ts">
  import { type LocalizationName } from '../../lib/constants/enums';
  import { appConfig, toggleDarkMode, toggleUI } from '../../lib/state/appConfig.state.svelte';
  import { appLocale } from '../../lib/state/locale.state.svelte';

  let locale = $derived(appLocale.current);
  const LDarkMode: LocalizationName = {
    en_us: 'Dark Mode',
  };
</script>

<div class="buttons">
  <button hidden={!appConfig.current.uiConfig.debugMode} onclick={() => toggleUI('debugMode')}
    >Developer Mode {appConfig.current.uiConfig.debugMode ? 'Off' : 'On'}</button
  >
  <button onclick={toggleDarkMode} style="">
    {LDarkMode[locale]}
    <i
      class="fa-solid"
      class:fa-toggle-on={appConfig.current.uiConfig.darkMode}
      class:fa-toggle-off={!appConfig.current.uiConfig.darkMode}
    ></i>
  </button>
</div>

<style>
  .buttons {
    display: flex;
    flex-direction: row;
    gap: 10px;
    justify-content: right;
    flex-wrap: wrap;
  }
  button {
    background-color: var(--card);
  }
  button:hover {
    background-color: var(--card-inner);
  }
</style>
