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
- `critter.ts` — critter entity (mesh, physics state, headbutt)
- `player.ts` — keyboard input handler
- `bot.ts` — simple chase-and-headbutt AI
- `physics.ts` — collision resolution + fall-off detection
- `camera.ts` — perspective camera setup
- `hud.ts` — DOM-based HUD (alive count, timer, overlays)

## Dependencies
Only three runtime/dev dependencies:
- `three` + `@types/three`
- `typescript`
- `vite`
