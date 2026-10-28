// The "new version available" notice: watches for a newer deployed build (see lib/updateCheck.ts)
// by fetching index.html uncached and comparing its module script tags with this page's.
import { UPDATE_CHECK_EVENT, isNewerBuild, moduleScripts } from '../updateCheck';

const TICK_MS = 30 * 60_000; // re-check this often while the tab is visible
const FOCUS_GAP_MS = 5 * 60_000; // players alt-tab constantly; a refocus re-checks at most this often
const FAILURE_GAP_MS = 30_000; // a failing worker can error on every use

/** Set once a newer build is live. Dismissing hides the notice until the next reload. */
export const updateNotice = $state({ available: false, dismissed: false });

/** Start watching for a newer build; returns the cleanup. A no-op on the dev server. */
export function startUpdateWatch(): () => void {
  if (import.meta.env.DEV) return () => {};
  const loaded = [...document.querySelectorAll('script[type="module"][src]')].map(
    (s) => s.getAttribute('src') ?? ''
  );
  let lastFocus = Date.now();
  let lastFailure = 0;
  const check = async () => {
    if (updateNotice.available) return;
    try {
      const res = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
      if (res.ok && isNewerBuild(loaded, moduleScripts(await res.text())))
        updateNotice.available = true;
    } catch {
      // Offline or blocked: the next refocus or tick tries again.
    }
  };
  const onFocus = () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastFocus < FOCUS_GAP_MS) return;
    lastFocus = Date.now();
    void check();
  };
  const onTick = () => {
    if (document.visibilityState !== 'visible') return;
    lastFocus = Date.now();
    void check();
  };
  // A worker or lazily loaded file failed: check right away (a deploy is the usual cause).
  const onFailure = () => {
    if (Date.now() - lastFailure < FAILURE_GAP_MS) return;
    lastFailure = Date.now();
    void check();
  };
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener(UPDATE_CHECK_EVENT, onFailure);
  window.addEventListener('vite:preloadError', onFailure);
  const timer = setInterval(onTick, TICK_MS);
  return () => {
    document.removeEventListener('visibilitychange', onFocus);
    window.removeEventListener(UPDATE_CHECK_EVENT, onFailure);
    window.removeEventListener('vite:preloadError', onFailure);
    clearInterval(timer);
  };
}
