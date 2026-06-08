<script lang="ts">
  import type { LocalizationName } from '../../lib/constants/enums';
  import { appLocale } from '../../lib/state/locale.state.svelte';

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
    {#if true}
      <div class="content">
        <p>
          1. Open an Astrogem list and unequip all.<br />
          You can switch to an unused Ark Grid preset to quickly unequip all astrogems.
        </p>
        <p>2. Press the [🖥️ Start Screen Sharing] button to share your Lost Ark game screen.</p>
        <p>3. Scroll down and check that recognized astrogems are being added to the list.</p>
        <p>
          4. Verify the total number of collected astrogems. Once <b
            >all Order and Chaos astrogems</b
          >
          have been collected, click the [✅ Apply to Current Profile] button to save them to your profile.
        </p>
        <br />
        <h2>FAQ</h2>
        <p>
          Q. I get a message saying screen sharing failed or was denied.<br />
          A. Please use Chrome or Edge browser.
        </p>
        <p>
          Q. The first recognition takes a few seconds.<br />
          A. Unlike the original (which assumes 1920×1080), this tool auto-detects your screen
          resolution before it locks on, so the initial lock is a few seconds slower. Once it locks,
          scrolling and switching between Order and Chaos update quickly.
        </p>
        <p>
          Q. Astrogems are not being recognized.<br />
          A. Press the [🔨 Display Shared Screen] and check the following:
        </p>
        <ol>
          <li>Make sure the game screen is updating properly.</li>
          <li>
            If the area used to extract astrogem options does not match the actual screen, switch
            the game to "windowed mode". Unlike the original, this tool auto-detects common 16:9
            resolutions (1920×1080, 2560×1440, 3840×2160) and most in-between window sizes, so you
            do not have to use 1920×1080 specifically — but if you are using "Force 21:9 Aspect
            Ratio", please disable it.
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
        <p>Alternatively, you can contact us via Discord in the site footer.</p>
      </div>
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
  /* .guide img {
    max-width: 100%;
    height: auto;
    display: block;
  } */
</style>
