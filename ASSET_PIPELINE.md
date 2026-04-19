# Asset Pipeline — Bichitos Rumble

How 3D models get from source files to the game.

## Directory Structure

```
public/
  models/
    critters/
      sergei.glb        ← optimized, game-ready
      trunk.glb
      kurama.glb
      shelly.glb
      kermit.glb
      sihans.glb
      kowalski.glb
      cheeto.glb
      sebastian.glb
  draco/
    draco_decoder.js    ← Draco WASM decoder (from three.js)
    draco_decoder.wasm
    draco_wasm_wrapper.js

scripts/
  optimize-models.mjs   ← optimization pipeline script
```

## Naming Convention

- **Filename**: `<id>.glb` — lowercase, matches `RosterEntry.id`
- **Source files**: kept outside the repo (user's local machine or shared drive)
- **Only optimized files** go into `public/models/critters/`

## Optimization Pipeline

### Prerequisites

```bash
npm install --save-dev @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
```

### Usage

```bash
# Optimize a single model (recommended for first-time validation):
node scripts/optimize-models.mjs path/to/source/Sergei.glb

# Optimize all models in a directory:
node scripts/optimize-models.mjs path/to/source/

# Output goes to public/models/critters/<id>.glb
```

### What the Script Does

1. **Reads** the source GLB
2. **Deduplicates** redundant data (vertices, accessors)
3. **Simplifies** geometry to target vertex count (default: 5,000)
4. **Applies Draco compression** for smaller file size
5. **Validates** against style lock constraints:
   - Vertex count ≤ 8,000
   - File size ≤ 500 KB
   - Logs warnings if limits exceeded
6. **Writes** optimized GLB to `public/models/critters/<id>.glb`

### Tuning

The simplification ratio is calculated per-model based on its source vertex
count to hit the target. The target vertex count is configurable:

```bash
# Custom target vertex count:
node scripts/optimize-models.mjs path/to/Sergei.glb --target-verts 4000
```

After optimization, **visually inspect** each model in the character select
preview to verify silhouette integrity. The script logs before/after stats
for manual review.

## Draco Decoder Setup

The Draco WASM decoder files must be served at runtime for `DRACOLoader`.
Copy them once from `node_modules`:

```bash
mkdir -p public/draco
cp node_modules/three/examples/jsm/libs/draco/draco_decoder.js public/draco/
cp node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm public/draco/
cp node_modules/three/examples/jsm/libs/draco/draco_wasm_wrapper.js public/draco/
```

These files are committed to the repo. Vite serves `public/` as static root,
so they resolve at `./draco/draco_decoder.wasm` at runtime.

## Runtime Loading

### Architecture

```
src/model-loader.ts     → GLTFLoader + DRACOLoader, cache, Promise API
src/roster.ts           → data-driven registry (id, glbPath, scale, status)
src/critter.ts          → async GLB swap with procedural fallback
```

### Material Safety

Each critter instance must have **independent materials** because gameplay
code modifies emissive color, intensity, and opacity in real-time (ability
glow, immunity blink, frenzy pulse).

Strategy:
- The cache stores the original parsed `GLTF.scene`
- On each `loadModel()` call, the scene is **deep-cloned**:
  1. `cachedScene.clone()` clones the node tree
  2. A traversal replaces every `material` with `.clone()` of itself
  3. The caller receives a fully independent scene graph

This ensures zero cross-contamination between critter instances.

### Loading Flow

```
Character Select:
  → user navigates to a slot
  → getRosterEntry(name) → if glbPath exists
  → loadModel(glbPath) → show in preview (async, procedural fallback while loading)

Match Start (enterCountdown):
  → build 4-critter roster
  → preloadModels() for all participants with GLB paths
  → 3-second countdown window covers load time

In-Match:
  → Critter constructor always builds procedural mesh (instant)
  → if GLB loaded (cache hit), attach it immediately
  → if GLB not yet loaded, procedural mesh stays visible
  → when GLB arrives later, swap visual (physics unaffected)
```

### Fallback Guarantees

- If a GLB file is missing → procedural mesh, game plays normally
- If a GLB fails to load (network error) → procedural mesh, console warning
- If DRACOLoader fails → GLTFLoader still works for uncompressed GLBs
- If no `public/models/critters/` directory exists → all procedural, zero errors

## Sergei Optimization Record (first validated model)

```bash
# Command used:
node scripts/optimize-models.mjs "C:/Users/rafa_/Downloads/Bichitos Rumble/Sergei.glb"

# Results:
#   Source: 956,460 verts, 39.9 MB (Tripo3D export, 1 mesh, 1 JPEG texture 228KB)
#   Target: 5,000 verts
#   Result: 7,060 verts, 425 KB
#   Verts:  ✓ (max 8,000)
#   Size:   ✓ (max 500 KB)
#   Output: public/models/critters/sergei.glb
```

Acceptance criteria met:
- [x] Vertex count under 8,000 (7,060)
- [x] File size under 500 KB (425 KB)
- [x] Texture preserved (228 KB JPEG basecolor)
- [x] Single mesh, single material
- [ ] Visual validation in-game (pending playtest)

## Validation Checklist (per model)

- [ ] File size ≤ 500 KB
- [ ] Vertex count ≤ 8,000
- [ ] Silhouette readable at gameplay camera distance
- [ ] Colors match style lock (2-3 flat colors, no complex textures)
- [ ] Model centered at origin, feet at Y=0
- [ ] Scale appropriate (similar visual size to procedural critter)
- [ ] Preview renders correctly with drag rotation
- [ ] In-match spawn, movement, abilities, elimination all work
- [ ] Immunity blink applies correctly to GLB materials
- [ ] Ability glow (emissive) applies correctly

---

# Animation Pipeline (skeletal clips, optional layer)

Since 2026-04-19, GLBs can ship **AnimationClips** that the engine
picks up automatically via `src/critter-skeletal.ts`. The procedural
layer (`src/critter-animation.ts`) keeps running in parallel — it
owns idle bob / lean / sway / squash-stretch and steps aside for
heavy clips (victory, defeat, ability, headbutt lunge, fall, hit).

Critters without skeletal clips are **not broken**: `skeletal === null`
and the procedural layer handles 100% of the motion like before.

## Preferred tool: `/animations` (Mesh2Motion integrated)

The project ships with an internal **animation lab** at
[`/animations`](../mesh2motion/README-INTEGRATION.md) based on
[Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) (MIT code,
CC0 animation assets). Adaptations we ship:

- Roster picker with the 9 critters at the top of the Use-Your-Model
  page. One click preloads the GLB and suggests a rig.
- `noindex` + INTERNAL banner on every page so the lab can't leak to
  search engines.
- Build output lands directly in `public/animations/` so Vercel serves
  it as `/animations/*` alongside the game.

**Workflow per critter**:

1. Open `https://bichitosrumble.com/animations` (or local dev — see
   `mesh2motion/README-INTEGRATION.md`).
2. Click the critter card. The GLB loads and the suggested rig gets
   preselected.
3. Adjust the bones inside the mesh (Mesh2Motion's skeleton-fit step).
4. Pick animations from the library.
5. Export GLB with embedded clips.
6. Save to `public/models/critters/<id>.glb` (overwriting the non-
   animated version).
7. Reload the game — the console should log
   `[Critter] skeletal animator attached: <Name> | clips: ...`.

**Suggested rig mapping** (preset in the roster picker):

| Critter | Rig | Notes |
|---|---|---|
| Sergei (gorilla) | `human` | Clean match. |
| Kurama (fox) | `fox` | Direct match. |
| Cheeto (tiger) | `fox` | Both quadruped felines. |
| Kowalski (penguin) | `bird` | Try `human` if `bird` feels limited. |
| Trunk (elephant) | `kaiju` | Closest heavy quadruped. |
| Sebastian (crab) | `spider` | Multi-leg arthropod. |
| Shelly (turtle) | `kaiju` | No great match. Consider Tripo Animate. |
| Kermit (frog) | `human` | Forced. Consider Tripo Animate. |
| Sihans (mole) | `human` | Forced. Consider Tripo Animate. |

The three marked "Consider Tripo Animate" don't have a native rig —
`human`/`kaiju` work but results are weak. For those, Tripo Animate
(external tool) gives better output.

## Fallback: Mixamo + Blender (older workflow)

Kept as reference in case the Mesh2Motion library doesn't cover an
edge case.

## Supported sources

| Tool | Good for | Notes |
|------|----------|-------|
| **Mixamo** (Adobe) | Humanoid rig + 2500+ prebuilt motions | Best for Sergei, Trunk, Cheeto, Kurama, Kermit, Kowalski, Sihans. Requires FBX input (no GLB import). |
| **Tripo Animate** | Non-humanoid critters (Shelly turtle, Sebastian crab), text-to-animation | GLB native in/out, no conversion. Smaller library. |
| **Cascadeur** | Custom signature moves (Trunk Grip, Shell Shield pose, Shadow Step teleport) | Free indie tier. AI-assisted keyframes. GLB export. |
| **Rokoko Video** | Mocap from webcam for one-off gestures | Trial + subscription. GLB/FBX export. |

## Canonical workflow (Mixamo → Blender → GLB)

Mixamo only accepts **FBX / OBJ**, but we use GLB. Blender bridges:

1. **Blender: GLB → FBX** for upload.
   - `File → Import → glTF 2.0` → selects `sergei.glb` from
     `public/models/critters/`.
   - `File → Export → FBX` with:
     - Object Types: Mesh only.
     - Armature → Add Leaf Bones: off.
     - Bake Animation: off (no animation yet).
2. **Mixamo**: upload the FBX, auto-rig (mark chin/wrists/knees/groin),
   choose an animation (Idle, Running, Victory, Dying, Hit Reaction,
   Falling To Roll, Punching…). Download:
   - Format: FBX Binary.
   - Skin: **With Skin** for the first animation (contains the rig);
     **Without Skin** for subsequent animations (just the motion).
   - FPS: 30.
3. **Blender: assemble + export GLB**.
   - Import the first FBX (rig + animation).
   - Import subsequent FBX's (motion-only; they'll attach to the same
     armature).
   - In the Action Editor, **rename each clip** to a name the
     `critter-skeletal.ts` resolver understands. Mixamo's stock
     names (`Idle`, `Running`, `Victory`, `Dying`, `Hit Reaction`,
     `Falling To Roll`) already match. If the clip names end up as
     `mixamo.com`, rename them.
   - Push actions down to the NLA editor so they all live in the
     final GLB.
   - `File → Export → glTF 2.0` with Animation marked ✅.
4. **Replace** `public/models/critters/<id>.glb` with the animated
   version. Reload the game. Console should show:
   `[Critter] skeletal animator attached: <Name> | clips: Idle, Running, …`.

## Tripo Animate (bypasses Mixamo entirely)

For critters that already live in Tripo (all 9 in this project):

1. In Tripo, open the model.
2. Click **Animate**.
3. Choose from the library (idle / walk / run / attack / victory /
   defeat / etc) — or use text-to-animation.
4. Download as **GLB directly**.
5. Drop in `public/models/critters/<id>.glb`.

## Clip-name resolver

The fuzzy matcher lives in `STATE_KEYWORDS` inside
`src/critter-skeletal.ts`. First match wins per state. Add keywords
there if your clips use non-standard names — one-line change.

Current keyword coverage (substrings, case-insensitive):

| State | Recognised names |
|-------|------------------|
| `idle` | `idle`, `breathing`, `standing`, `breath` |
| `walk` | `walk` |
| `run` | `run`, `sprint`, `gallop` |
| `headbutt_anticip` | `anticip`, `windup`, `prepare`, `charge_up` |
| `headbutt_lunge` | `headbutt`, `head_butt`, `lunge`, `punch`, `strike`, `attack`, `melee` |
| `ability_1` | `ability1`, `ability_1`, `skill1`, `dash`, `charge`, `rush`, `leap`, `pounce` |
| `ability_2` | `ability2`, `ability_2`, `skill2`, `slam`, `special`, `grip`, `shield`, `cloud`, `tunnel`, `snowball`, `shadow_step`, `shadow`, `sweep`, `mirror` |
| `ability_3` | `ability3`, `ability_3`, `ultimate`, `ulti`, `frenzy`, `pound`, `mega`, `hypno`, `diggy`, `ice_age`, `tiger_roar`, `roar`, `crab_slash` |
| `victory` | `victory`, `win`, `celebrat`, `cheer`, `dance` |
| `defeat` | `defeat`, `lose`, `dying`, `death`, `ko`, `loss` |
| `fall` | `fall`, `drop`, `falling` |
| `hit` | `hit`, `damage`, `react`, `stagger`, `flinch` |
| `respawn` | `respawn`, `revive`, `spawn`, `appear` |

## Priority order for content work

Hands-on time is limited. Ship this order for maximum visible impact:

1. `idle` — shown in character select, waiting, between actions.
2. `run` — most of the match time.
3. `victory` — end-screen, emotional peak.
4. `defeat` — end-screen, symmetry with victory.
5. `headbutt_lunge` — the most used action in combat.
6. `fall` + `hit` — adds drama to the void edge.
7. `ability_1/2/3` — signature moves, the showpiece.
8. `walk`, `respawn`, `headbutt_anticip` — nice-to-have.

## Validation Checklist (per animated GLB)

- [ ] File size still under 500 KB (animations are small, shouldn't
      matter, but Mixamo + Blender can bloat vertex data).
- [ ] At least `idle` and `run` resolve in console log.
- [ ] Critter breathes during character select / waiting (not a hard
      snap between poses).
- [ ] Moving in match crossfades idle → run smoothly (no snap).
- [ ] Stopping crossfades back to idle.
- [ ] Headbutt pose reads: wind-up → lunge → recovery (the procedural
      head-retract still applies under procedural layer if the
      skeletal doesn't own that motion).
- [ ] No visible T-pose or rig glitch at any point.
- [ ] Victory / defeat hold the pose on end-screen (clampWhenFinished).
- [ ] Online multiplayer behaves the same — each client loads its own
      mixer, clips don't cross over.
