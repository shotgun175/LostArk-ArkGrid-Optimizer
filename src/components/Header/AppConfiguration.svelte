<script lang="ts">
  import Icon from '../shared/Icon.svelte';
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
    <Icon name={appConfig.current.uiConfig.darkMode ? 'toggle-on' : 'toggle-off'} />
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
