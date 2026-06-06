<script lang="ts">
  import { onMount } from 'svelte';

  import BuildViewSwitch from './BuildViewSwitch.svelte';

  // Section anchors are rendered in App.svelte / CharacterProfileEditor.svelte with these ids.
  const sections = [
    { id: 'sec-profile', label: 'Profile' },
    { id: 'sec-recognition', label: 'Recognition' },
    { id: 'sec-build', label: 'Cores & Gems' },
    { id: 'sec-optimize', label: 'Optimization' },
    { id: 'sec-triage', label: 'Gem Triage' },
    { id: 'sec-cutplan', label: 'Cutting Plan' },
  ];

  let active = $state<string>(sections[0].id);

  function go(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  onMount(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((e): e is HTMLElement => e !== null);
    // A section becomes "active" once it reaches the top ~30% of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) active = e.target.id;
        }
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  });
</script>

<nav class="section-nav" aria-label="Section navigation">
  <div class="nav-heading">Sections</div>
  {#each sections as s, i}
    <button class="nav-link" class:active={active === s.id} onclick={() => go(s.id)}>
      <span class="nav-num">{i + 1}</span>
      <span class="nav-label">{s.label}</span>
    </button>
  {/each}
  <div class="nav-switch"><BuildViewSwitch compact /></div>
</nav>

<style>
  .section-nav {
    position: sticky;
    top: 1rem;
    align-self: flex-start;
    box-sizing: border-box;
    /* Fixed width so the build view switch can't widen the rail and shove the panels right. */
    flex: 0 0 var(--nav-width, 13rem);
    width: var(--nav-width, 13rem);
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    /* Neutral card; gold text on top. Only the selected item gets a blue background. */
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 0.6rem;
  }
  .nav-heading {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #b8860b;
    padding: 0.1rem 0.4rem 0.5rem;
    margin-bottom: 0.25rem;
    border-bottom: 1px solid var(--border);
  }
  :global(.dark-mode) .nav-heading {
    color: #f0c040;
  }
  /* Build view switch sits below the links with a divider — but only when it actually renders
     (i.e. dual-role); collapse to nothing otherwise so there's no empty gap. */
  .nav-switch {
    margin-top: 0.4rem;
    padding: 0.5rem 0.2rem 0.1rem;
    border-top: 1px solid var(--border);
  }
  .nav-switch:not(:has(*)) {
    display: none;
  }
  .nav-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    text-align: left;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    padding: 0.4rem 0.5rem;
    border-radius: 0.4rem;
    font-size: 0.9rem;
    /* Gold to match the heading / glossary theme. */
    color: #b8860b;
    opacity: 0.8;
  }
  :global(.dark-mode) .nav-link {
    color: #f0c040;
  }
  /* Plain gold number, matching the link text. */
  .nav-num {
    flex: 0 0 auto;
    min-width: 1.1rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 0.8rem;
    color: #b8860b;
  }
  :global(.dark-mode) .nav-num {
    color: #f0c040;
  }
  .nav-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-link:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .nav-link.active {
    opacity: 1;
    font-weight: 700;
    border-left-color: #2f6fed;
    background: rgba(47, 111, 237, 0.24);
  }
  :global(.dark-mode) .nav-link.active {
    border-left-color: #5aa1ff;
    background: rgba(90, 161, 255, 0.22);
  }
  /* Below the dual-panel breakpoint there's no room for a side rail. */
  @media (max-width: 960px) {
    .section-nav {
      display: none;
    }
  }
</style>
