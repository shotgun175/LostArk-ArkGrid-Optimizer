<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { type ArkGridAttr, type LocalizationName } from '../../lib/constants/enums';
  import { CaptureController } from '../../lib/cv/captureController';
  import { type ArkGridGem, isSameArkGridGem } from '../../lib/models/arkGridGems';
  import {
    appConfig,
    toggleDeferredScreenSharingInit,
    toggleUI,
    updateUI,
  } from '../../lib/state/appConfig.state.svelte';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import GemRecognitionGemList from './GemList.svelte';
  import GemRecognitionGuide from './Guide.svelte';

  let locale = $derived(appLocale.current);
  const LTitle: LocalizationName = {
    en_us: 'Astrogem Recognition Screen',
  };
  const LStartCapture: LocalizationName = {
    en_us: 'Start Screen Sharing',
  };
  const LStopCapture: LocalizationName = {
    en_us: 'Stop Screen Sharing',
  };
  const LShowScreen: LocalizationName = {
    en_us: 'Display Sharing Screen',
  };
  const LHideScreen: LocalizationName = {
    en_us: 'Hide Sharing Screen',
  };
  const LThreshold: LocalizationName = {
    en_us: 'Recognition Tolerance Range',
  };
  const LDetectionMargin = {
    en_us: ['Normal', 'Sparse', 'Maximum'],
  };
  const LUnsupported = $derived(
    {
      en_us:
        'On-screen recognition needs a desktop Chromium browser (Chrome or Edge). You can still add gems manually below.',
    }[locale]
  );
  const LSupportedClient = $derived(
    {
      en_us: 'Supported Clients: Korean, English, Russian (Beta)',
    }[locale]
  );
  const LControllerLazyLoading = $derived(
    {
      en_us: 'Prevent Screen Sharing Crash',
    }[locale]
  );
  // Screen capture needs getDisplayMedia (absent on iOS Safari / mobile browsers) and
  // MediaStreamTrackProcessor (Chromium-only). Detect once; gate the UI when missing so
  // mobile/Safari/Firefox users get a clear message instead of a button that throws.
  const captureSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof (window as any).MediaStreamTrackProcessor === 'function';

  // On devices that can't screen-capture, the whole recognition section is irrelevant (it only
  // drives the desktop capture flow) — collapse it by default so it doesn't dominate the view.
  // The unsupported note still shows on the collapsed bar so the user knows why.
  if (!captureSupported) {
    updateUI('showGemRecognitionPanel', false);
  }

  let debugCanvas: HTMLCanvasElement | null;
  let totalOrderGems = $state<ArkGridGem[]>([]);
  let totalChaosGems = $state<ArkGridGem[]>([]);
  let isRecording = $state<boolean>(false);
  let isDebugging = $state<boolean>(false);
  let isLoading = $state<boolean>(false);
  let detectionMargin = $state<number>(0);
  let gemListElem: GemRecognitionGemList | null = null;

  let _captureController: CaptureController | null = null;
  let _prevGem: string | null = null;

  async function getCaptureController() {
    if (_captureController) return _captureController;
    _captureController = new CaptureController(debugCanvas);
    return _captureController;
  }

  function applyCurrentGems(gemAttr: ArkGridAttr, currentGems: ArkGridGem[]) {
    const gemKey = JSON.stringify(currentGems);
    if (_prevGem === null) _prevGem = gemKey;
    else {
      if (_prevGem == gemKey) {
        return;
      } else {
        _prevGem = gemKey;
      }
    }
    const totalGems = gemAttr == 'Order' ? totalOrderGems : totalChaosGems;
    // Add gems
    const SAME_COUNT_THRESHOLD = 4;
    if (totalGems.length == 0 && currentGems.length > 0) {
      // If there are no current gems, replace with the gems on screen.
      // The count need not be exactly 9 here (some people cut few gems).
      for (const gem of currentGems) {
        totalGems.push(gem);
      }
      gemListElem?.selectTab(gemAttr == 'Order' ? 0 : 1);
      gemListElem?.scroll('bottom');
      // console.log($state.snapshot(totalGems));
    } else {
      if (currentGems.length == 9 && totalGems.length < 100) {
        // Proceed only when all 9 gems were recognized normally.

        // Q. Where does the first gem on my screen sit within the full gem list?
        // Save all candidates in case two or more gems share the same options.
        let foundIndices: number[] = [];
        for (let i = 0; i < totalGems.length; i++) {
          if (isSameArkGridGem(totalGems[i], currentGems[0])) {
            foundIndices.push(i);
          }
        }
        // For each index found above,
        // consecutively check how many of the on-screen gems are already known.
        for (let foundIndex of foundIndices) {
          let sameCount = 1;
          for (let i = 1; i < currentGems.length; i++) {
            if (foundIndex + i >= totalGems.length) break;
            if (isSameArkGridGem(totalGems[foundIndex + i], currentGems[i])) {
              sameCount += 1;
            } else {
              break;
            }
          }
          // If every gem currently on screen was already added consecutively, skip.
          if (sameCount == 9) continue;

          // To exclude cases where the user scrolled too fast,
          // only proceed when at least 4 of the on-screen gems are already known.
          // Also, a mismatched index for same-option gems yields sameCount = 1, so filter it out.
          if (sameCount >= SAME_COUNT_THRESHOLD) {
            // Gems from sameCount to the end of my screen are candidates to add.
            for (let i = sameCount; i < 9; i++) {
              totalGems.push(currentGems[i]);
              // console.log('add:', currentGems[i]);
            }
            gemListElem?.selectTab(gemAttr == 'Order' ? 0 : 1);
            gemListElem?.scroll('bottom');
            // console.log($state.snapshot(totalGems));
          }
        }

        if (foundIndices.length == 0) {
          // If the first on-screen gem is missing entirely, assume the user is scrolling upward.
          // Check whether the last gem is already known.
          for (let i = 0; i < totalGems.length; i++) {
            if (isSameArkGridGem(totalGems[i], currentGems[8])) {
              foundIndices.push(i);
            }
          }
          // For each index found above,
          // consecutively check how many of the on-screen gems are already known.
          for (let foundIndex of foundIndices) {
            let sameCount = 1;
            for (let i = 1; i < currentGems.length; i++) {
              if (foundIndex - i < 0) break;
              if (isSameArkGridGem(totalGems[foundIndex - i], currentGems[8 - i])) {
                sameCount += 1;
              } else {
                break;
              }
            }
            if (sameCount == 9) continue;
            if (sameCount >= SAME_COUNT_THRESHOLD) {
              // Gems from 0 to 9-sameCount-1 on my screen are candidates to add.
              for (let i = 9 - sameCount - 1; i >= 0; i--) {
                totalGems.unshift(currentGems[i]);
                // console.log('add:', currentGems[i]);
              }
              gemListElem?.selectTab(gemAttr == 'Order' ? 0 : 1);
              gemListElem?.scroll('top');
              // console.log($state.snapshot(totalGems));
            }
          }
        }
      }
    }
  }

  async function startGemCapture() {
    // The button is hidden when unsupported; guard defensively anyway.
    if (!captureSupported) return;
    // Start gem capture
    const controller = await getCaptureController();
    // Lock the UI
    isLoading = true;

    // register callbacks
    controller.onLoad = () => {
      // Release the UI loading state once loading finishes.
      isLoading = false;
    };
    controller.onStartCaptureError = (err) => {
      let msg = 'An unknown error occurred.';
      switch (err) {
        case 'recording':
          msg = 'Already recording.';
          break;
        case 'screen-permission-denied':
          msg = 'Screen sharing was denied.';
          break;
        case 'worker-init-failed':
          msg = 'Failed to prepare the analysis engine.';
          break;
        default:
          msg = 'An unknown error occurred.';
      }
      window.alert(msg);
      isLoading = false;
    };
    controller.onReady = () => {
      // Turn the indicator green after the first frame is consumed.
      isRecording = true;
    };
    controller.onFrameDone = (gemAttr, gems) => {
      // Apply analysis results to the current temporary gem store.
      applyCurrentGems(gemAttr, gems);
    };
    controller.onStop = () => {
      isRecording = false;
    };
    await controller.startCapture(appConfig.current.uiConfig.deferredScreenSharingInit);
  }

  async function stopGemCapture() {
    const controller = await getCaptureController();
    if (controller.isRecording()) {
      // Request the controller to stop and wait until it completes.
      await controller.stopCapture();
      isRecording = false;
      debugCanvas?.getContext('2d')?.reset();
    }
  }
  async function toggleDrawDebug() {
    const controller = await getCaptureController();
    isDebugging = controller.toggleDrawDebug();
  }
  async function updateControllerDetectionMargin(detectionMargin: number) {
    const controller = await getCaptureController();
    controller.detectionMargin = detectionMargin;
  }
  // On desktop, warm the recognition worker (download + JIT-compile the OpenCV WASM) shortly after
  // load so the first "Start Screen Sharing" doesn't pay the cold ~5s cost. Deferred to idle so it
  // never competes with first paint; gated on captureSupported so mobile never fetches the 10.8MB
  // CV chunk. startGemCapture() reuses the warmed worker.
  onMount(() => {
    if (!captureSupported) return;
    const warm = () => void getCaptureController().then((c) => c.warmup());
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(warm, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 1200);
    return () => clearTimeout(id);
  });

  onDestroy(async () => {
    const controller = await getCaptureController();
    await controller.stopCapture();
  });
