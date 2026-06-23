# ArkGrid Optimizer

Part of [Lost Ark Tools](https://shotgun175.github.io/). **Live app:**
<https://shotgun175.github.io/LostArk-ArkGrid-Optimizer/>

> **Status: winding down.** Lost Ark is introducing built-in Ark Grid optimization, which will
> supersede this fan tool. The live app and this repository will be retired once the in-game feature
> ships; until then everything still works.

An Ark Grid combat-power optimizer: a fully client-side web app for Lost Ark's **Ark Grid** astrogem
system. It finds the highest-combat-power gem loadout from the gems you own, triages which gems to keep
or replace, and tells you what to farm next — with on-screen gem recognition so you don't have to type
anything in.

## Features

- **Loadout optimizer** — searches for the best 6-core astrogem loadout from your owned gems (custom
  backtracking solver with upper-bound pruning), and shows the equipped result + a swap guide.
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
- **Solver:** custom backtracking with upper-bound pruning (TypeScript)
- **Image processing:** OpenCV (template matching) in a Web Worker
- **Deployment:** GitHub Pages (fully client-side)

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
```

## Data generators

Some data modules are generated at build time and committed:

```bash
npm run generate:sprite             # OpenCV template sprites + coordinate maps
npm run generate:pipeline           # DPS cutting-plan table -> src/lib/cutplan/pipelineTable.json
npm run generate:support-cutquality # Support single-cut quality data -> src/lib/cutplan/supportCutQuality.json
```

Note: `generate:pipeline` reads `Reference Projects/astrogem-pipeline-table-main/index.html`, a
third-party reference table that is deliberately **not** tracked — the command only runs on a machine
that has it. The committed `pipelineTable.json` carries a `_meta` block (input sha256 + date) so it
stays auditable. `generate:support-cutquality` is fully self-contained and deterministic (seeded RNG);
CI regenerates it and fails on drift.

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
  recognition step is hidden and you enter gems by hand; the optimizer, triage, and cutting plan all
  still work.
- **No accounts or cloud sync** — profiles live only in your browser's local storage.
- **Not a rotation/DPS simulator** — loadouts are ranked by the in-game combat-power formula, not a
  full damage simulation.

**Disclaimer:** an unofficial, fan-made tool, not affiliated with or endorsed by Smilegate or Amazon
Games. "Lost Ark" and all related names and assets belong to their respective owners.

## License

MIT — see [LICENSE](LICENSE). All game-related assets are property of their respective owners.
