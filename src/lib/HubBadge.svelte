<!-- Synced from shotgun175.github.io/snippets/hub-badge.html
     (local change: font stacks use the app's shipped Inter/JetBrains Mono
     instead of the hub's Cinzel/IBM Plex Mono, which this app never loads). -->
<a class="lat-badge" href="https://shotgun175.github.io/" target="_blank" rel="noopener"
   aria-label="Part of Lost Ark Tools — see all tools">
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#0a0b13"/>
    <g stroke="#54d8d2" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round">
      <path d="M9 9h14M9 16h14M9 23h14M9 9v14M16 9v14M23 9v14"/></g>
    <circle cx="16" cy="16" r="4.4" fill="#f0b94d"/>
  </svg>
  <span class="lat-badge__text">
    <span class="lat-badge__kicker">Part of</span>
    <span class="lat-badge__name">Lost Ark Tools</span>
  </span>
  <svg class="lat-badge__arrow" width="18" height="18" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6"/></svg>
</a>

<style>
  .lat-badge { display:inline-flex; align-items:center; gap:10px; min-height:44px; padding:9px 14px;
    border:1px solid rgba(240,185,77,.45); border-radius:10px; background:#14172a; color:#ece8df;
    text-decoration:none; font-family:"JetBrains Mono",ui-monospace,Consolas,monospace; }
  .lat-badge:hover { border-color:#f0b94d; }
  .lat-badge:focus-visible { outline:2px solid #54d8d2; outline-offset:3px; }
  .lat-badge__text { display:flex; flex-direction:column; }
  .lat-badge__kicker { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:#aab0d2; }
  .lat-badge__name { font-family:"Inter",system-ui,sans-serif; font-size:14px; font-weight:600; color:#f0b94d; }
  .lat-badge__arrow { color:#54d8d2; }
</style>
