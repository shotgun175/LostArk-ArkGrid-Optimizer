# Deprecation runbook

## Why

Lost Ark is adding Ark Grid optimization as a built-in game feature. Once it ships, this fan tool is
superseded and there's no reason to keep maintaining it. This document is the plan for sunsetting it
gracefully — without deleting anything or breaking links for people who bookmarked or linked the app.

## Current state — pre-deprecation (soft notice live)

- **Phase:** PRE-DEPRECATION. A soft, future-tense heads-up is live; nothing is retired yet.
- **Official retirement date:** not yet announced.
- **In-app banner:** soft and **dismissible**, driven by [`src/lib/deprecation.ts`](src/lib/deprecation.ts)
  (`STATUS = 'pending'`).
- **README:** carries a short "winding down" note at the top.
- **Everything still works** — the app is fully functional.

## Pull the trigger (when the official date is announced)

Do these in order. Steps 1–5 ship the retirement state to the live app; steps 6–8 close the repo out.

1. [ ] **Flip the flag.** In [`src/lib/deprecation.ts`](src/lib/deprecation.ts):
   - `STATUS = 'retired'`
   - `RETIREMENT_DATE = '<Month DD, YYYY>'`

   That single change swaps the banner to the hard, non-dismissible retirement notice everywhere.
2. [ ] **Update the README top note** from "winding down" to retired/past tense (and add the date).
3. [ ] *(Optional)* Update `index.html` `<meta name="description">` / `og:description` to mention the
       retirement, so search/social cards reflect it.
4. [ ] **Open a PR from a branch, merge to `main`.** CI (`.github/workflows/deploy.yml`) auto-builds and
       publishes to GitHub Pages — the live app now shows the retirement banner. No manual deploy step.
5. [ ] **Bump the version** in `package.json` for the retirement release (e.g. `1.0.0`).
6. [ ] **Cut a final GitHub release/tag** (e.g. `v1.0.0`, titled "Final") so the last working build is
       pinned and downloadable after the repo is archived.
7. [ ] **Close open issues / PRs** with a short canned note linking back to this file.
8. [ ] **Archive the repository:** GitHub → **Settings → Archive this repository**. This makes it
       read-only (no new issues/PRs/commits) and shows a clear "archived" banner, while keeping it
       **public and cloneable**. Do this *last* — archiving blocks the steps above.
9. [ ] **Relabel/remove the hub entry** on [Lost Ark Tools](https://shotgun175.github.io/) so the hub
       doesn't keep funneling users to a retired tool.

## Decisions already made

- **Keep the live site up, with the retirement banner — don't take it down.** GitHub Pages is free, so
  there's no cost pressure, and a graceful sunset (banner on a still-loading app) beats a 404 for
  anyone who has it bookmarked or linked.
- **Archive the repo; do NOT delete it.** Deletion is destructive and irreversible — it loses the
  commit history, stars, inbound links, forks, and the credit for having solved this before the game
  did. Archiving signals "done, not abandoned" and costs nothing to keep.
