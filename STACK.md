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
- `main.ts` — entry point, renderer setup, game loop, base camera, audio init
- `game.ts` — full state machine (title → character_select → countdown → playing → ended)
- `arena.ts` — circular arena with concentric rings + collapse warning system
- `abilities.ts` — config-driven ability system (per-critter defs via factories, VFX shockwave)
- `gamefeel.ts` — hit stop, scale feedback, knockback tilt, camera shake, hit flash, FEEL config
- `critter.ts` — critter entity (mesh, physics state, headbutt, ability states, lives, immunity blink)
- `input.ts` — device-agnostic input abstraction layer + keyboard backend
- `input-touch.ts` — touch backend (virtual joystick + 3 action buttons), active only on mobile
- `player.ts` — player controller, reads from input abstraction
- `bot.ts` — AI with chase, headbutt, and ability heuristics
- `physics.ts` — collision resolution + fall-off detection (uses effectiveMass)
- `camera.ts` — pseudo-isometric camera setup
- `hud.ts` — DOM-based HUD (alive count, timer, lives, ability cooldowns, title/select/end screens, settings)
- `audio.ts` — Web Audio API synthesized SFX (headbutt, ground pound, ability, fall, respawn, victory) + localStorage mute
- `preview.ts` — second isolated WebGL renderer for menu 3D (character select, future winner pose)

## Dependencies
Only three runtime/dev dependencies:
- `three` + `@types/three`
- `typescript`
- `vite`
