# Mesh2Motion — integration notes (Bichitos Rumble)

Upstream: https://github.com/Mesh2Motion/mesh2motion-app

This folder is a **copy** of `mesh2motion-app` with three small changes:

1. **`vite.config.js`** — points `outDir` at `../../public/animations/` and
   uses `base: '/animations/'` so the build lands inside the main game's
   `public/` folder. Removed the Cloudflare-specific `PROCESS_ENV`
   define (we don't deploy to Cloudflare Pages).
2. **`src/environment.js`** — no-op replacement for the removed
   `PROCESS_ENV` define. Sets harmless placeholder globals so any UI
   that reads them still finds something.
3. **`src/create.html`, `src/index.html`, `src/retarget/index.html`** —
   Bichitos Rumble banner, `noindex` meta tags, and link back to the
   main game. No changes to the underlying mesh2motion engine logic.

Custom additions (one file, no upstream edits):

- **`src/BichitosRosterPicker.ts`** — standalone module that injects a
  grid of our 9 critters above the load-model tools on `create.html`.
  Uses mesh2motion's existing `#model-selection` + `#load-model-button`
  flow to trigger the load — zero monkey-patching.
- **`scripts/copy-game-assets.mjs`** — pre-dev/pre-build hook that
  mirrors `../public/models/critters/` into `static/models/critters/`
  so the roster picker can fetch the GLBs in both dev and production.

## Usage

```bash
cd mesh2motion
npm install        # once
npm run dev        # localhost:5174 with the animation lab
npm run build      # writes to ../public/animations/ → rebuilt into dist/ by the main game's build
```

From the main game repo's root, the tool ships automatically:

```bash
npm run build      # triggers mesh2motion's build output already copied into public/
```

The deployed URL is `/animations` (rewritten to `/animations/create.html`
by the parent's `vercel.json`).

## Updating from upstream

Manual merge, because we maintain adaptations. Steps:

```bash
# in a scratch folder:
git clone https://github.com/Mesh2Motion/mesh2motion-app.git
# diff against mesh2motion/ here, port interesting upstream changes manually
```

The files we modified are all small and well-localised, so diffing by
hand is viable. Re-run `npm install && npm run build` afterwards.

## License

- Code: MIT (same as upstream).
- Bundled rigs + animations (`static/rigs/`, `static/animations/`):
  CC0 (public domain, courtesy of the Mesh2Motion project).
