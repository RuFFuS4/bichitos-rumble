# Error Log — Bichitos Rumble

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
  - `__arena.compass()` — toggles N/S/E/W world markers. Red (N) must be
    at `+Z`, blue (S) at `-Z`, green (E) at `+X`, yellow (W) at `-X`. If
    a fragment at stored angle `π/2` is not underneath the red marker,
    the rotation mirror has reappeared.
  - `__arena.check(0, 5)` — prints "no fragment contains this point"
    when the mirror bug is back (fragment physics disagrees with render).
  - `__arena.dump()` — lists fragments grouped by band with alive vs
    visible flags. Any `MISMATCH(alive=X visible=Y)` row is evidence of
    a different sync bug.
  - `__arena.logCollapses()` — toggles per-batch log of collapse and
    warning transitions during a live match.
- **Lesson**: when mapping geometry between two coordinate conventions,
  add a compass debug helper from day one. The bug was invisible in unit
  tests because they only checked angles 0 and π (which are fixed points
  of the Z-mirror).

## Format
```
### [Date] Error Title
- **Where**: file/function
- **Symptom**: what happens
- **Cause**: why it happens
- **Fix**: how to resolve
```
