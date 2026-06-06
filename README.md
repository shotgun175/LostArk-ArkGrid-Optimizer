# Ark Grid Combat Power Optimizer

A fully client-side web app for Lost Ark's **Ark Grid** astrogem system. It finds the highest-combat-power
gem loadout from the gems you own, triages which gems to keep or replace, and tells you what to farm next —
with on-screen gem recognition so you don't have to type anything in.

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

## Deployment

Deployed to GitHub Pages from the built `dist/`:

```bash
npm run build
npm run deploy     # publishes dist/ to the gh-pages branch
```

The Vite `base` is `/LostArk-ArkGrid-Optimizer/` and must match the GitHub repository name, otherwise the
published assets 404.

## License

MIT — see [license.txt](license.txt). All game-related assets are property of their respective owners.
