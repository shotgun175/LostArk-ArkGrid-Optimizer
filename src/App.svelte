<script lang="ts">
  import { SvelteToast } from '@zerodevx/svelte-toast';
  import { onMount } from 'svelte';

  import BackToTop from './components/BackToTop.svelte';
  import CharacterProfileEditor from './components/CharacterProfileEditor.svelte';
  import CuttingPlanPanel from './components/CuttingPlanPanel.svelte';
  import Footer from './components/Footer/Footer.svelte';
  import GemRecognitionPanel from './components/GemRecognition/Panel.svelte';
  import GemTriagePanel from './components/GemTriagePanel.svelte';
  import AppConfiguration from './components/Header/AppConfiguration.svelte';
  import ProfileEdit from './components/Header/ProfileEditor.svelte';
  import SectionNav from './components/SectionNav.svelte';
  import { type LocalizationName } from './lib/constants/enums';
  import { appConfig, enableDarkMode, toggleUI } from './lib/state/appConfig.state.svelte';
  import { appLocale, setLocale } from './lib/state/locale.state.svelte';
  import { type CharacterProfile, getCurrentProfile } from './lib/state/profile.state.svelte';
  import { initTooltipModal } from './lib/ui/tooltipModal';

  let locale = $derived(appLocale.current);
  const LTitle: LocalizationName = {
    en_us: 'Ark Grid Combat Power Optimizer',
  };
  let currentProfile = $state<CharacterProfile>(getCurrentProfile());
  $effect(() => {
    currentProfile = getCurrentProfile();
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark-mode', appConfig.current.uiConfig.darkMode);
  });

  onMount(() => {
    // Dark mode
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      enableDarkMode();
    }

    // debug CLI
    (window as any).debug = () => {
      toggleUI('debugMode');
      console.log('Current debug mode:', appConfig.current.uiConfig.debugMode);
    };

    // English-only UI.
    setLocale('en_us');

    // Mobile tooltips: dimmed/blurred backdrop + tap-outside / Escape dismissal.
    return initTooltipModal();
  });
  const pageTitle = $derived(
    {
      en_us: 'Ark Grid Combat Power Optimizer',
    }[appLocale.current]
  );
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<main>
  <SvelteToast options={{ reversed: true, intro: { y: 192 } }} />
  <div class="contents">
    <div class="title">{LTitle[locale]}</div>
    <div class="layout">
      <SectionNav />
      <AppConfiguration></AppConfiguration>
      <div class="profile-row" id="sec-profile"><ProfileEdit></ProfileEdit></div>
      <div class="sections">
        <div id="sec-recognition"><GemRecognitionPanel></GemRecognitionPanel></div>
        <CharacterProfileEditor bind:profile={currentProfile}></CharacterProfileEditor>
        <div id="sec-triage"><GemTriagePanel profile={currentProfile} /></div>
        <div id="sec-cutplan"><CuttingPlanPanel profile={currentProfile} /></div>
      </div>
    </div>
  </div>
  <BackToTop />
</main>
<footer>
  <Footer></Footer>
</footer>

<style>
  .contents {
    --nav-width: 13rem;
    --content-max: 87.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--global-gap);
    /* 20px padding when wide; gradually narrows past 960px (vertical layout) */
    padding: clamp(8px, 2.083vw, 20px);
  }
  /* Center the content column; the nav floats in the left margin. Row 1 = config/Dark Mode
     (right-aligned), row 2 = profile bar, row 3 = sections + nav. Everything in column 2 aligns,
     and the nav sits in column 1 on the sections row so it starts level with the first panel. */
  .layout {
    display: grid;
    grid-template-columns: 1fr minmax(0, var(--content-max)) 1fr;
    column-gap: var(--global-gap);
    row-gap: var(--global-gap);
    align-items: start;
  }
  :global(.layout > .buttons) {
    grid-column: 2;
    grid-row: 1;
  }
  .profile-row {
    grid-column: 2;
    grid-row: 2;
    min-width: 0;
  }
  .sections {
    grid-column: 2;
    grid-row: 3;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--global-gap);
  }
  :global(.section-nav) {
    grid-column: 1;
    grid-row: 3;
    justify-self: end;
  }
  /* Not enough room in the left margin for the nav to float — put it inline at the left instead. */
  @media (max-width: 117.5rem) {
    .layout {
      grid-template-columns: var(--nav-width) minmax(0, 1fr);
    }
    :global(.layout > .buttons),
    .profile-row,
    .sections {
      grid-column: 2;
    }
    :global(.section-nav) {
      grid-column: 1;
      justify-self: stretch;
    }
  }
  @media (max-width: 960px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    :global(.layout > .buttons),
    .profile-row,
    .sections {
      grid-column: 1;
    }
  }
  @media (max-width: 767px) {
    .contents {
      padding: 0rem;
    }
  }
  /* The fixed Sections / Back-to-top buttons sit at 1.5rem + safe-area from the bottom. Reserve
     room beneath the footer on small screens (where both buttons live) so they can't cover the
     last content or the footer links when scrolled to the bottom. */
  @media (max-width: 960px) {
    footer {
      padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
    }
  }
  .contents .title {
    font-weight: 700;
    /* Scale down on phones so the title doesn't eat the first viewport. */
    font-size: clamp(1.5rem, 5.5vw, 3rem);
    text-align: center;
    word-break: keep-all;
    overflow-wrap: break-word;
  }
  :root {
    --toastContainerTop: auto;
    --toastContainerRight: auto;
    --toastContainerBottom: 8rem;
    --toastContainerLeft: calc(50vw - 8rem);
  }
</style>
