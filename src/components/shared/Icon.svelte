<script lang="ts">
  // Inline replacements for the handful of Font Awesome glyphs the app used.
  // Self-drawn (no FA licensing/attribution needed); sized with 1em +
  // currentColor so existing font-size/color styling keeps working.
  export type IconName = 'circle-info' | 'circle' | 'circle-dot' | 'toggle-on' | 'toggle-off';
  let { name, class: className = '' }: { name: IconName; class?: string } = $props();
</script>

<svg
  class={className}
  viewBox="0 0 24 24"
  width="1em"
  height="1em"
  fill="currentColor"
  aria-hidden="true"
>
  {#if name === 'circle-info'}
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="12" cy="7.5" r="1.6" />
    <rect x="10.8" y="10.5" width="2.4" height="7.5" rx="1.2" />
  {:else if name === 'circle'}
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
  {:else if name === 'circle-dot'}
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="12" cy="12" r="4.5" />
  {:else if name === 'toggle-on'}
    <path
      fill-rule="evenodd"
      d="M7 6h10a6 6 0 0 1 0 12H7A6 6 0 0 1 7 6zm10 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"
    />
  {:else if name === 'toggle-off'}
    <rect x="2" y="7" width="20" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2" />
    <circle cx="7.5" cy="12" r="3" />
  {/if}
</svg>

<style>
  svg {
    vertical-align: -0.125em; /* match FA's baseline alignment */
  }
</style>
