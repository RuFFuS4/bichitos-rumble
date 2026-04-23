# Error Log — Bichitos Rumble

### [2026-04-23] Meshy models render as dark matte metal
- **Where**: `src/critter.ts` → `attachGlbMesh` material pass.
- **Symptom**: Kurama, Sergei, Sihans, Sebastian looked grey/metallic
  in the character-select preview, completely off from the flat cartoon
  colours the Meshy visor showed.
- **Cause**: Meshy exports GLBs with `metalness: 1` (`MeshPhysicalMaterial`)
  and **no environment map** in our scene. A fully metallic material
  without an envMap samples a black "environment" and comes out as
  dark grey regardless of the diffuse map. Tripo exports with low
  metalness and didn't show the bug.
- **Fix**: in `attachGlbMesh`, iterate every `MeshStandardMaterial` on
  the imported group and, when `metalness > 0.5`, force
  `metalness = 0` + `roughness = 0.7`. Diffuse map now drives the look
  and the flat-colour cartoon appearance is restored. Tripo materials
  stay untouched (their metalness is already low).

### [2026-04-23] SFX / Música buttons invisible outside match
- **Where**: `src/hud/dom-shared.ts` → `setMatchHudVisible`.
- **Symptom**: 🔊 / 🎶 buttons missing in title, character-select,
  waiting, end-screens. User explicitly said "we agreed these should be
  reachable from every screen".
- **Cause**: `setMatchHudVisible(false)` set
  `hudRoot.style.display = 'none'`, which hid `#hud-settings` (where
  the toggles live) along with everything else inside `#hud`. The CSS
  had already been written to gate only the match-only children via
  `body:not(.match-active)` selectors, but the JS display: none was
  overriding it.
- **Fix**: rewrote `setMatchHudVisible` so it only toggles the
  `body.match-active` class and forces `hudRoot.style.display =
  'block'`. Added `#ability-bar-container` and `#overlay` to the
  `body:not(.match-active) { display:none }` selector so they stay
  hidden out of matches. Settings cluster now visible on every screen.

### [2026-04-23] Character preview sizes wildly uneven
- **Where**: `src/preview.ts` + per-critter scales calibrated for
  gameplay, not for the podium.
- **Symptom**: Some critters in the character-select podium looked
  gigantic and overflowed the frame (Trunk Tripo 1.93u), others looked
  tiny and hugged the ring (Sebastian Meshy 0.56u in idle). User:
  "el selector de bichitos es un despropósito falla por todos lados".
- **Cause**: roster `scale` was tuned to gameplay hitbox feel (elephant
  bigger than crab on purpose). The preview camera couldn't work
  simultaneously for both extremes. Compounded by Meshy idle poses
  being humanoid clips applied to non-humanoid rigs (Sebastian's
  "Shrugging Shoulders" crouches the crab).
- **Fix**: added a `fitWrapper` group nested inside `holder` in
  `preview.ts`. A short polling pass (`setInterval` 60ms, 900ms
  window) samples `max(h, w, d)` from the live bone bounding box
  across the idle loop and applies `scale = TARGET (1.9u) / maxDim`
  to the wrapper. Gameplay scale unchanged; only the preview
  normalises. All 9 critters now read at ~1.9u max dimension while
  keeping their own proportions.

### [2026-04-09] Canvas renders at 0x0 — blue screen
- **Where**: `src/main.ts` → `renderer.setSize()`
- **Symptom**: Page loads, HUD visible, but only blue background — no 3D scene
- **Cause**: `window.innerWidth` returns 0 when module script runs before layout in some environments
- **Fix**: Extracted `syncSize()` in camera.ts with fallbacks. Added guard in game loop to re-sync if canvas.width is still 0.

### [2026-04-09] WebGL context creation fails — "Error creating WebGL context"
- **Where**: `src/main.ts` → `new THREE.WebGLRenderer()`
- **Symptom**: Red error banner or blue screen, Three.js throws at renderer creation
- **Cause**: Browser has Hardware Acceleration disabled, or GPU drivers are outdated/missing
- **Fix**: Not a code bug — environment issue. Added WebGL detection in main.ts with clear user-facing message and console diagnostics.
- **Status**: Edge case, gestionado. No workaround posible sin WebGL.
- **User checklist**:
  1. Chrome → `chrome://settings/system` → enable "Use hardware acceleration"
  2. Visit `chrome://gpu` → check "WebGL: Hardware accelerated"
  3. Try another browser (Firefox, Edge)
  4. Update GPU drivers
  5. Visit `https://get.webgl.org/` to test WebGL independently

