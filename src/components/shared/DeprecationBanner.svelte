<script lang="ts">
  import { DEPRECATION } from '../../lib/deprecation';
</script>

<!-- Renders only when the whole tool is retired (deprecation.ts STATUS = 'retired');
     the notice is the primary message then, so it is always visible and not dismissible. -->
{#if DEPRECATION.show}
  <div class="dep-banner" role="alert">
    <svg class="dep-banner__icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
    <p class="dep-banner__text">{DEPRECATION.message}</p>
  </div>
{/if}

<style>
  .dep-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 2.75rem;
    border: 1px solid rgba(224, 122, 95, 0.5);
    border-left: 4px solid #e07a5f;
    border-radius: 10px;
    background: #14172a;
    color: #ece8df;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .dep-banner__icon {
    flex: 0 0 auto;
    color: #e07a5f;
  }
  .dep-banner__text {
    margin: 0;
    flex: 0 1 auto;
    text-align: center;
  }
</style>
