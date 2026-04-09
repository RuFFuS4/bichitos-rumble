# Tech Stack — Bichitos Rumble

## Runtime
- **TypeScript** — strict mode, ES2020 target
- **Three.js** v0.172 — 3D rendering (scene, meshes, lighting, camera)

## Build
- **Vite** v6.2 — dev server + production bundler
- **tsc** — type checking (noEmit)

## Deployment
- **Vercel** — CI/CD and hosting
- **Hostinger** — custom domain (later)
- **GitHub** — source control

## Architecture
All game code lives in `src/`:
- `main.ts` — entry point, renderer setup, game loop
- `game.ts` — match state machine (countdown → playing → ended)
- `arena.ts` — circular arena with collapsible rings
- `abilities.ts` — config-driven ability system (defs, states, effects, VFX)
- `gamefeel.ts` — hit stop, scale feedback (squash/stretch), anticipation config
- `critter.ts` — critter entity (mesh, physics state, headbutt, abilities)
- `player.ts` — keyboard input handler (WASD, Space, J, K, R)
- `bot.ts` — AI with chase, headbutt, and ability heuristics
- `physics.ts` — collision resolution + fall-off detection (uses effectiveMass)
- `camera.ts` — pseudo-isometric camera setup
- `hud.ts` — DOM-based HUD (alive count, timer, overlays, ability cooldown bars)

## Dependencies
Only three runtime/dev dependencies:
- `three` + `@types/three`
- `typescript`
- `vite`
