<script lang="ts">
  import { onDestroy } from 'svelte';

  import { type ArkGridAttr, type LocalizationName } from '../../lib/constants/enums';
  import { CaptureController } from '../../lib/cv/captureController';
  import { type ArkGridGem, isSameArkGridGem } from '../../lib/models/arkGridGems';
  import {
    appConfig,
    toggleDeferredScreenSharingInit,
    toggleUI,
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
    en_us: 'Recongition Tolerance Range',
  };
  const LDetectionMargin = {
    en_us: ['Normal', 'Sparse', 'Maximum'],
  };
  const LFirefoxNotSupported = $derived(
    {
      en_us: 'Sorry, Firefox broswer is not supported. Please use Chromium browser.',
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
    const isFirefox = typeof (window as any).InstallTrigger !== 'undefined';
    if (isFirefox) {
      window.alert(LFirefoxNotSupported);
      return;
    }
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
  onDestroy(async () => {
    const controller = await getCaptureController();
    await controller.stopCapture();
  });
</script>

<div class="panel">
  {#if isLoading}
    <div class="overlay">
      <div class="spinner"></div>
    </div>
  {/if}
  <div class="title">
    <span>{LTitle[locale]}</span>
    <div class="status-dot" class:online={isRecording} class:offline={!isRecording}></div>
    <span class="tooltip">
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
  <div
    class="content"
    style:display={!appConfig.current.uiConfig.showGemRecognitionPanel ? 'none' : 'flex'}
  >
    <div class="buttons">
      <div class="left">
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
    width: auto;
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
