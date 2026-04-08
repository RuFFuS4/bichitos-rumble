# Build Log — Bichitos Rumble

## 2026-04-08 — Phase 1: First Playable Prototype

### What was built
- Full project scaffolding (Vite + TypeScript + Three.js)
- Circular arena with 6 collapsible concentric rings
- 4 critters with big-head design (body + head + eyes)
- Player movement (WASD/arrows) with acceleration + friction
- Headbutt attack (Space) with cooldown and knockback
- Mass-based collision physics
- Bot AI (chase nearest + headbutt when close)
- Progressive arena destruction (every 15s)
- Fall-off-edge elimination
- Match state machine (countdown → playing → ended)
- DOM-based HUD (alive count, timer, overlays)
- Fast restart with R key

### Files created
- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- `src/main.ts`, `src/game.ts`, `src/arena.ts`, `src/critter.ts`
- `src/player.ts`, `src/bot.ts`, `src/physics.ts`
- `src/camera.ts`, `src/hud.ts`
- Documentation: README, RULES, STACK, GAME_DESIGN, BUILD_LOG, PROMPTS, SUBMISSION_CHECKLIST, MEMORY, ERROR_LOG

### Bug fix: canvas rendering at 0x0
- `renderer.setSize()` was called when `window.innerWidth` was 0
- Extracted `syncSize()` in camera.ts with fallbacks
- Added guard in game loop to re-sync if canvas is still 0

### Camera adjustment
- Moved to pseudo-isometric: FOV 32, position (0, 34, 14), lookAt (0, 0, -1)

### Design update: 2 abilities per critter
- Changed from 1 to 2 special abilities per critter
- Controls: J (ability 1), K (ability 2)
- Updated all documentation files

### Next steps
- Playtest and tune physics (knockback force, speed, friction)
- Add character select screen
- Add special abilities (2 per critter, J and K)
- Add sound effects
- Deploy to Vercel
- Visual polish (particles, screen shake)
