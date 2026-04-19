# Mesh2Motion integration — Bichitos Rumble animation lab

This folder contains a light fork of
[`Mesh2Motion/mesh2motion-app`](https://github.com/Mesh2Motion/mesh2motion-app)
(MIT code, CC0 art) adapted to serve as the animation pipeline for
Bichitos Rumble. In production it ships at
[`/animations`](https://www.bichitosrumble.com/animations) on the main
domain, co-deployed with the game via Vercel.

## What it's for

The rule is simple: **use it to rig and animate the 9 playable critters
of Bichitos Rumble, and nothing else.** The UI has been stripped of the
upstream Explore / Use-Your-Model / Use-Your-Rigged-Model navigation.
The upstream "Upload" button is hidden. The reference-model dropdown is
hidden. All that's left is a Bichitos Rumble roster grid that drives the
underlying mesh2motion engine.

## User flow (end to end)

1. Go to [`/animations`](https://www.bichitosrumble.com/animations).
   You land on `create.html` (the only built entry). The red "INTERNAL"
   banner at the top confirms you're on the lab.
2. **Pick a critter** from the Bichitos Rumble roster grid. One click
   does three things in sequence:
   - Adds an `<option>` to mesh2motion's `#model-selection` dropdown
     pointing at `models/critters/<id>.glb`.
   - Triggers mesh2motion's normal `#load-model-button` path to load it.
   - Waits for the skeleton step to populate and preselects the
     suggested rig for that critter (see table below).
3. **Fit the skeleton** inside the mesh. This is the standard
   mesh2motion UI — drag bones, bind pose, etc.
4. **Pick animations** from the library on the right panel.
5. **Export**. Mesh2Motion exports a GLB with all selected animations
   embedded. We intercept the hidden download link's `download`
   attribute and rewrite it to `<id>.glb` so the browser's save dialog
   already suggests the game-ready filename.
6. A yellow toast pops up with the exact destination path:
   `public/models/critters/<id>.glb`. Save the file there in the game
   repo. The game's `SkeletalAnimator` picks up the clips
   automatically on next load.

## Suggested rig per critter

Encoded in `src/BichitosRosterPicker.ts`. The tooltip on each card
explains the reasoning. Cards are ordered by rig match quality so you
tackle the easy cases first.

| Critter | Rig suggested | Notes |
|---|---|---|
| **Sergei** (gorilla) | `human` | ⭐ clean match |
| **Kurama** (fox) | `fox` | ⭐ direct |
| **Cheeto** (tiger) | `fox` | ⭐ both quadruped felines |
| **Kowalski** (penguin) | `bird` | 🟡 try `human` if `bird` feels limited |
| **Trunk** (elephant) | `kaiju` | 🟡 closest heavy quadruped |
| **Sebastian** (crab) | `spider` | 🟡 multi-leg arthropod |
| **Shelly** (turtle) | `kaiju` | ⚠️ weak match — consider Tripo Animate |
| **Kermit** (frog) | `human` | ⚠️ forced — consider Tripo Animate |
| **Sihans** (mole) | `human` | ⚠️ forced — consider Tripo Animate |

The last three don't have a morphology-appropriate rig in Mesh2Motion's
library. For those, Tripo Animate (an external tool — not integrated
here) will give significantly better results.

## Signature moves not covered

Moves like Trunk Grip, Shelly Shell Shield, Cheeto Shadow Step,
Kurama Copycat, Kermit Hypnosapo, Sihans Diggy Diggy Hole, Kowalski
Snowball, Sebastian Claw Sweep — none of them exist as stock
animations in any auto-rigger library (not even Mesh2Motion's).

The pragmatic plan: import a nearby stock clip (e.g. `attack` on
kaiju as Trunk's Ram base pose) and build the signature on top with
in-engine VFX + gameplay code. Cascadeur (AI-assisted keyframing) is
a fallback for the clips that really need custom authoring.

## Architecture

### Subpackage layout

```
mesh2motion/
  package.json                 ← own deps (three@0.183, file-saver, jszip,
                                  tippy, vite-plugin-glsl). Isolated from
                                  the main game's package.json.
  vite.config.js               ← base '/animations/', outDir
                                  '../../public/animations', only create.html
                                  is a build entry
  scripts/
    copy-game-assets.mjs       ← prebuild / predev: mirrors
                                  ../public/models/critters/ into
                                  static/models/critters/ so the roster
                                  picker works in both dev and prod
  src/
    create.html                ← adapted entry: banner + noindex + CSS
                                  overrides that hide the upstream nav,
                                  upload button, and reference-model
                                  dropdown. Only the settings dropdown
                                  stays in the top bar
    BichitosRosterPicker.ts    ← Bichitos-specific UI. Roster grid,
                                  click → load + suggest rig, export
                                  filename override, post-export toast
    environment.js             ← no-op replacement for the upstream
                                  Cloudflare-build globals
    index.html                 ← upstream Explore page. Source kept for
                                  diffing upstream merges, but NOT built
    retarget/                  ← upstream Retarget flow. Same deal: kept
                                  for upstream diff, NOT built
    Mesh2MotionEngine.ts       ← upstream engine, zero edits
    lib/                       ← upstream library, zero edits
  static/                      ← CC0 rigs + animations (shipped as-is)
```

### Edits vs upstream (total: 4 files)

1. **`vite.config.js`** (5 lines changed):
   - `base: '/animations/'`
   - `outDir: '../../public/animations'`
   - Only `create` as build input (dropped `main` + `retarget`)
   - Dropped `PROCESS_ENV` define (no Cloudflare Pages)
   - Dev port 5174 so the game at 5173 and the lab can run side-by-side
2. **`src/environment.js`**: 2-line file, returns string constants
   instead of reading the Cloudflare-only `PROCESS_ENV` define.
3. **`src/create.html`**: added banner + noindex metas + one inline
   `<style>` block with CSS overrides that hide the upstream nav items
   and the upload/reference-model controls we don't want exposed.
4. **`src/BichitosRosterPicker.ts`**: new 350-line file, our entire
   adaptation layer. Hooks into upstream DOM via `#model-selection`,
   `#load-model-button`, `#export-button`, `#download-hidden-link` —
   no JS-level monkey-patching of mesh2motion internals.

Every other file is unchanged from upstream. Merging a new mesh2motion
release is a manual diff-and-port on these 4 files plus the usual
`npm install` in this folder.

## Build + deploy

### Local dev

```bash
cd mesh2motion
npm install            # once, or when upstream adds deps
npm run dev            # http://localhost:5174/create.html
```

The `predev` hook mirrors the game's critter GLBs so the roster picker
works offline.

### Production build (runs as part of the main game's build)

```bash
# From the repo root:
cd mesh2motion && npm run build && cd ..
npm run build
```

- `mesh2motion/npm run build` writes into `../public/animations/`.
- The main game's `npm run build` then copies `public/` → `dist/`
  as part of Vite's normal public pass.
- Vercel serves `dist/animations/*` as static. `vercel.json` rewrites
  `/animations` and `/animations/` to `/animations/create.html` so the
  URL without the `.html` suffix reaches the single built entry.

### Why we dropped `index.html` from the build

Vercel serves static files before applying rewrites. With
`dist/animations/index.html` present, hitting
`www.bichitosrumble.com/animations` would serve that file (the
upstream Explore/marketing page — which wasn't our adaptation target
and rendered useless here). Dropping it from `rollupOptions.input`
leaves only `create.html` in the dist, so Vercel falls through to
the rewrite and reaches our actual working page.

## Updating from upstream

The fork is tiny on purpose. To pull a new Mesh2Motion release:

```bash
# In a scratch folder:
git clone https://github.com/Mesh2Motion/mesh2motion-app.git upstream-fresh
# Diff against this folder's 4 adapted files + BichitosRosterPicker.ts
# Port any meaningful engine changes manually.
cd ../mesh2motion
rm -rf node_modules package-lock.json
npm install
npm run build
```

If upstream breaks our DOM hooks (renames `#model-selection`,
`#load-model-button`, `#export-button`, `#download-hidden-link`), the
roster picker will log a console warning and fall back to a no-op —
the lab still works manually, just without the Bichitos layer on top.

## Licenses

- **Code**: MIT (upstream + our adaptations).
- **Bundled rigs + animations** (`static/rigs/`, `static/animations/`):
  CC0 (public domain). Courtesy of the Mesh2Motion project.

Everything in this folder can be re-published or forked freely.
