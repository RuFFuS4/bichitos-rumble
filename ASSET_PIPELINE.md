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