### [2026-04-17] Arena fragment render MIRRORED vs physics — "visible but fall / invisible but walkable"
- **Where**: `src/arena.ts` → `createFragmentMesh()` `rotation.x`
- **Symptom (user remote test video on bichitosrumble.com)**:
  After some fragments collapsed, the local player reported:
  - walking onto a VISIBLE fragment → falling into the void
  - walking over empty-looking terrain → staying alive on arena
  Both problems happened in the SAME match, on opposite halves of the
  arena. Only became noticeable once partial collapse exposed the gap.
- **Cause**: `ExtrudeGeometry` places the Shape in XY and extrudes along +Z.
  To lay it flat on world XZ, the mesh was being rotated by `-π/2` around X.
  That rotation matrix is `(x,y,z) → (x, z, -y)`, which **mirrors shape-Y onto world `-Z`**.
  So a fragment stored with `startAngle = π/2` was rendered at world `-Z`
  (south), while the physics check `pointInFragment` uses `atan2(z, x)` without
  any mirror and still believed that fragment covered world `+Z` (north).
  Result: visual and physics diverged by a mirror across the X axis. While
  every shape-angle had SOME fragment alive (pre-collapse), the bug was
  invisible. After partial collapse it exposed both failure directions.
- **Fix** (commit `c4ad1c4`):
  - Changed `mesh.rotation.x` from `-Math.PI / 2` to `+Math.PI / 2`.
  - New rotation matrix: `(x,y,z) → (x, -z, y)`. Shape-Y now maps to world `+Z` (no mirror).
  - Removed the `mesh.position.y = -h` compensation — `+π/2` already extrudes downward naturally (back face at `y=-h`, top face at `y=0`).
  - Verified with pure-math script: shape point `(0, 5, 0)` → world `(0, 0, 5)`, `atan2(5, 0) = π/2` matches the fragment's stored startAngle.
- **Detection**: use `window.__arena` helpers in production console:
  - `__arena.checkPlayer()` — the fastest probe: reads the local
    player's world position and reports which fragment physics thinks
    covers it plus whether that mesh is rendered. Run right after a
    "visible but fall" / "invisible but walk" event to capture the
    state without guessing coordinates.
  - `__arena.check(x, z)` — same check at an arbitrary point.
  - `__arena.compass()` — toggles N/S/E/W world markers. Red (N) must be
    at `+Z`, blue (S) at `-Z`, green (E) at `+X`, yellow (W) at `-X`. If
    a fragment at stored angle `π/2` is not underneath the red marker,
    the rotation mirror has reappeared.
  - `__arena.dump()` — lists fragments grouped by band with alive vs
    visible flags. Any `MISMATCH(alive=X visible=Y)` row is evidence of
    a different sync bug.
  - `__arena.logCollapses()` — toggles per-batch log of collapse and
    warning transitions during a live match.
- **Lesson**: when mapping geometry between two coordinate conventions,
  add a compass debug helper from day one. The bug was invisible in unit
  tests because they only checked angles 0 and π (which are fixed points
  of the Z-mirror).

### [2026-04-20] Cloned SkinnedMesh — physics moves, vertices stay at origin
- **Where**: `src/model-loader.ts` → `deepCloneWithMaterials()`
- **Symptom**: After Sergei was re-exported with a rigged armature
  (first critter to ship with a real skeleton), the character-select
  thumbnail rendered as if the mesh were pinned to world origin while
  the carousel rotated the container around it. In-game the critter
  followed physics as an invisible ghost; visible geometry stayed
  stuck at origin.
- **Cause**: `source.clone(true)` on a `THREE.Group` containing a
  `SkinnedMesh` clones the mesh and the armature nodes but leaves
  `SkinnedMesh.skeleton.bones` pointing at the ORIGINAL armature's
  bones — the ones cached inside the loader. Translating/rotating
  the clone moves the empty parent, but vertices are still bound to
  the cached skeleton at world origin.
- **Fix**: Use `SkeletonUtils.clone()` from
  `three/examples/jsm/utils/SkeletonUtils.js` for any source that
  contains at least one `SkinnedMesh` — SkeletonUtils rebuilds the
  skeleton and reconnects bone references to the clone subtree.
  Detection: single `source.traverse` checking `node.isSkinnedMesh`.
  Plain `source.clone(true)` kept as fallback for non-skinned models
  (cheaper, still the majority today). Comment in the file documents
  the symptom so the next refactor doesn't revert it.
- **Lesson**: the moment any critter gets a real armature, SkeletonUtils
  cloning is mandatory. This bug only surfaces once a skinned model is
  added; all the critters shipped so far were static meshes, so the
  cheap clone path worked.

## Format
```
### [Date] Error Title
- **Where**: file/function
- **Symptom**: what happens
- **Cause**: why it happens
- **Fix**: how to resolve
```
