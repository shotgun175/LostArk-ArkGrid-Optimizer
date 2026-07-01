<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import Icon from '../shared/Icon.svelte';
  import { type ArkGridAttr, type LocalizationName } from '../../lib/constants/enums';
  import { CaptureController } from '../../lib/cv/captureController';
  import { type AssemblyResult, assembleScreenshots } from '../../lib/cv/stitch';
  import type { OwnedCount } from '../../lib/cv/types';
  import {
    type ImportResult,
    buildBookmarklet,
    parseImportHash,
    parseLoadout,
  } from '../../lib/import/bibleImport';
  import { type ArkGridGem, isSameArkGridGem } from '../../lib/models/arkGridGems';
  import {
    appConfig,
    sectionUI,
    setSection,
    toggleDeferredScreenSharingInit,
    toggleSection,
  } from '../../lib/state/appConfig.state.svelte';
  import { appLocale } from '../../lib/state/locale.state.svelte';
  import GemRecognitionGuide from './Guide.svelte';
  import RecognizedGemList from './RecognizedGemList.svelte';

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
        'Live on-screen recognition needs a desktop Chromium browser (Chrome or Edge). On other browsers, use “📷 Upload Screenshot” below to recognize gems from a screenshot, or add gems manually.',
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
  const LUpload: LocalizationName = {
    en_us: 'Upload Screenshot',
  };
  const LUploadHint = $derived(
    {
      en_us: 'Drop screenshots here (several at once is fine), paste (Ctrl/⌘+V), or click to choose files.',
    }[locale]
  );
  const LUploadProcessing = $derived(
    {
      en_us: 'Recognizing…',
    }[locale]
  );
  const LImport: LocalizationName = {
    en_us: 'Import Loadout',
  };
  // Screen capture needs getDisplayMedia (absent on iOS Safari / mobile browsers) and
  // MediaStreamTrackProcessor (Chromium-only). Detect once; gate the UI when missing so
  // mobile/Safari/Firefox users get a clear message instead of a button that throws.
  const captureSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof (window as any).MediaStreamTrackProcessor === 'function';

  // Note: the panel is no longer auto-collapsed when live capture is unsupported — the “📷 Upload
  // Screenshot” path works for everyone (mobile / Safari / Firefox included), so the section stays
  // expanded and the unsupported note simply points those users at upload.

  let debugCanvas: HTMLCanvasElement | null;
  let fileInput = $state<HTMLInputElement | null>(null);
  // Active recognition mode. The three inputs (live screen sharing, screenshot upload, loadout
  // import) are mutually exclusive; the section flags derive from it so only one is ever open at a
  // time. Screen sharing is the default where supported; where it isn't (mobile / Safari / Firefox)
  // we default to loadout import so the guide and open panel match a path the user can actually use.
  let mode = $state<'capture' | 'upload' | 'import'>(captureSupported ? 'capture' : 'import');
  let showUpload = $derived(mode === 'upload');
  let isDragging = $state<boolean>(false);
  let isProcessingUpload = $state<boolean>(false);
  // Determinate progress of the in-flight upload recognition (null when idle). `frac` is the overall
  // 0..1 across all files; `index`/`total` drive the "screenshot N of M" label.
  let uploadProg = $state<{ frac: number; index: number; total: number } | null>(null);
  // The in-game "Astrogems Owned" total read from the last uploaded screenshot (count checksum).
  let detectedOwned = $state<OwnedCount | null>(null);
  // Backend-free loadout import (paste page source / drop .html / bookmarklet hand-off).
  let showImport = $derived(mode === 'import');
  let importText = $state<string>('');
  let isImportDragging = $state<boolean>(false);
  let importMsg = $state<string | null>(null);
  let bookmarklet = $state<string>('');
  let totalOrderGems = $state<ArkGridGem[]>([]);
  let totalChaosGems = $state<ArkGridGem[]>([]);
  // Upload path (multi-file): keep the RAW recognized shots per attribute + the per-attr footer
  // target, and re-derive the de-duplicated lists with the count-aware assembler on each upload.
  let orderShots = $state<ArkGridGem[][]>([]);
  let chaosShots = $state<ArkGridGem[][]>([]);
  let orderTarget = $state<number | null>(null);
  let chaosTarget = $state<number | null>(null);
  let orderAssembly = $state<AssemblyResult | null>(null);
  let chaosAssembly = $state<AssemblyResult | null>(null);
  let isRecording = $state<boolean>(false);
  let isDebugging = $state<boolean>(false);
  let isLoading = $state<boolean>(false);
  let detectionMargin = $state<number>(0);
  let gemListElem: RecognizedGemList | null = null;

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

  // Re-derive the de-duplicated per-attr lists from the raw uploaded shots via the count-aware
  // assembler (B-with-A-fallback). Only touches an attribute that has uploads, so the live
  // screen-share path (which fills totalOrderGems/totalChaosGems directly) is left intact.
  function reassembleUploads() {
    if (orderShots.length > 0) {
      orderAssembly = assembleScreenshots(orderShots, orderTarget);
      totalOrderGems = orderAssembly.gems;
    }
    if (chaosShots.length > 0) {
      chaosAssembly = assembleScreenshots(chaosShots, chaosTarget);
      totalChaosGems = chaosAssembly.gems;
    }
  }

  // Recognize one screenshot into the raw per-attr shot list + update both footer targets (the
  // footer carries Order AND Chaos totals regardless of which tab is shown). Returns true on success.
  async function recognizeIntoShots(file: File): Promise<boolean> {
    const controller = await getCaptureController();
    const bitmap = await createImageBitmap(file);
    const result = await controller.recognizeImage(bitmap);
    if (!result || result.gems.length === 0) return false;
    (result.gemAttr === 'Order' ? orderShots : chaosShots).push(result.gems);
    if (result.owned?.order != null) orderTarget = Math.max(orderTarget ?? 0, result.owned.order);
    if (result.owned?.chaos != null) chaosTarget = Math.max(chaosTarget ?? 0, result.owned.chaos);
    return true;
  }

  // Recognize one OR MORE uploaded / pasted / dropped screenshots, then re-assemble. Works for
  // everyone (mobile / Safari / Firefox) — needs only the worker, not screen sharing.
  async function processImageFiles(files: FileList | File[] | null | undefined) {
    const images = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0 || isProcessingUpload) return;
    isProcessingUpload = true;
    uploadProg = { frac: 0, index: 0, total: images.length };
    let recognized = 0;
    const controller = await getCaptureController();
    try {
      for (let i = 0; i < images.length; i++) {
        // Map this file's 0..1 recognition progress into the overall bar across all files.
        controller.onImageProgress = (f) => (uploadProg = { frac: (i + f) / images.length, index: i, total: images.length });
        try {
          if (await recognizeIntoShots(images[i])) recognized++;
        } catch {
          // skip an unreadable file; the rest still process
        }
        uploadProg = { frac: (i + 1) / images.length, index: i, total: images.length };
      }
      controller.onImageProgress = null;
      if (recognized === 0) {
        window.alert(
          'No gems were recognized in that screenshot. Make sure the full gem list is visible and the image is an uncropped game screenshot.'
        );
        return;
      }
      reassembleUploads();
      detectedOwned = { order: orderTarget, chaos: chaosTarget };
      if (totalOrderGems.length > 0) gemListElem?.selectTab(0);
      else if (totalChaosGems.length > 0) gemListElem?.selectTab(1);
      gemListElem?.scroll('bottom');
    } finally {
      controller.onImageProgress = null;
      isProcessingUpload = false;
      uploadProg = null;
    }
  }

  // Single-file entry (paste handler / back-compat).
  const processImageFile = (file: File | null | undefined) => processImageFiles(file ? [file] : []);

  // Clear the upload session (wired to the GemList "Reset" button so the raw shots don't repopulate).
  function resetUploads() {
    orderShots = [];
    chaosShots = [];
    orderTarget = null;
    chaosTarget = null;
    orderAssembly = null;
    chaosAssembly = null;
    totalOrderGems = [];
    totalChaosGems = [];
    detectedOwned = null;
    _prevGem = null;
  }

  // Merge an imported loadout into the working gem lists (same store recognition fills), deduping
  // against gems already present. Returns how many new gems were added.
  function applyImportedGems(result: ImportResult): number {
    let added = 0;
    let addedOrder = false;
    let addedChaos = false;
    for (const gem of result.gems) {
      const list = gem.gemAttr === 'Order' ? totalOrderGems : totalChaosGems;
      if (list.some((g) => isSameArkGridGem(g, gem))) continue;
      list.push(gem);
      added++;
      if (gem.gemAttr === 'Order') addedOrder = true;
      else addedChaos = true;
    }
    if (addedOrder) gemListElem?.selectTab(0);
    else if (addedChaos) gemListElem?.selectTab(1);
    gemListElem?.scroll('bottom');
    return added;
  }

  // Parse a pasted/dropped/bookmarklet-supplied page source and apply the gems it contains.
  function importFromText(text: string, hint?: { region?: string | null; name?: string | null }) {
    const result = parseLoadout(text, hint);
    if (!result) {
      window.alert(
        'That doesn’t look like a lostark.bible or lopec.kr character page. Paste the page source (Ctrl/⌘+U → select all → copy), or drop the saved .html file.'
      );
      return;
    }
    if (result.gems.length === 0) {
      window.alert(
        'No Ark Grid gems found. Make sure the character has an Ark Grid equipped. The “📥 Import Astrogems” bookmarklet is the most reliable way to import (it reads that exact character fresh).'
      );
      return;
    }
    const added = applyImportedGems(result);
    const who = result.name
      ? `${result.name}${result.region ? ` (${result.region})` : ''}`
      : result.source;
    const skipped = result.warnings.length ? ` ${result.warnings.length} skipped.` : '';
    importMsg = `Imported ${added} gem${added === 1 ? '' : 's'} from ${who}.${skipped}`;
  }

  async function onImportDrop(e: DragEvent) {
    e.preventDefault();
    isImportDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      importFromText(await file.text());
      return;
    }
    const text = e.dataTransfer?.getData('text');
    if (text) importFromText(text);
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
  // Switch recognition mode. Activating Upload Screenshot / Import Loadout means the user is NOT
  // screen-sharing, so turn the two capture-only toggles OFF: "Display Sharing Screen" (whose leftover
  // debug canvas sits outside the capture block and would otherwise linger over the upload/import view)
  // and "Prevent Screen Sharing Crash". Clicking the active mode again returns to capture.
  async function selectMode(target: 'upload' | 'import') {
    mode = mode === target ? 'capture' : target;
    if (mode !== 'capture') {
      // Guard on isDebugging so we don't lazily construct the capture controller just to turn debug off
      // (isDebugging is only ever true once a controller already exists).
      if (isDebugging) await toggleDrawDebug();
      appConfig.current.uiConfig.deferredScreenSharingInit = false;
    }
  }
  async function updateControllerDetectionMargin(detectionMargin: number) {
    const controller = await getCaptureController();
    controller.detectionMargin = detectionMargin;
  }
  onMount(() => {
    // Build the bookmarklet against the live app URL, and accept a #import= hand-off from it.
    bookmarklet = buildBookmarklet(location.origin + location.pathname);
    const fromHash = parseImportHash(location.hash);
    if (fromHash) {
      mode = 'import';
      setSection('showGemRecognitionPanel', true);
      importFromText(fromHash.src, { region: fromHash.region, name: fromHash.name });
      // Clear the hash so a refresh doesn't re-import.
      history.replaceState(null, '', location.pathname + location.search);
    }

    // Paste-to-recognize: only acts while the upload panel is open, so it never hijacks paste
    // elsewhere. Reads the first image item off the clipboard and runs it through recognition.
    const onPaste = (e: ClipboardEvent) => {
      if (!showUpload) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void processImageFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);

    // On desktop, warm the recognition worker (download + JIT-compile the OpenCV WASM) shortly
    // after load so the first "Start Screen Sharing" doesn't pay the cold ~5s cost. Deferred to
    // idle so it never competes with first paint; gated on captureSupported so mobile never
    // fetches the 10.8MB CV chunk on load (upload lazy-loads it only when a file is chosen).
    let cancelWarm: (() => void) | undefined;
    if (captureSupported) {
      const warm = () => void getCaptureController().then((c) => c.warmup());
      if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(warm, { timeout: 3000 });
        cancelWarm = () => cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(warm, 1200);
        cancelWarm = () => clearTimeout(id);
      }
    }

    return () => {
      window.removeEventListener('paste', onPaste);
      cancelWarm?.();
    };
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
      <Icon name="circle-info" class="info-icon" />
      <span class="tooltip-text">
        {LSupportedClient}
      </span>
    </span>
    <button
      class="fold-button"
      onclick={() => toggleSection('showGemRecognitionPanel')}
      disabled={isRecording}
      >{sectionUI.showGemRecognitionPanel ? '▼' : '▲'}</button
    >
  </div>
  {#if !captureSupported}
    <p class="unsupported-note">{LUnsupported}</p>
  {/if}
  <div
    class="content"
    style:display={!sectionUI.showGemRecognitionPanel ? 'none' : 'flex'}
  >
    <div class="buttons">
      <div class="left">
        {#if captureSupported && mode === 'capture'}
          {#if !isRecording}
            <button onclick={startGemCapture}>🖥️ {LStartCapture[locale]}</button>
          {:else}
            <button onclick={stopGemCapture}>🖥️ {LStopCapture[locale]}</button>
          {/if}
          <button class:active={isDebugging} aria-pressed={isDebugging} onclick={toggleDrawDebug}>
            🔨 {isDebugging ? LHideScreen[locale] : LShowScreen[locale]}
          </button>
          <button onclick={toggleDeferredScreenSharingInit}>
            {LControllerLazyLoading}
            <Icon
              name={appConfig.current.uiConfig.deferredScreenSharingInit
                ? 'circle-dot'
                : 'circle'}
            />
          </button>
        {/if}
      </div>
      <div class="right">
        <!-- Available to everyone (not gated on captureSupported): static-image recognition is the
             path mobile / Safari / Firefox users have, and a convenience for desktop too. -->
        <button
          class:active={showUpload}
          aria-pressed={showUpload}
          disabled={isRecording}
          onclick={() => selectMode('upload')}
        >
          📷 {LUpload[locale]}
        </button>
        <button
          class:active={showImport}
          aria-pressed={showImport}
          disabled={isRecording}
          onclick={() => selectMode('import')}
        >
          📥 {LImport[locale]}
        </button>
      </div>
    </div>
    {#if showUpload}
      <div
        class="upload-zone"
        class:dragging={isDragging}
        class:busy={isProcessingUpload}
        role="button"
        tabindex="0"
        aria-label={LUpload[locale]}
        aria-busy={isProcessingUpload}
        onclick={() => fileInput?.click()}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput?.click();
          }
        }}
        ondragover={(e) => {
          e.preventDefault();
          isDragging = true;
        }}
        ondragleave={() => (isDragging = false)}
        ondrop={(e) => {
          e.preventDefault();
          isDragging = false;
          void processImageFiles(e.dataTransfer?.files);
        }}
      >
        {#if uploadProg}
          <div class="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProg.frac * 100)}>
            <span class="upload-zone-text">
              {uploadProg.total > 1
                ? `Recognizing screenshot ${Math.min(uploadProg.index + 1, uploadProg.total)} of ${uploadProg.total}…`
                : LUploadProcessing}
              {Math.round(uploadProg.frac * 100)}%
            </span>
            <div class="upload-progress-track">
              <div class="upload-progress-fill" style:width={`${Math.max(3, uploadProg.frac * 100)}%`}></div>
            </div>
          </div>
        {:else}
          <span class="upload-zone-text">{LUploadHint}</span>
        {/if}
        <input
          bind:this={fileInput}
          class="upload-file-input"
          type="file"
          accept="image/*"
          multiple
          onchange={(e) => {
            const input = e.currentTarget;
            void processImageFiles(input.files);
            input.value = '';
          }}
        />
      </div>
      {#if detectedOwned && !orderAssembly && !chaosAssembly && (detectedOwned.order !== null || detectedOwned.chaos !== null)}
        <p class="owned-note">
          📋 Screenshot inventory: Order {detectedOwned.order ?? '?'}, Chaos
          {detectedOwned.chaos ?? '?'} owned
        </p>
      {/if}
    {/if}
    {#if showImport}
      <div class="import-panel">
        <ol class="import-steps">
          <li>
            Drag this to your bookmarks bar, then click it while viewing your character on
            <strong>lostark.bible</strong>. It reads that exact character fresh (no refresh needed):
            <a class="bookmarklet" href={bookmarklet} onclick={(e) => e.preventDefault()}
              >📥 Import Astrogems</a
            >
          </li>
          <li>
            …or drop a saved <strong>.html</strong> of the character page below, or paste its source
            (also works for <strong>lopec.kr</strong> / KR).
          </li>
        </ol>
        <div
          class="upload-zone import-drop"
          class:dragging={isImportDragging}
          role="button"
          tabindex="0"
          aria-label="Drop a saved character page (.html)"
          ondragover={(e) => {
            e.preventDefault();
            isImportDragging = true;
          }}
          ondragleave={() => (isImportDragging = false)}
          ondrop={onImportDrop}
        >
          <span class="upload-zone-text">Drop a saved .html of the character page here</span>
        </div>
        <textarea
          class="import-textarea"
          bind:value={importText}
          placeholder="…or paste the page source here (Ctrl/⌘+U → select all → copy)"
          rows="3"
        ></textarea>
        <button class="import-go" disabled={!importText.trim()} onclick={() => importFromText(importText)}>
          Import from pasted source
        </button>
        {#if importMsg}
          <p class="owned-note">✅ {importMsg}</p>
        {/if}
      </div>
    {/if}
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
        <GemRecognitionGuide {mode}></GemRecognitionGuide>
      </div>
      <RecognizedGemList
        gems={{
          orderGems: totalOrderGems,
          chaosGems: totalChaosGems,
        }}
        assembly={{ order: orderAssembly, chaos: chaosAssembly }}
        onReset={resetUploads}
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

  .upload-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border: 2px dashed var(--text);
    border-radius: 8px;
    padding: 1.5rem 1rem;
    cursor: pointer;
    opacity: 0.85;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      opacity 0.15s ease;
  }
  .upload-zone:hover,
  .upload-zone:focus-visible {
    opacity: 1;
    outline: none;
  }
  .upload-zone.dragging {
    border-color: #22c55e;
    background-color: rgba(34, 197, 94, 0.08);
    opacity: 1;
  }
  .upload-zone.busy {
    cursor: progress;
  }
  .upload-zone-text {
    pointer-events: none;
  }
  .upload-progress {
    pointer-events: none;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }
  .upload-progress-track {
    width: min(100%, 22rem);
    height: 0.5rem;
    border-radius: 0.25rem;
    background-color: var(--card-inner);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .upload-progress-fill {
    height: 100%;
    background-color: var(--primary);
    border-radius: inherit;
    transition: width 0.2s ease;
  }
  .upload-file-input {
    display: none;
  }
  .owned-note {
    margin: 0.4rem 0 0;
    color: var(--text);
    opacity: 0.9;
    font-size: 0.9rem;
  }

  .import-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .import-steps {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .bookmarklet {
    display: inline-block;
    margin-left: 0.25rem;
    padding: 0.1rem 0.55rem;
    border-radius: 0.4rem;
    font-weight: 700;
    text-decoration: none;
    cursor: grab;
    color: #fff;
    background: #2e7d32;
    border: 1px solid #2e7d32;
  }
  .bookmarklet:active {
    cursor: grabbing;
  }
  .import-drop {
    padding: 1rem;
  }
  .import-textarea {
    width: 100%;
    resize: vertical;
    font-family: inherit;
    font-size: 0.85rem;
    padding: 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--text);
    background: var(--card, transparent);
    color: var(--text);
  }
  .import-go {
    align-self: flex-start;
    width: auto;
  }
  .import-go:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  /* Toggle buttons (Upload / Import / debug screen): a filled accent makes the "on" state
     unmistakable, which matters once the Start Screen Sharing button hides on mode switch. */
  .buttons button.active {
    background-color: var(--primary);
    border-color: var(--primary);
    color: #fff;
    font-weight: 600;
  }
  @media (hover: hover) and (pointer: fine) {
    .buttons button.active:hover {
      background-color: var(--primary);
      filter: brightness(1.08);
    }
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
