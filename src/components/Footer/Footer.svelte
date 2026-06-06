<script lang="ts">
  import { onMount } from 'svelte';

  import Credit from './Credit.svelte';
  import Policy from './Policy.svelte';
  import Terms from './Terms.svelte';

  onMount(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css';
    link.crossOrigin = 'anonymous';
    link.referrerPolicy = 'no-referrer';
    document.head.appendChild(link);
  });

  let dialog = $state<HTMLDialogElement>();
  type Footers = 'credit' | 'policy' | 'terms';
  let currentFooter = $state<Footers | null>(null);
  const footerLabels: Record<Footers, string> = {
    credit: 'Credits',
    policy: 'Privacy Policy',
    terms: 'Terms',
  };

  const openDialong = (component: Footers) => {
    currentFooter = component;
    if (dialog) dialog.showModal();
  };

  const closeDialog = () => {
    if (dialog) dialog.close();
    currentFooter = null;
  };
</script>

<dialog
  class="footer-dialog"
  bind:this={dialog}
  aria-label={currentFooter ? footerLabels[currentFooter] : undefined}
  onclose={closeDialog}
  onclick={(e) => {
    if (e.target === dialog) closeDialog();
  }}
>
  {#if currentFooter === 'credit'}
    <Credit />
  {:else if currentFooter === 'policy'}
    <Policy />
  {:else if currentFooter === 'terms'}
    <Terms />
  {/if}
</dialog>

<div class="container">
  <a class="footer-link" href="#credits" onclick={() => openDialong('credit')}>Credits</a>

  <a class="footer-link" href="#privacy" onclick={() => openDialong('policy')}>Privacy Policy</a>

  <a class="footer-link" href="#terms" onclick={() => openDialong('terms')}>Terms</a>
</div>

<style>
  .container {
    font-size: 0.8rem;
    display: flex;
    flex-direction: row;
    text-align: center;
    justify-content: center;
    align-items: center;
    gap: 1rem;
  }
  .footer-dialog {
    width: 20rem;
  }
  .footer-link {
    color: #9ca3af; /* subtle gray */
    text-decoration: none; /* remove underline */
    cursor: pointer;
  }
</style>
