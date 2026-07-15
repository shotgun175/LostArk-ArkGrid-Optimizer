<script lang="ts">
  import type { LocalizationName } from '../../lib/constants/enums';
  import { RELAXED_MIN_OVERLAP } from '../../lib/cv/stitch';
  import { appLocale } from '../../lib/state/locale.state.svelte';

  // The Guide mirrors the active recognition mode so its steps match the button the user picked.
  let { mode = 'capture' }: { mode?: 'capture' | 'upload' | 'import' } = $props();

  const LTitle: LocalizationName = {
    en_us: 'Guide',
  };
  let locale = $derived(appLocale.current);
</script>

<div class="guide">
  <div class="title">
    <span>🎓️ {LTitle[locale]}</span>
  </div>
  <div class="content">
    {#if mode === 'upload'}
      <h2>Upload screenshots</h2>
      <p>1. Open your Astrogem list in game, full screen and uncropped.</p>
      <p>
        2. Take a screenshot. If the list is longer than one screen, scroll down and take more.
        <b>Make sure at least {RELAXED_MIN_OVERLAP} gems overlap between consecutive screenshots</b>
        so they can be linked, and keep the bottom <b>"Astrogems Owned"</b> count visible in at
        least one shot.
      </p>
      <p>
        3. Upload them all together (drag, paste with Ctrl/⌘+V, or click to choose), or one at a
        time. Either way, and in any order, they are stitched into one inventory and de-duplicated
        using the owned count as a checksum.
      </p>
      <p>4. Check the totals, then click [✅ Apply to Current Profile] to save them.</p>
      <br />
      <h2>FAQ</h2>
      <p>
        Q. It says the screenshots did not all link.<br />
        A. Some screenshots do not share enough gems for the tool to tell how they fit together.
        Re-take them so at least {RELAXED_MIN_OVERLAP} gems repeat between scrolls, and keep the
        "Astrogems Owned" footer visible so the total can be checked.
      </p>
      <p>
        Q. Which clients work?<br />
        A. Any client and language. The gems are read by their shapes, not by matching one client's
        exact text.
      </p>
    {:else if mode === 'import'}
      <h2>Import a loadout</h2>
      <p>
        Bring your equipped Ark Grid over from lostark.bible or lopec.kr. No screen sharing and no
        server are involved; the gems are read from the page you supply.
      </p>
      <p>
        The <b>📥 Import Astrogems bookmarklet</b> (in the panel above) is the most reliable way: it
        reads that exact character fresh. You can also drop a saved <b>.html</b> of the character
        page, or paste its source.
      </p>
      <p>
        This imports only the gems your character has <b>equipped</b>, so it is a quick way to seed
        your gem list without screenshots.
      </p>
    {:else}
      <h2>Live screen sharing</h2>
      <p>
        1. Open an Astrogem list and unequip all.<br />
        You can switch to an unused Ark Grid preset to quickly unequip all astrogems.
      </p>
      <p>
        2. Press the [🖥️ Start Screen Sharing] button to share your Lost Ark game screen.<br />
        <b>On an ultrawide / forced 21:9 screen</b>, toggle [Forced 21:9] on before sharing so
        recognition primes the right scale right away. On a standard 16:9 screen, leave it off —
        recognition still adapts on its own, just a moment slower to lock on.
      </p>
      <p>3. Scroll down and check that recognized astrogems are being added to the list.</p>
      <p>
        4. Verify the total number of collected astrogems. Once <b>all Order and Chaos astrogems</b>
        have been collected, click the [✅ Apply to Current Profile] button to save them to your profile.
      </p>
      <br />
      <h2>FAQ</h2>
      <p>
        Q. I get a message saying screen sharing failed or was denied.<br />
        A. Please use Chrome or Edge browser, or use [📷 Upload Screenshot] instead.
      </p>
      <p>
        Q. Astrogems are not being recognized.<br />
        A. Press the [🔨 Display Shared Screen] and check the following:
      </p>
      <ol>
        <li>Make sure the game screen is updating properly.</li>
        <li>
          Recognition adapts to your resolution and aspect ratio automatically — standard 16:9,
          ultrawide / forced 21:9, and windowed all work, so you no longer need to switch the game to
          windowed mode. If a region still looks misaligned, use [📷 Upload Screenshot], which reads
          gems from a screenshot on any client.
        </li>
        <li>
          If parts of the extraction area are highlighted in red, try increasing the “Recognition
          Tolerance Range” slider at the top.
        </li>
        <li>
          Scroll while keeping the mouse cursor positioned over the scrollbar, so it does not
          interact with the astrogems.
        </li>
      </ol>
    {/if}
  </div>
</div>

<style>
  .guide {
    border: 1px solid var(--border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    border-radius: 0.4rem;
    background-color: var(--card-inner);
    padding: 1rem;
    width: 100%;
    box-sizing: border-box;
    gap: 10px;
    display: flex;
    flex-direction: column;
  }
  .guide > .title {
    font-weight: 700;
    font-size: 1.4rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
</style>