</script>

<div class="panel">
  {#if isLoading}
    <div class="overlay" role="status" aria-label="Loading recognition engine">
      <div class="spinner"></div>
      <span class="overlay-text">Loading recognition engine… first use can take a few seconds.</span
      >
    </div>
  {/if}
  <div class="title">
    <span>{LTitle[locale]}</span>
    <div
      class="status-dot"
      class:online={isRecording}
      class:offline={!isRecording}
      role="status"
      aria-label={isRecording ? 'Recognition active' : 'Recognition stopped'}
    ></div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span class="tooltip" tabindex="0">
      <i class="fa-solid fa-circle-info info-icon"></i>
      <span class="tooltip-text">
        {LSupportedClient}
      </span>
    </span>
    <button
      class="fold-button"
      onclick={() => toggleUI('showGemRecognitionPanel')}
      disabled={isRecording}
      >{appConfig.current.uiConfig.showGemRecognitionPanel ? '▼' : '▲'}</button
    >
  </div>
  {#if !captureSupported}
    <p class="unsupported-note">{LUnsupported}</p>
  {/if}
  <div
    class="content"
    style:display={!appConfig.current.uiConfig.showGemRecognitionPanel ? 'none' : 'flex'}
  >
    <div class="buttons">
      <div class="left">
        {#if captureSupported}
          {#if !isRecording}
            <button onclick={startGemCapture}>🖥️ {LStartCapture[locale]}</button>
          {:else}
            <button onclick={stopGemCapture}>🖥️ {LStopCapture[locale]}</button>
          {/if}
          <button class:active={isDebugging} onclick={toggleDrawDebug}>
            🔨 {isDebugging ? LHideScreen[locale] : LShowScreen[locale]}
          </button>
          <button onclick={toggleDeferredScreenSharingInit}>
            {LControllerLazyLoading}
            <i
              class="fa-solid"
              class:fa-circle-dot={appConfig.current.uiConfig.deferredScreenSharingInit}
              class:fa-circle={!appConfig.current.uiConfig.deferredScreenSharingInit}
            ></i>
          </button>
        {/if}
      </div>
      <div class="right"></div>
    </div>
    <div hidden={!isDebugging}>
      <div class="debug-screen">
        <div class="threshold-controller">
          <input
            id="slider"
            type="range"
            min="0"
            max="2"
            step="1"
            bind:value={detectionMargin}
            oninput={async () => {
              await updateControllerDetectionMargin(detectionMargin / 10);
            }}
          />
          <label for="slider"
            >{LThreshold[locale]}: {LDetectionMargin[locale][detectionMargin]}</label
          >
        </div>
        <canvas bind:this={debugCanvas} style="border: 1px black solid;"></canvas>
      </div>
    </div>
    <div class="dual-panel">
      <div>
        <GemRecognitionGuide></GemRecognitionGuide>
      </div>
      <GemRecognitionGemList
        gems={{
          orderGems: totalOrderGems,
          chaosGems: totalChaosGems,
        }}
        bind:this={gemListElem}
      />
    </div>
  </div>
</div>

<style>
  /* Overlay + centered */
  .panel {
    position: relative;
  }

  .panel > .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* .panel > .title > .title-with-dot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  } */

  .title .tooltip-text {
    bottom: -200%;
  }
  /* On phones the tooltip is a centered card (see app.css); clear the desktop -200% anchor so the
     card's top/transform centering applies instead of being pushed off-screen. */
  @media (max-width: 767px) {
    .title .tooltip-text {
      bottom: auto;
    }
  }
  .panel > .title > .fold-button {
    flex-grow: 1;
    text-align: right;
    border: none;
    background: none;
  }

  .status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
    vertical-align: middle;
  }
  .status-dot.online {
    background-color: #22c55e; /* green */
  }
  .status-dot.offline {
    background-color: #9ca3af; /* gray */
  }

  /* Stack the spinner and its status text; give the text legibility over the dim overlay. */
  .overlay {
    flex-direction: column;
    gap: 1rem;
  }
  .overlay-text {
    color: #fff;
    font-weight: 600;
    text-align: center;
    max-width: 22rem;
    padding: 0 1rem;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  }

  .unsupported-note {
    margin: 0;
    color: var(--text);
    opacity: 0.85;
    max-width: 36rem;
    line-height: 1.4;
  }

  .panel > .content {
    /* Stack inner elements vertically */
    display: flex;
    flex-direction: column;

    /* Vertical spacing between elements inside the panel */
    gap: 0.7rem;
    overflow-y: hidden;
  }
  .content > .buttons {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .buttons > div {
    display: flex;
    align-items: stretch;
    gap: 8px;
    flex-wrap: wrap;
  }
  .buttons > div > button {
    flex-basis: auto;
  }
  .debug-screen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    justify-content: center;
  }
  .debug-screen > canvas {
    max-width: 100%;
    height: auto;
    display: block;
  }
  .debug-screen > .threshold-controller {
    display: flex;
    /* height: 60px; */
    align-items: center;
    gap: 1rem;
  }
  .debug-screen > .threshold-controller > label {
    width: 20rem;
  }
  .debug-screen > .threshold-controller > input {
    transform: translateY(2px);
  }
</style>
