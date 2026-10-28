<script lang="ts">
  // One-line hint beside a "Gold / 1% damage" select: when the profile's imported combat power
  // suggests a different bracket than the one in use, say so and offer to apply it. It never changes
  // the bracket on its own (a bracket the user picked is never overridden); only the button does.
  import { bracketLabel } from '../../lib/cutplan/cutPlan';
  import { formatCombatPower, suggestGoldBracket } from '../../lib/cutplan/goldBracket';
  import type { GoldBracket } from '../../lib/cutplan/types';
  import { type CharacterProfile, updateGoldPer1Pct } from '../../lib/state/profile.state.svelte';

  let { profile, bracket }: { profile: CharacterProfile; bracket: GoldBracket } = $props();

  let suggested = $derived(suggestGoldBracket(profile.combatPower));
</script>

{#if profile.combatPower != null && suggested && suggested !== bracket}
  <p class="gb-hint">
    <span>
      Combat power {formatCombatPower(profile.combatPower)} suggests {bracketLabel(suggested)}
    </span>
    <button type="button" class="gb-apply" onclick={() => updateGoldPer1Pct(suggested!)}>
      Use {bracketLabel(suggested)}
    </button>
  </p>
{/if}

<style>
  /* Colors inherit from the host panel, so the hint reads at the same contrast as its text. */
  .gb-hint {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    font-size: 0.8rem;
    color: inherit;
  }
  .gb-apply {
    /* 44px min touch target, the project's standard for small controls. */
    min-height: 2.75rem;
    padding: 0.15rem 0.6rem;
    border: 1px solid currentColor;
    border-radius: 0.35rem;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .gb-apply:hover {
    background: rgba(127, 127, 127, 0.18);
  }
  .gb-apply:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
</style>
