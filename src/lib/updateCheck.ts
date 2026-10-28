// Detects that a newer build of the app is live while an old tab is still open. Every merge to main
// redeploys GitHub Pages and replaces the hashed files the app fetches on demand, so an old tab's
// first use of one of them fails: measured 2026-10-28 on a production build, with the Cut Advisor's
// worker file gone the section simply never returned advice and showed no error. Adapted from
// shizukaziye's stale-tab beacon. Framework-free on purpose: the screen-reading code (src/lib/cv,
// no Svelte imports allowed) asks for a check from its worker error paths through this module.

/** Window event a failed on-demand load fires to ask for an immediate update check. */
export const UPDATE_CHECK_EVENT = 'arkgrid:update-check';

/** Ask the app to check now whether a newer build is live (an on-demand file just failed to load). */
export function requestUpdateCheck(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UPDATE_CHECK_EVENT));
}

/** The `src` of every module script tag in an HTML document, in document order. */
export function moduleScripts(html: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src) out.push(src[1]);
  }
  return out;
}

/**
 * True when the deployed page loads a different entry than the one this tab loaded, i.e. a newer
 * build is live. A page with no module scripts (an error page, an empty body) never counts.
 */
export function isNewerBuild(loaded: string[], deployed: string[]): boolean {
  return deployed.length > 0 && deployed.join('\n') !== loaded.join('\n');
}
