# ArkGrid Optimizer

Part of [Lost Ark Tools](https://shotgun175.github.io/). **Live app:**
<https://shotgun175.github.io/LostArk-ArkGrid-Optimizer/>

> **Status: optimizer retired, triage tools live.** Lost Ark's July 2026 update added in-game Ark
> Grid auto equip, so this tool's manual Optimization section was removed in 0.3.0. The surviving
> tools, Gem Triage and Cutting Plan, still work: the game equips gems for you, but it still doesn't
> cut them or decide which to keep.

A client-side web app for Lost Ark's **Ark Grid** astrogem system. It scores every gem you own,
triages which gems to keep or replace, and tells you what to farm and cut next, with on-screen gem
recognition so you don't have to type anything in. An internal combat-power solver supplies the
evidence: verdicts reflect what your current grid and a fully maxed grid would actually slot.

## Features

- **On-screen gem recognition** — reads your astrogem inventory straight from a screenshot via OpenCV
  template matching (runs in a Web Worker; resolution-flexible).
- **Gem Triage** — scores every owned gem (additive quality model), assigns a tier
  (Excellent / Very Good / Good for now / Priority to Replace), and marks each gem **Upgrade / Keep / Remove**
  against the score of your weakest equipped gem. Works for DPS and Support.
- **Cutting Plan** — a forward-looking "what to farm next" advisor. For DPS it surfaces the
  cut / reset / fuse / don't-cut action and pipeline outlook (weeks-to-complete, gold/week, projected cp% gain)
  per gem archetype, driven by your gold-per-1%-damage budget and binding mode. For Support it shows a
  sim-backed relative ranking of which archetypes are best to chase.
- **Multiple character profiles** with local persistence.

## Tech stack

- **Frontend:** Svelte 5 (runes) + TypeScript, Vite
- **Solver (internal):** custom backtracking with upper-bound pruning (TypeScript); it no longer has
  its own UI section and instead supplies the evidence behind Gem Triage and the Cutting Plan
- **Image processing:** OpenCV (template matching) in a Web Worker; the screenshot-upload OCR path
  adds tesseract.js, whose engine + English data are fetched from a CDN (jsdelivr) on first use — the
  only assets not served from the app's own origin
- **Deployment:** GitHub Pages (client-side; no backend or SSR)

## Running locally

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build to dist/
npm run preview    # serve the production build
```

Open the URL the dev/preview server prints (it includes the `/LostArk-ArkGrid-Optimizer/` base path).
Note: opening `dist/index.html` directly from disk won't work — the app uses ES-module workers and absolute
asset paths, so it must be served over HTTP (`npm run dev` or `npm run preview`).

## Tests & checks

```bash
npm run test:unit  # pure-logic unit tests (Vitest)
npm run test:cv    # OpenCV-dependent tests (run via tsx; Vitest hangs on the WASM bundle)
npm run test       # both of the above
npm run check      # svelte-check + tsc type checking
npm run knip       # advisory: reports orphaned exports / files / dependencies (not a CI gate)
```

## Data generators

Some data modules are generated at build time and committed:

```bash
npm run generate:sprite   # OpenCV template sprites + coordinate maps
npm run generate:pipeline # Cutting-plan dataset (DPS + Support) -> src/lib/cutplan/pipeline.json
```

Note: `generate:pipeline` reads shizukaziye's `astrogem-calculator` pipeline data
(`data/pipeline.json` + `data/pipeline-support.json`) from under `Reference Projects/`, third-party
content that is deliberately **not** tracked — the command only runs on a machine that has it. The
committed `pipeline.json` (his exact Bellman-DP, real % damage, used with attribution) carries a
`_provenance` block (each source's sha256 + date) so it stays auditable.

## Deployment

Deployment is automated by GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)):
every push to `main` builds the app from a fresh checkout and publishes `dist/` to GitHub Pages. It can
also be triggered on demand from the repository's **Actions** tab. There is no manual publish step.

The Vite `base` is `/LostArk-ArkGrid-Optimizer/` and must match the GitHub repository name, otherwise the
published assets 404.

## Assumptions, scope & open questions

A fan project that models a live game; here's what's been checked, what hasn't, and where the
boundaries are.

**Confirmed**

- **On-screen recognition is resolution-flexible.** Real English-client screenshots read identically
  across setups — 2560×1440 (forced 21:9 and 16:9) and 1920×1080 windowed all gave 9/9 gems, the
  Chaos tab read 9/9, and locale + Order/Chaos attribute auto-detected.
- **Solver pruning is exact.** A single astrogem contributes at most 5 will-points and a core holds
  at most 4 gems, so the branch-and-bound's upper bounds never discard a reachable best loadout.
- **One scoring scale for both roles.** DPS and Support gems are scored on the same willpower/point
  base (only the option coefficients differ), which is what lets the Cutting Plan apply one
  EV-based cut/reset/keep rule to both. The exact coefficients are listed in-app under
  **Assumptions / Tuning**.

**Open questions / not yet verified**

- **True 4K (3840×2160) and real ultrawide monitors.** Designed for (they reuse the same scale-snap
  mechanism) but not yet confirmed against actual captures.
- **Windowed sizes between resolution tiers** fall back to a raw measured scale (±~1–2%) and aren't
  stress-tested.
- **Support cut-value rate.** `SUPPORT_VALUE_RATE = 1.0` treats one Support score-point as worth one
  DPS score-point — a deliberate, tunable assumption, not an empirically pinned number.
- **Duplicate-heavy inventories.** A scrolled capture with many identical gems can over-count; enter
  those manually if a count looks off.

**Out of scope**

- **Recognition is desktop-only** (it needs screen capture + the OpenCV bundle). On mobile the
  recognition step is hidden and you enter gems by hand; gem triage and the cutting plan still work.
- **No accounts or cloud sync** — profiles live only in your browser's local storage.
- **Not a rotation/DPS simulator** — gems are valued by the in-game combat-power formula, not a
  full damage simulation.

**Disclaimer:** an unofficial, fan-made tool, not affiliated with or endorsed by Smilegate or Amazon
Games. "Lost Ark" and all related names and assets belong to their respective owners.

## License

MIT — see [LICENSE](LICENSE). All game-related assets are property of their respective owners.
