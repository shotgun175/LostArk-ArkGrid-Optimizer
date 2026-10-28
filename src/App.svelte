<script lang="ts">
  import { SvelteToast } from '@zerodevx/svelte-toast';
  import { onMount } from 'svelte';

  import BackToTop from './components/BackToTop.svelte';
  import BuildSection from './components/BuildSection.svelte';
  import CutAdvisorPanel from './components/CutAdvisor/Panel.svelte';
  import CuttingPlanPanel from './components/CuttingPlanPanel.svelte';
  import Assumptions from './components/Footer/Assumptions.svelte';
  import Footer from './components/Footer/Footer.svelte';
  import GemRecognitionPanel from './components/GemRecognition/Panel.svelte';
  import GemTriagePanel from './components/GemTriagePanel.svelte';
  import AppConfiguration from './components/Header/AppConfiguration.svelte';
  import ProfileEditor from './components/Header/ProfileEditor.svelte';
  import SectionNav from './components/SectionNav.svelte';
  import ConfirmDialog from './components/shared/ConfirmDialog.svelte';
  import DeprecationBanner from './components/shared/DeprecationBanner.svelte';
  import UpdateNotice from './components/UpdateNotice.svelte';
  import { type LocalizationName } from './lib/constants/enums';
  import { appConfig, applyOsThemePreference, toggleUI } from './lib/state/appConfig.state.svelte';
  import { appLocale, setLocale } from './lib/state/locale.state.svelte';
  import { type CharacterProfile, getCurrentProfile } from './lib/state/profile.state.svelte';
  import { startUpdateWatch } from './lib/state/update.state.svelte';
  import { initTooltipModal } from './lib/ui/tooltipModal';

  let locale = $derived(appLocale.current);
  // Canonical display name (portfolio-wide); the long descriptive form lives
  // in the meta description.
  const LTitle: LocalizationName = {
    en_us: 'ArkGrid Optimizer',
  };
  // getCurrentProfile() can switch to or create the Default profile, and state writes are not
  // allowed inside $derived (state_unsafe_mutation, blank page), so this stays $state + $effect.
  // eslint-disable-next-line svelte/prefer-writable-derived
  let currentProfile = $state<CharacterProfile>(getCurrentProfile());
  $effect(() => {
    currentProfile = getCurrentProfile();
  });

  $effect(() => {
    document.documentElement.classList.toggle('dark-mode', appConfig.current.uiConfig.darkMode);
  });

  onMount(() => {
    // Dark mode: the OS preference only seeds the theme until the user
    // explicitly toggles it — a persisted choice survives reloads.
    applyOsThemePreference(window.matchMedia('(prefers-color-scheme: dark)').matches);

    // debug CLI
    (window as any).debug = () => {
      toggleUI('debugMode');
      console.log('Current debug mode:', appConfig.current.uiConfig.debugMode);
    };

    // English-only UI.
    setLocale('en_us');

    // Tell a tab left open across a deploy that a newer build is live (its on-demand files are gone).
    const stopUpdateWatch = startUpdateWatch();
    // Mobile tooltips: dimmed/blurred backdrop + tap-outside / Escape dismissal.
    const stopTooltips = initTooltipModal();
    return () => {
      stopUpdateWatch();
      stopTooltips();
    };
  });
  const pageTitle = $derived(
    {
      en_us: 'ArkGrid Optimizer - Gem Triage and Cutting Plan for Lost Ark',
    }[appLocale.current]
  );
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<main>
  <SvelteToast options={{ reversed: true, intro: { y: 192 } }} />
  <UpdateNotice />
  <ConfirmDialog />
  <div class="contents">
    <div class="layout">
      <div class="page-header">
        <DeprecationBanner />
        <div class="title">{LTitle[locale]}</div>
      </div>
      <SectionNav />
      <AppConfiguration></AppConfiguration>
      <div class="profile-row" id="sec-profile"><ProfileEditor></ProfileEditor></div>
      <div class="sections">
        <div id="sec-recognition"><GemRecognitionPanel></GemRecognitionPanel></div>
        <BuildSection bind:profile={currentProfile}></BuildSection>
        <div id="sec-triage"><GemTriagePanel profile={currentProfile} /></div>
        <div id="sec-cutplan"><CuttingPlanPanel profile={currentProfile} /></div>
        <div id="sec-advisor"><CutAdvisorPanel profile={currentProfile} /></div>
      </div>
    </div>
  </div>
  <BackToTop />
</main>
<footer>
  <div class="footer-column">
    <Assumptions />
    <Footer></Footer>
  </div>
</footer>

<style>
  .contents,
  footer {
    --nav-width: 13rem;
    --content-max: 87.5rem;
    /* 20px padding when wide; gradually narrows past 960px (vertical layout) */
    --page-padding: clamp(8px, 2.083vw, 20px);
  }
  .contents {
    padding: var(--page-padding);
  }
  /* Center the content column; the nav floats in the left margin. Row 1 = page title (with the
     retirement notice above it when shown), row 2 = config/Dark Mode (right-aligned), row 3 =
     profile bar, row 4 = sections + nav. Everything in column 2 aligns, and the nav sits in column
     1 on the sections row so it starts level with the first panel.
     The footer sits outside .contents but repeats its side padding and columns, so the Assumptions
     panel and footer links line up with the sections at every width. Column 1's minimum is the nav
     width: in .layout the nav already forces it, and the footer (no nav) needs it stated to get the
     same tracks. */
  .layout,
  footer {
    display: grid;
    grid-template-columns: minmax(var(--nav-width), 1fr) minmax(0, var(--content-max)) 1fr;
    column-gap: var(--global-gap);
  }
  .layout {
    row-gap: var(--global-gap);
    align-items: start;
  }
  footer {
    padding-inline: var(--page-padding);
  }
  .footer-column {
    grid-column: 2;
    min-width: 0;
  }
  .page-header {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--global-gap);
  }
  :global(.layout > .buttons) {
    grid-column: 2;
    grid-row: 2;
  }
  .profile-row {
    grid-column: 2;
    grid-row: 3;
    min-width: 0;
  }
  .sections {
    grid-column: 2;
    grid-row: 4;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--global-gap);
  }
  :global(.section-nav) {
    grid-column: 1;
    grid-row: 4;
    justify-self: end;
  }
  /* Not enough room in the left margin for the nav to float — put it inline at the left instead. */
  @media (max-width: 117.5rem) {
    .layout,
    footer {
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
    .layout,
    footer {
      grid-template-columns: minmax(0, 1fr);
    }
    .page-header,
    :global(.layout > .buttons),
    .profile-row,
    .sections,
    .footer-column {
      grid-column: 1;
    }
  }
  @media (max-width: 767px) {
    .contents,
    footer {
      --page-padding: 0rem;
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
  /* While the nav sits beside the sections, center toasts on the sections column instead of the
     window: shift right by half of the nav width (13rem, --nav-width) plus the column gap. */
  @media (max-width: 117.5rem) {
    :root {
      --toastContainerLeft: calc(50vw + (13rem + var(--global-gap)) / 2 - 8rem);
    }
  }
  @media (max-width: 960px) {
    :root {
      --toastContainerLeft: calc(50vw - 8rem);
    }
  }
</style>
