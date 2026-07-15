<script lang="ts">
  import type { CharacterProfile } from '../lib/state/profile.state.svelte';
  import ArkGridAllGemListPanel from './ArkGridAllGemListPanel.svelte';
  import ArkGridCoreEditPanel from './ArkGridCoreEditPanel.svelte';

  interface Props {
    profile: CharacterProfile | null;
  }
  let { profile = $bindable() }: Props = $props();
</script>

{#if profile}
  <div id="sec-build" class="dual-panel">
    <div>
      <ArkGridCoreEditPanel {profile} />
    </div>
    <div>
      <ArkGridAllGemListPanel gems={profile.gems} />
    </div>
  </div>
{/if}
