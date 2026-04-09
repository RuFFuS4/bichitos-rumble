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

## Format
```
### [Date] Error Title
- **Where**: file/function
- **Symptom**: what happens
- **Cause**: why it happens
- **Fix**: how to resolve
```
