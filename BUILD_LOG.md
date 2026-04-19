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

## 2026-04-08 — Vertical Slice: Ability System

### What was built
- **Ability architecture** (`src/abilities.ts`): config-driven system with `AbilityDef` + `AbilityState` types, `EFFECT_MAP` dispatch (no monolithic switch), `canActivateAbility()` / `activateAbility()` separation, per-type helpers
- **Rojo's 2 abilities**:
  - **Charge Rush (J)**: directional dash, speed x2.2, mass x1.5, impulse 12, cooldown 4s, duration 0.35s
  - **Ground Pound (K)**: AoE radial knockback, force 18, radius 3.5, wind-up 0.25s (slow 30%), cooldown 6s, shockwave VFX (expanding torus)
- **Effective stats**: `effectiveSpeed` and `effectiveMass` getters on Critter, used by player, bot, and physics
- **Visual feedback**: emissive glow (orange for Charge Rush, yellow→red for Ground Pound), body squish during wind-up
- **HUD cooldown bars**: CSS-based, renders any number of ability slots, shows active/cooldown/ready states
- **Bot ability AI**: heuristics for ability usage (Ability 1 at mid-range, Ability 2 when surrounded)

### Architecture decisions
- Config-driven: adding a critter = adding an entry in `CRITTER_ABILITIES` record
- Per-type effect helpers via `EFFECT_MAP` dispatch table, not a switch
- `canActivateAbility()` separated from `activateAbility()` for reuse in bot AI
- `updateVisuals()` in critter.ts is visual-only, no gameplay logic
- HUD renders from array of states (not hardcoded to 2 slots)

### Files created
- `src/abilities.ts` (new — ~200 lines)

### Files modified
- `src/critter.ts` — abilityStates, effectiveSpeed/Mass, updateVisuals, public body/head
- `src/player.ts` — J/K input, effectiveSpeed
- `src/physics.ts` — effectiveMass in collision calculations
- `src/bot.ts` — effectiveSpeed, ability heuristics
- `src/hud.ts` — initAbilityHUD, updateAbilityHUD
- `src/game.ts` — ability update step in game loop, HUD wiring
- `index.html` — ability bar CSS and container div

### Provisional tuning values (iterate during playtesting)
- Charge Rush: cooldown 4s, duration 0.35s, speedMult 2.2, massMult 1.5, impulse 12
- Ground Pound: cooldown 6s, windUp 0.25s, slowDuringWindUp 0.3, radius 3.5, force 18
- Bot ability chance: ~2% per frame for Ability 1, ~1.5% per frame for Ability 2
- Shockwave VFX duration: 300ms
- All values centralized in `CHARGE_RUSH` and `GROUND_POUND` consts in `src/abilities.ts`

## 2026-04-08 — Game Feel Foundation

### What was built
- **`src/gamefeel.ts`** (new) — centralized game feel system with:
  - **Hit stop**: global time freeze on impact (headbutt 0.045s, ground pound 0.06s). Uses `applyHitStop(dt)` in game loop — returns 0 during freeze, rendering continues.
  - **Scale feedback**: squash/stretch deformation via `mesh.scale` with quadratic ease-out interpolation back to normal. Three presets: `applyImpactFeedback` (Y squash), `applyDashFeedback` (Z stretch), `applyLandingFeedback` (Y squash + XZ spread).
  - **FEEL config object**: all values (durations, scale targets, hit stop times) centralized in one editable const.
- **Headbutt anticipation**: 0.08s wind-up phase where head retracts and body squashes before the lunge. Sells the hit before it happens.
- **Separation maintained**: `gamefeel.ts` is purely visual/timing — no gameplay logic. Physics triggers feedback functions, game loop applies hit stop wrapper.

### Integration points
- `physics.ts` → `triggerHitStop()` + `applyImpactFeedback()` on headbutt collisions
- `abilities.ts` → `applyDashFeedback()` on Charge Rush fire, `applyLandingFeedback()` + `triggerHitStop()` on Ground Pound fire, `applyImpactFeedback()` on each hit target
- `critter.ts` → `updateScaleFeedback()` called every frame, headbutt anticipation phase before lunge
- `game.ts` → `applyHitStop(dt)` wraps the entire playing phase, returns effectiveDt

### Files created
- `src/gamefeel.ts` (~130 lines)

### Files modified
- `src/critter.ts` — headbutt anticipation phase, updateScaleFeedback integration, reset cleanup
- `src/physics.ts` — hit stop + impact feedback on headbutt collisions
- `src/abilities.ts` — dash/landing/impact feedback + hit stop on ground pound
- `src/game.ts` — hit stop wrapper around playing phase

### Provisional tuning values (in FEEL const, `src/gamefeel.ts`)
- Hit stop: headbutt 0.045s, ground pound 0.06s, generic 0.03s
- Headbutt anticipation: 0.08s, head retract -0.15, body squash 0.85
- Impact scale: X/Z 1.3, Y 0.7, duration 0.15s
- Dash scale: X 0.85, Y 0.9, Z 1.3, duration 0.2s
- Landing scale: X/Z 1.2, Y 0.65, duration 0.2s

### Design decisions
- Hit stop freezes gameplay dt to 0 but keeps rendering — screen doesn't actually pause, just game logic
- Scale feedback uses WeakMap per critter — no memory leaks, auto-cleanup
- Anticipation is gameplay (delays the headbutt) not just visual — creates risk/reward timing
- All feedback functions are standalone (applyImpactFeedback, applyDashFeedback, etc.) — easy to call from any new ability type

## 2026-04-09 — Game Feel Tuning Pass

### Goal
Make Rojo feel aggressive, weighty, and direct. Eliminate floaty/mushy sensation.

### All value changes (old → new)

**Movement:**
| Value | Old | New | Notes |
|-------|-----|-----|-------|
| Friction | `vx *= 0.92` (frame-dep.) | `pow(0.5, dt/0.06)` | Frame-independent. Stops in ~0.3s |
| Acceleration | 1.0x implicit | 1.4x | Snappier response |
| Max speed | None | 16 | Caps extreme knockback stacking |

**Headbutt:**
| Value | Old | New | Notes |
|-------|-----|-----|-------|
| Anticipation duration | 0.08s | 0.12s | Readable wind-up |
| Head retract | -0.15 | -0.30 | Visible coil |
| Body squash | 0.85 | 0.70 | Dramatic compression |
| Lunge duration | 0.2s (hardcoded) | 0.15s | Sharper snap |
| Head extend | 0.3 (hardcoded) | 0.45 | Reaches further |
| Velocity boost | None | 4.0 | Micro-lunge into hit |
| Cooldown | 0.5s (hardcoded) | 0.45s | Slightly faster |
| Recoil | 0.2x (hardcoded) | 0.35x | Both feel the hit |

**Collisions:**
| Value | Old | New | Contrast |
|-------|-----|-----|----------|
| Normal push | 6 (hardcoded) | 3.0 | Gentle nudge |
| Headbutt mult. | 2.5 (hardcoded) | 3.5 | Rojo: 14×3.5=49 |
| Push ratio | 6x | **16x** | Clear hit vs. bump |

**Charge Rush:**
| Value | Old | New | Notes |
|-------|-----|-----|-------|
| Impulse | 12 | 16 | Stronger launch |
| Speed mult. | 2.2x | 2.5x | Faster |
| Mass mult. | 1.5x | 2.0x | Freight train |
| Duration | 0.35s | 0.30s | Shorter, more intense |
| Wind-up | 0 | 0.06s | Micro-anticipation |
| Steering | 100% | **15%** | Directional commitment |

**Ground Pound:**
| Value | Old | New | Notes |
|-------|-----|-----|-------|
| Wind-up | 0.25s | 0.35s | Longer, more readable |
| Slow during | 0.3x | 0.15x | Nearly rooted |
| Force | 18 | 28 | +55% knockback |
| Wind-up squash | 0.7 (hardcoded) | 0.50 | Extreme compression |
| Landing scaleY | 0.65 | 0.45 | Dramatic pancake |
| Landing scaleX | 1.2 | 1.45 | Wide spread |

**Hit stop:**
| Value | Old | New |
|-------|-----|-----|
| Headbutt | 0.045s | 0.07s |
| Ground Pound | 0.06s | 0.09s |
| Generic | 0.03s | 0.04s |

### Config centralization
Moved ALL hardcoded values from critter.ts, physics.ts, abilities.ts into FEEL config in gamefeel.ts.
- Friction formula is now frame-independent (exponential decay with half-life)
- Ability defs (CHARGE_RUSH, GROUND_POUND) read from FEEL at init
- Collision forces, recoil factor, headbutt timings all from FEEL

### Provisional values (still need playtesting)
- `frictionHalfLife: 0.06` — might need 0.08 if stopping feels too abrupt
- `headbutt.lunge.velocityBoost: 4.0` — might need reduction if headbutt overshoots
- `chargeRush.steerFactor: 0.15` — might need 0.25 if charge feels too rigid
- `groundPound.force: 28` — might be too strong at point-blank, could need falloff curve adjustment
- `collision.normalPushForce: 3.0` — might need 4.0 if critters clip through each other
- `movement.maxSpeed: 16` — watch if knockbacks feel capped/unsatisfying

### Files modified
- `src/gamefeel.ts` — restructured FEEL config with movement, headbutt, collision, chargeRush, groundPound sections
- `src/critter.ts` — frame-independent friction, velocity cap, headbutt micro-lunge, all refs to FEEL
- `src/physics.ts` — removed hardcoded PUSH_FORCE/HEADBUTT_MULTIPLIER/recoil, reads FEEL
- `src/abilities.ts` — CHARGE_RUSH/GROUND_POUND read from FEEL, wind-up added to charge
- `src/player.ts` — accelerationScale, charge rush steering reduction
- `src/bot.ts` — same changes + adjusted bot speed factor (0.7→0.55 with accelerationScale)

## 2026-04-09 — Movement fix: drift + speed

### Bug found: critters drift to death after releasing controls
**Root cause:** Exponential friction (`vx *= pow(0.5, dt/halfLife)`) decays asymptotically — it approaches zero but never reaches it. A velocity of 0.01 moves the critter ~0.6 units/minute, enough to slowly slide off the arena edge over time. Combined with impulses from headbutt (velocityBoost 4.0) and charge rush (impulse 16), residual velocity after these actions kept critters moving indefinitely.

### Fixes applied

**1. Velocity dead zone** — snap to 0 when speed < 0.15:
```
if (speed < deadZone) { vx = 0; vz = 0; }
```
This kills micro-drift completely. The threshold of 0.15 is imperceptible to the player.

**2. Dual friction model** — faster braking when no input:
- `frictionHalfLife: 0.08` when holding a direction (slightly relaxed for higher top speed)
- `idleFrictionHalfLife: 0.03` when no input (critter plants almost instantly)
- `hasInput` flag set by player.ts/bot.ts each frame, read by critter.ts

**3. Speed increase for Rojo:**
- Base speed: 8 → 10 (+25%)
- accelerationScale: 1.4 → 1.6 (+14%)
- maxSpeed: 16 → 20 (+25%)
- Net effect: Rojo's effective acceleration is 10 × 1.6 = 16 (was 8 × 1.4 = 11.2, +43% total)

### Value changes

| Value | Old | New |
|-------|-----|-----|
| Rojo speed | 8 | 10 |
| accelerationScale | 1.4 | 1.6 |
| maxSpeed | 16 | 20 |
| frictionHalfLife | 0.06 | 0.08 |
| idleFrictionHalfLife | — | 0.03 |
| velocityDeadZone | — | 0.15 |

### Provisional values (still tuning)
- `idleFrictionHalfLife: 0.03` — might feel too abrupt, try 0.04 if braking is jarring
- `velocityDeadZone: 0.15` — safe value, could go lower to 0.1 if needed
- Rojo speed 10 — might need 11-12 if still feels slow relative to arena size

### Files modified
- `src/gamefeel.ts` — added idleFrictionHalfLife, velocityDeadZone, raised accelScale/maxSpeed
- `src/critter.ts` — added hasInput flag, dual friction model, dead zone clamping, Rojo speed 8→10
- `src/player.ts` — sets critter.hasInput based on input vector
- `src/bot.ts` — sets bot.hasInput based on target availability

## 2026-04-09 — Lives & Respawn System

### What was built
- **3 lives per critter** (default, configurable in `FEEL.lives.default`)
- **Fall → respawn cycle**: critter falls off arena → loses 1 life → after 0.8s delay → respawns near center with 1.5s of immunity
- **Permanent elimination** only when all lives are spent
- **Immunity system**: during immunity critter blinks (opacity toggle), cannot be knocked back, cannot headbutt, cannot be targeted by collisions
- **HUD lives indicator**: red hearts (♥♥♥) in top bar
- **Respawn position**: random point at 40% of current arena radius (safe from edge)

### Flow
1. Critter goes off arena edge → `startFalling()` called
2. `lives--`, critter falls with animation for 0.8s
3. If `lives > 0`: `respawnAt()` places critter near center, sets immunity 1.5s
4. If `lives === 0`: `eliminate()` — permanently removed
5. Win condition: last critter with `alive === true` (all others permanently eliminated)

### Config values (in `FEEL.lives`)
| Value | Setting |
|-------|---------|
| Default lives | 3 |
| Immunity duration | 1.5s |
| Respawn delay | 0.8s |
| Blink rate | 8 blinks/sec |

### Files created/modified
- `src/gamefeel.ts` — added `FEEL.lives` section
- `src/critter.ts` — added `lives`, `immunityTimer`, `falling`, `isImmune`, `startFalling()`, `updateFalling()`, `respawnAt()`, immunity blink in `updateVisuals()`
- `src/physics.ts` — skip falling critters in collisions, skip knockback on immune critters, split `checkFalloff` + `updateFalling`
- `src/game.ts` — respawn handling, win condition uses `alive` (permanent), respawn position picker
- `src/hud.ts` — `updateLivesHUD()` function
- `index.html` — lives display element (♥♥♥)

### Provisional values
- `immunityDuration: 1.5` — might be too long if it breaks combat flow, try 1.0
- `respawnDelay: 0.8` — might need 0.5 for faster pace
- `default: 3` lives — will vary per critter in the future (2-3)

## 2026-04-09 — All-critters lives HUD + match timing

### Changes
- **Lives HUD shows all 4 critters**: each row has a colored dot (matching critter color) + red hearts. Eliminated critters show ✖ at 35% opacity.
- **Match duration**: 90s → **120s** (more time for 3-life matches)
- **Collapse interval**: 15s → **20s** (6 rings over 120s = arena fully collapsed by end)
- **Match timing centralized** in `FEEL.match` (duration, collapseInterval, countdown)
- Removed hardcoded `MATCH_DURATION`, `COLLAPSE_INTERVAL`, `COUNTDOWN_SECS` from game.ts

### Timing math
- 6 rings × 20s = arena fully collapsed at 120s (matches game duration exactly)
- With 3 lives, average match has ~8-10 falls total → frenetic last 40s as arena shrinks

### Files modified
- `src/gamefeel.ts` — added `FEEL.match` section
- `src/game.ts` — reads all timing from FEEL, passes critters array to HUD
- `src/hud.ts` — `initAllLivesHUD(critters)` + `updateAllLivesHUD(critters)` replace single-player lives
- `index.html` — lives container div + CSS for lives panel

### Provisional values
- `match.duration: 120` — might need 100 if matches feel too long
- `match.collapseInterval: 20` — could try 18 for faster pressure ramp

## 2026-04-09 — Game Feel Pass: Visual Expression

### What was built
First serious pass to reduce "orthopedic" feel. All changes are visual-only — no gameplay logic modified.

**1. Bounce overshoot in scale feedback:**
- Replaced simple ease-out with 3-phase bounce: deform → return → overshoot → settle
- Impact, dash, and landing effects now have configurable `bounceOvershoot` (1.05–1.12)
- Gives squash/stretch a springy, cartoon quality instead of flat interpolation

**2. Headbutt recovery pose:**
- Head no longer snaps to z=0 after lunge — bounces back briefly (`headOvershoot: -0.12`)
- Body stretches Y slightly during recovery (`bodyStretch: 1.15`) before settling
- Creates a "rebound" feel after each hit

**3. Knockback tilt:**
- Critters tilt backward when hit (`tiltAngle: 0.25 rad` on body, half on head)
- Smooth sine-based lean → return over 0.3s
- Sells the hit direction without needing knockback arcs

**4. Visual state contrast improved:**
- **Headbutt anticipation**: white glow (distinct from abilities)
- **Headbutt active**: yellow-gold glow, high intensity (0.8)
- **Charge Rush**: orange glow + head tucks down (-0.08 Y offset)
- **Ground Pound wind-up**: yellow glow + body squash + head drops
- **Cooldown state**: muted glow (50% intensity)
- **Idle**: subtle critter-color emissive

**5. Stronger scale values:**
- Impact: scaleY 0.7→0.6, duration 0.15→0.2
- Dash: scaleZ 1.4→1.5, scaleX 0.80→0.75
- Landing: scaleY 0.45→0.4, scaleX 1.45→1.5, duration 0.25→0.3

### New FEEL config sections
- `impact.bounceOvershoot`, `dash.bounceOvershoot`, `landing.bounceOvershoot`
- `headbuttRecovery { headOvershoot, bodyStretch, duration }`
- `knockbackReaction { tiltAngle, duration }`

### New gamefeel.ts functions
- `applyKnockbackTilt(critter)` — triggered by `applyImpactFeedback`
- `updateKnockbackTilt(critter, dt)` — updates body/head rotation.x
- `applyHeadbuttRecovery(critter)` — triggered at end of headbutt lunge
- `updateHeadbuttRecovery(critter, dt)` — animates head bounce-back + body stretch
- `bounceEase(t, overshoot)` — 3-phase ease with overshoot for scale feedback

### Architecture notes
- All new visual systems use WeakMap per critter (same pattern as scale feedback)
- Called from `critter.update()` alongside `updateScaleFeedback()` — clean separation
- No gameplay logic touched — physics, abilities, collision all unchanged
- Hooks ready for future: VFX particles, camera shake, sound triggers can attach at the same points

### Also in this session
- Jam widget added to index.html (`<script async>`, non-blocking)
- Future organic arena collapse documented in GAME_DESIGN.md and MEMORY.md

## 2026-04-10 — Vercel deploy configuration

### What was built
- **`vercel.json`** created at project root with SPA configuration:
  - `framework: "vite"` — explicit detector
  - `buildCommand: "npm run build"` — runs `tsc && vite build`
  - `outputDirectory: "dist"` — Vite's default
  - `devCommand: "npm run dev"` — for `vercel dev`
  - `rewrites: [{ source: "/(.*)", destination: "/index.html" }]` — SPA fallback: any unknown URL falls back to `index.html`, preventing 404s on reload. Assets with real files in `dist/` still serve directly (Vercel rewrite rules skip existing files).

### Build verified
- `npx vite build` → 16 modules, 493 KB (125 KB gzip), ~770ms
- `dist/index.html` correctly references `./assets/index-XXXX.js` (relative path, no absolute path issues)
- `base: './'` in `vite.config.ts` ensures relative URLs work on any subpath

### Environments (configured in Vercel dashboard, not vercel.json)
- **Production**: `main` branch → publishes to primary URL
- **Preview**: `dev` branch + all other branches/PRs → auto-generated preview URLs
- Single `vercel.json` serves both environments identically

### Deploy steps (manual, one-time)
1. Connect GitHub repo `RuFFuS4/bichitos-rumble` to Vercel project
2. Import project → Vercel auto-detects Vite framework and `vercel.json`
3. Set production branch to `main` in Vercel → Settings → Git
4. Push to `dev` → generates preview URL
5. Merge to `main` when stable → publishes to production URL

### Files created/modified
- `vercel.json` (new)
- `BUILD_LOG.md`, `README.md`, `SUBMISSION_CHECKLIST.md` — deploy docs

## 2026-04-10 — Sprint: Real deploy + cleanup pass

Goal: leave the project actually deployed and accessible, plus a controlled
cleanup pass before continuing to grow new features.

### Real deploy live
**Public URL: https://www.bichitosrumble.com**

- Vercel project `ruffus4s-projects/bichitos-rumble` created via `vercel deploy`
- Production deploy verified end-to-end:
  - `/` → 200, serves the game HTML with bundle `index-DF621XLp.js`
  - `/test` → 200, SPA rewrite serves `index.html`
  - `/cualquier-ruta-loca` → 200, SPA rewrite confirmed
  - HTML contains expected markers: `Bichitos Rumble`, `hud-lives`,
    `ability-bar-container`, jam widget script
- Custom domain `www.bichitosrumble.com` already aliased to production deploy
- Preview-style URL `bichitos-rumble-...vercel.app` returns 401 due to
  Vercel Deployment Protection on the project (custom domain bypasses it)
- `.vercel/` was added to `.gitignore` automatically by `vercel link`
- `dev` merged into `main` (fast-forward), both branches now contain the
  full sprint state and are pushed to GitHub

### Git ↔ Vercel integration status
- The current deploy was done via `vercel deploy --prod` from the CLI.
  This is a real, working production deploy, but it is NOT yet wired to
  push-triggered deployments.
- To enable `main → production` and `dev → preview` automatically on push,
  the GitHub repo must be connected to the Vercel project from the dashboard:
  Project → Settings → Git → Connect Git Repository.
- Until that step is done, deploys must be triggered manually with
  `npx vercel deploy --prod` from the project root.

### Code cleanup pass
Before deploying, did a controlled review of `src/` and applied 5 targeted
fixes. Nothing was rewritten, no behaviour changed, build/tests stayed green.

| Issue | File | Type | Fix |
|---|---|---|---|
| `FALL_SPEED = 12` defined but unused | `physics.ts` | Dead code | Removed |
| `isHitStopped()` exported but unused | `gamefeel.ts` | Dead export | Removed |
| `initialRadius` field defined but never read | `arena.ts` | Dead field | Removed |
| `position.y -= 12 * dt` magic number duplicating `FALL_SPEED` | `critter.ts` | Hardcode | Moved to `FEEL.lives.fallSpeed` |
| `fireEffect(state, critter, [], null!)` in activateAbility | `abilities.ts` | Type landmine | Removed; firing happens fully inside `updateAbilities`, which always has scene |

The `null!` fix is structural: previously, abilities with `windUp <= 0`
fired their effect inside `activateAbility` with a `null!` scene. Any
future ability with no wind-up that needed scene (e.g. spawning a VFX)
would have crashed. Now `activateAbility` only sets state; `updateAbilities`
fires the effect on the same frame (player.ts → bot.ts → updateAbilities)
with a real scene reference. Same behaviour, no landmine.

### Verification
- `npx tsc --noEmit` → clean, zero errors
- `npm run build` → 16 modules, 493 KB (125 KB gzip), 565 ms
- `npx vite preview` local → `/`, `/test`, `/assets/...` all 200
- Vercel build in iad1 → READY, restored cache, build 1.66s
- Public URL responds 200, content matches local build

### Files modified
- `src/abilities.ts` — `activateAbility` no longer fires effect; tick handles it
- `src/arena.ts` — removed unused `initialRadius`
- `src/critter.ts` — fall speed reads `FEEL.lives.fallSpeed`
- `src/gamefeel.ts` — added `lives.fallSpeed`, removed `isHitStopped`
- `src/physics.ts` — removed dead `FALL_SPEED` const
- `.gitignore` — added `.vercel/` (auto by vercel link)

### What this sprint achieved
- Project is now publicly playable at a stable, custom URL
- Branches `main` and `dev` are both up to date and pushed
- Codebase has 5 fewer landmines/duplicates
- vercel.json + SPA rewrite verified against real Vercel infra
- Deploy flow is documented and reproducible

## 2026-04-10 — Sprint: Visible presentation

Goal: give the public build actual game shape — a front-facing flow and
the first real identity for each critter, without touching deep systems.

### What was built

**1. Full game flow with three new screens**
- **Title screen** — oversized `BICHITOS RUMBLE` title with a yellow→red
  gradient on "RUMBLE", tagline, blinking "Press SPACE to start" prompt,
  and a subtle controls hint at the bottom.
- **Character select** — 4 cards in a row, each showing a colored preview
  circle (critter color), name, uppercase role label, one-line tagline,
  and raw stats (SPD/MAS/HIT). Arrow keys / A-D navigate, SPACE confirms.
  The selected card scales up, highlights, and lifts slightly.
- **End screen** — large VICTORY / ELIMINATED / SURVIVED / TIME UP label
  with per-result color (green/red/yellow), critter-specific subtitle,
  and R restart / T title prompt.

All three share a common `.full-overlay` style: blurred dark gradient
background so the 3D scene stays visible but dimmed behind them.

**2. Critters actually differentiated**
Each critter now has a unique role, tagline, stats, and ability tuning.
Abilities use the same base types (dash + AoE) but feel distinct:

| Critter | Role | Ability 1 | Ability 2 |
|---|---|---|---|
| **Rojo** | Balanced | Charge Rush (standard) | Ground Pound (standard) |
| **Azul** | Skirmisher | Quick Dash (faster, shorter, lighter) | Sharp Stomp (smaller radius, lower cooldown) |
| **Verde** | Crusher | Heavy Charge (slower, 3x mass) | Earthquake (huge radius, huge force, long wind-up) |
| **Morado** | Glass Cannon | Blitz (longest impulse, lighter mass) | Shockwave (mid radius, strong force) |

Stats are also tuned per critter (Rojo balanced, Azul faster/lighter,
Verde slower/heavier, Morado fastest/lightest). Abilities use a factory
pattern (`makeChargeRush(overrides)`, `makeGroundPound(overrides)`) so
tuning stays readable and config-driven.

**3. Game state machine expanded**
Added `title` and `character_select` phases before `countdown`. Full flow:
```
title → character_select → countdown → playing → ended
                                                   ↓
                                                   restart → countdown
                                                   back    → title
```
The player no longer always controls critter[0]. `playerIndex` is set
from `selectedIdx` on each match start. Bot AI loop skips the player
slot, so any of the 4 critters can be the player.

**4. Edge-detected input for menus**
`player.ts` now tracks a `freshKeys: Set<string>` of keys pressed since
the last consume. The keydown listener adds to the set (ignoring
`e.repeat` so held keys don't re-fire). `consumeKey(code)` returns
true exactly once per physical press, cleanly distinguishing held-Space
during combat from fresh Space to confirm a menu selection.

### Files changed
- `src/abilities.ts` — factory functions + 4 unique ability sets
- `src/critter.ts` — `role` + `tagline` fields, differentiated presets
- `src/player.ts` — `freshKeys` Set, `consumeKey` edge detection, `clearFreshKeys`
- `src/hud.ts` — `showTitleScreen`, `showCharacterSelect`,
  `updateCharacterSelect`, `showEndScreen`, `showMatchHud`, `EndResult` type
- `src/game.ts` — new phase types, `enterTitle/CharacterSelect/Countdown/Ended`,
  player slot by index, input handling per phase
- `index.html` — 3 full overlay markups + CSS for title/select/end + cards

### Verification
- `npx tsc --noEmit` → clean
- `npm run build` → 16 modules, 497 KB (127 KB gzip), 557 ms
- HTML served locally contains all new markers: `title-screen`,
  `character-select`, `end-screen`, `game-title`, `critter-cards`,
  `BICHITOS`, `Choose your`
- Synthetic keyboard input could not be verified inside the headless
  preview tool (`requestAnimationFrame` doesn't tick when the preview
  tab is not focused, so the game loop doesn't advance), but the code
  is sound and will be verified on the live Vercel deploy.

### Intentionally not in this sprint
- No sound effects
- No screen shake
- No particle systems
- No camera polish beyond what already exists
- No bot AI improvements
- No refactor

## 2026-04-10 — Sprint: Game feel impact + input abstraction

Focus: make hits feel weighty, fix the two most broken critters, and
prepare the input path for future mobile without implementing touch yet.
No new systems, no refactor.

### 1. Critical review of the live build (static)
Static code review of what's deployed on www.bichitosrumble.com.
Not a live playtest — I can't actually play it — but a predictable list
of problems based on the code:

| Issue | Severity |
|---|---|
| Hit impacts lack drama (only subtle scale + tilt) | **High** |
| Ground Pound shockwave is a hairline ring, barely visible | **High** |
| Verde Earthquake covers 40% of arena with 40 force — "I win" button | **High** |
| Morado is too fragile between its ability cooldowns | Medium |
| Azul's "faster" (+10% vs Rojo) is imperceptible | Medium |
| Bots use the same logic regardless of critter | Low (out of scope) |
| Camera is fixed (no player follow) | Low |

### 2. Game feel: visible impact

**Camera shake** — new system in `gamefeel.ts`:
- `triggerCameraShake(intensity)` — stacks by max, decays quadratically
- `updateCameraShake(camera, baseX, baseY, baseZ, dt)` — writes absolute
  position each frame (no drift)
- Decay: 0.18s. Headbutt: 0.22 amplitude. Ground Pound: 0.45 amplitude.
- Main loop calls it after `game.update()` and before render
- Base camera position snapshotted at init so shake never accumulates
- Triggered from `physics.ts` (headbutt collisions) and from
  `abilities.ts fireGroundPound` (every slam, not only hits)

**Hit flash** — new system in `gamefeel.ts`:
- `applyHitFlash(critter)` sets a 0.11s timer via WeakMap
- `tickHitFlash(critter, dt)` returns current intensity 0..1
- Integrated into `applyImpactFeedback` — every time a critter gets
  hit (headbutt or ground pound AoE), the target flashes white
- `critter.update()` calls `tickHitFlash` AFTER `updateVisuals` so the
  flash always overrides the state emissive (body + head both go white)
- Clear, unambiguous "I got hit" read

**Ground Pound shockwave rebuilt**:
- Old: single TorusGeometry with tube 0.12, 300ms, 0.8 opacity
- New: **two concentric rings**
  - Outer red torus (tube **0.28**), eases out to `maxRadius × 1.1`,
    450ms duration
  - Inner white flash (tube 0.18), grows faster, fades in half the time
- Much more readable at a glance

### 3. Critter tuning

Fine-tuned 5 values based on predicted imbalances:

| Critter | Change | Why |
|---|---|---|
| **Azul** | `speed 11 → 12` | +10% vs Rojo was imperceptible |
| **Azul** | `Quick Dash impulse 20 → 22` | Match the new baseline, feels distinctly faster |
| **Verde** | `Earthquake radius 4.8 → 4.2` | 40% arena coverage was oppressive |
| **Verde** | `Earthquake force 40 → 34` | Still the hardest-hitting AoE, no longer game-ending |
| **Verde** | `Earthquake cooldown 7.5 → 8.5` | More downtime between slams |
| **Morado** | `headbuttForce 11 → 13` | No longer helpless between Blitz cooldowns |
| **Morado** | `Blitz cooldown 3.5 → 3.0` | Burst comes around more often — rewards the glass cannon playstyle |

### 4. Input abstraction layer (for future mobile)

New file **`src/input.ts`** (~140 lines). Device-agnostic input layer.
Game logic and player controller no longer read physical keys — they
read from this module's abstract API. Adding touch input later means
adding one new backend file; no changes to game/player code.

**Public read API:**
- `getMoveVector(): { x, z }` — normalized movement vector
- `isHeld(action)` — action is one of `'headbutt' | 'ability1' | 'ability2'`
- `consumeMenuAction(action)` — edge-detected, `'confirm' | 'back' | 'left' |
  'right' | 'up' | 'down' | 'restart'`
- `clearMenuActions()` — drop stale edges on phase transitions

**Public write API (for device backends):**
- `_setMove(x, z)`, `_setHeld(action, value)`, `_pushMenuAction(action)`

**Capability detection:**
- `hasTouchSupport()` — probes `ontouchstart` and `navigator.maxTouchPoints`
- `isNarrowViewport()` — `innerWidth < 900`
- `isLikelyMobile()` — combination of both

**Keyboard backend**: always active, lives inside `input.ts`. Edge
detection via `e.repeat` check. WASD/Arrows cover movement AND menu
navigation; Space/Enter confirm; T/Escape back; R restart.

**How to add touch later** (documented inline in `input.ts`):
1. Create `src/input-touch.ts`
2. Listen to touchstart/touchmove/touchend
3. Call `_setMove`, `_setHeld`, `_pushMenuAction` based on UI state
4. Import from `main.ts` conditionally via `isLikelyMobile()`

`player.ts` rewritten to use `getMoveVector()` + `isHeld()`. `game.ts`
rewritten to use `consumeMenuAction()` on all menu transitions.
`clearMenuActions()` is called on every phase entry to kill stale edges
from in-game key presses leaking into menus.

### Files created/modified
- `src/input.ts` (NEW) — full abstraction layer + keyboard backend
- `src/player.ts` — no keyboard access, reads input abstract API
- `src/game.ts` — `consumeMenuAction` instead of `consumeKey`,
  `clearMenuActions` on every phase entry
- `src/abilities.ts` — tuning for Azul/Verde/Morado, camera shake on
  ground pound, rebuilt `spawnShockwaveRing` (2 concentric rings)
- `src/critter.ts` — baseline stat tuning, hit flash integrated into
  `update()` (runs after `updateVisuals` to override emissive)
- `src/physics.ts` — `triggerCameraShake` on headbutt connect
- `src/gamefeel.ts` — `FEEL.shake`, `FEEL.hitFlash`, camera shake system,
  hit flash system, `applyImpactFeedback` now triggers hit flash
- `src/main.ts` — snapshot base camera position, call `updateCameraShake`
  after game.update and before render

### Verification
- `npx tsc --noEmit` → clean
- `npm run build` → 17 modules (16 → +input.ts), 499 KB (127 KB gzip), 749 ms
- All config values centralized in FEEL
- No gameplay logic changed — only visual/tuning/abstraction

### Intentionally NOT in this sprint
- Touch input implementation (only the abstraction base is ready)
- Sound effects
- Bot AI changes
- Refactor
- Particle systems beyond the shockwave rebuild
- Camera follow / cinematic camera

## 2026-04-10 — Sprint: Cleanup + audio + mobile + ULTI design

Focused consolidation sprint before growing further. 5 blocks, all small
or medium, no refactor.

### 1. Cleanup pass
- **Leak fixed** in `src/preview.ts swapCritter`: each Critter creates 8
  geometries + 8 materials (body, head, 2 eyes, 2 pupils). When the
  player navigates the character select with arrow keys, the old critter
  was removed from the holder group but its GPU resources were NOT
  disposed. Rapid navigation would accumulate orphan allocations.
  Added `disposeMeshTree()` helper that traverses a tree and calls
  `dispose()` on every mesh's geometry + material. Called before setting
  `critter = null`.
- Audited `.dispose()` sites across src/: shockwave rings in
  `abilities.ts` already dispose correctly (4 disposes per slam). Arena
  and main-scene critters are persistent — no leak path.
- Audited console.logs: 4 diagnostic logs in `main.ts` remain
  intentionally (they saved us during the WebGL context bug sprint).
- Audited pointer listeners in `preview.ts` and `input.ts`: registered
  once, never removed, correct.

### 2. Future improvements documented in MEMORY.md
- **Character select polish**: slot slide-in transitions, stat bar bounce
  keyframes, selection tick sound
- **Per-critter pedestals** in the preview system: architecture sketch
  with `pedestal` field on `CritterConfig`, builder map in preview.ts
- **Winner posing screen**: reuse preview.ts on the end overlay, fade
  out arena, show the winning critter on its pedestal

### 3. ULTI system design — `ULTI_DESIGN.md` (new file)
Full design doc for the Ultimate Ability system. NOT implemented.

Key points:
- **Structure**: reuse existing ability system. Ulti = third slot in
  `CRITTER_ABILITIES[name]`. Adds `isUltimate?: boolean` to `AbilityDef`.
- **New ability types** added to the `AbilityType` union:
  `'rampage' | 'phantom_strike' | 'titan_slam' | 'glass_storm'`
- **Input**: `KeyL` on desktop (natural extension of J/K). 4th touch
  button on mobile with golden border + pulse when ready.
- **HUD**: third slot in `#ability-bar-container`, 1.3× bigger, gold
  accents, circular radial fill instead of linear bar.
- **Character select**: ulti box below the stat bars with "ULTIMATE"
  label, ulti name in critter color, one-line description.
- **Per-critter concepts**:
  - Rojo — "Rampage": 3s invincible berserker mode (spam headbutts)
  - Azul — "Phantom Strike": teleport behind nearest + 3× headbutt
  - Verde — "Titan Slam": jump offscreen, land with screen-wide slam
  - Morado — "Glass Storm": spin and fire 5 mini-Blitzes in a star
- **Estimated implementation effort**: 5-6h when the user greenlights

### 4. Audio system — `src/audio.ts` (new file)
First audio pass using the **Web Audio API directly with synthesized
sounds**. No Howler, no asset files, zero network latency, 0 KB added
to static assets.

**6 sounds, all synthesized:**
- `headbuttHit`: 170→60 Hz sine thump + high-passed noise crack (140 ms)
- `groundPound`: 80→35 Hz sawtooth + low-passed noise rumble (450 ms)
- `abilityFire`: 220→660 Hz triangle sweep + band-passed noise (180 ms)
- `fall`: 440→80 Hz descending sine (550 ms)
- `respawn`: C5-E5-G5 triangle arpeggio (300 ms total)
- `victory`: C5-E5-G5-C6 triangle chord held (900 ms)

**Architecture:**
- `AudioContext` lazily created on first `play()` call (respects browser
  autoplay policies — always triggered by a user key press or tap)
- Shared noise buffer allocated once, reused by every noise-based sound
- Master gain node (0.35) connected to destination
- `setMuted(bool)` and `isMuted()` for future settings menu
- `play(name: SoundName)` public API

**Wired into gameplay:**
- `physics.ts` → `'headbuttHit'` on every headbutt collision
- `abilities.ts` → `'abilityFire'` in fireChargeRush, `'groundPound'` in
  fireGroundPound
- `critter.ts` → `'fall'` in startFalling(), `'respawn'` in respawnAt()
- `game.ts` → `'victory'` in enterEnded('win', ...)

### 5. Mobile touch controls
Full working touch backend using the existing input abstraction. No
changes to game logic or player controller — the touch module just
writes into `_setMove` / `_setHeld` via the abstract API.

**New file**: `src/input-touch.ts` (~160 lines)
- `initTouchInput()` — idempotent setup, adds `touch-mode` class to body
- **Virtual joystick** (left bottom, 140 px base, 62 px handle):
  - Pointer events with pointer capture (handles drag outside the base)
  - Center recomputed on resize / orientationchange
  - Clamp to 50 px radius, normalize to ±1, dead zone 12% for jitter
  - Handle visually follows the finger within the base
  - On release → `_setMove(0, 0)` and reset handle
- **3 action buttons** (right bottom):
  - Triangular cluster: J top-right, headbutt (larger, ⚡) bottom-right,
    K bottom-left
  - Pointer events with pointer capture
  - pointerdown → `_setHeld(action, true)` + `.pressed` class (scale + glow)
  - pointerup / leave → `_setHeld(action, false)`

**Activation**: `main.ts` calls `initTouchInput()` only if
`isLikelyMobile()` returns true (from `input.ts` — capability probe,
not user-agent sniffing). Desktop users never see the touch UI.

**CSS**:
- `#touch-controls` fixed, pointer-events: none (children are auto)
- Hidden by default; shown only when `body.touch-mode` is set
- `touch-action: none` on joystick and buttons to prevent browser scroll
- `user-select: none` and `-webkit-tap-highlight-color: transparent` to
  kill mobile defaults

**Compatibility with desktop**: the keyboard backend in `input.ts`
stays active regardless. Both write into the same abstract state. A
desktop user never initializes the touch backend, so DOM touch listeners
don't exist. A mobile user with an external keyboard would get both.

### Files created / modified
**Created:**
- `src/audio.ts` (~210 lines)
- `src/input-touch.ts` (~160 lines)
- `ULTI_DESIGN.md` (design doc)

**Modified:**
- `src/preview.ts` — disposeMeshTree helper, called on swapCritter
- `src/physics.ts` — playSound('headbuttHit') on collisions
- `src/abilities.ts` — playSound('abilityFire' / 'groundPound')
- `src/critter.ts` — playSound('fall' / 'respawn')
- `src/game.ts` — playSound('victory') on win
- `src/main.ts` — initTouchInput() conditionally
- `index.html` — touch controls markup + CSS
- `MEMORY.md` — future improvements documented

### Verification
- `npx tsc --noEmit` → clean
- `npm run build` → 17 modules (audio + input-touch added), 508 KB
  (130 KB gzip), 605 ms
- Size growth: +5 KB (~1 KB gzip) for audio system and touch controls

### Intentionally NOT in this sprint
- ULTI system implementation (design only, awaiting go)
- Touch UI polish (final positions, animations)
- Audio settings menu (mute button)
- Custom sound sources (all synthesized)
- Winner posing screen (documented, not built)
- Per-critter pedestals (documented, not built)

## 2026-04-10 — Sprint: Playtest fixes + docs refresh

First playtest report from the user surfaced 4 concrete issues. Small,
targeted fixes. No refactor. Also a full docs refresh across the project.

### Playtest issues reported and fixed

**1. Immunity blink was invisible**
Root cause: the critter materials were created without `transparent: true`.
When `updateVisuals()` tried to set opacity and flip transparent mid-frame,
Three.js silently ignored the opacity changes (would need `needsUpdate`
to recompile the shader).

Fix:
- Materials now initialized with `transparent: true, opacity: 1.0` from
  the constructor. Harmless when fully opaque.
- Blink uses a **square wave** (not sine) for crisper on/off
- During "on" frames: white emissive tint at intensity 0.8 (head) / 0.5 (body)
- During "off" frames: opacity drops to **0.15** (was 0.3, now clearly
  dramatic)
- Rate remains at `FEEL.lives.blinkRate` (8 Hz)

**2. Arena rings disappeared with no warning**
Root cause: the old code turned the ring red and called `setTimeout` for
600 ms before hiding. No blink, no margin — and the `currentRadius`
shrunk IMMEDIATELY, so critters on the ring were already "off arena"
during those 600 ms and started falling.

Fix: rewrote `arena.ts` with a proper warning system.
- New `CollapseWarning` struct tracked in `this.warnings[]`
- Each warning has a 1.5s timer during which the ring blinks red with an
  accelerating rhythm (4 Hz → 16 Hz over the warning duration)
- Intensity ramps up too (0.3 → 1.0)
- Square-wave blink for crispness
- **Critically**: `currentRadius` is NOT shrunk until the ring actually
  disappears at the end of the warning. Players have real physical
  margin to step off during the blink.
- The 20s collapse interval kept — effective playable time per ring is
  18.5s + 1.5s warning

**3. Sound toggle button**
Added a top-right settings cluster with a single 🔊/🔇 toggle button.
- `src/audio.ts` exposes `toggleMuted()`, `loadMutedState()`,
  `isMuted()`
- Mute state persisted in localStorage under `bichitos.muted`
- Loaded at init in `main.ts` before the button wiring
- Button reflects state visually (icon + `.muted` class for opacity)
- Only one toggle for now (covers all SFX since there's no music yet);
  settings UI has room for a second button when/if music is added

**4. Mobile UX fixes**
User couldn't play on mobile because:
- "Press SPACE to start" was shown but there's no keyboard
- No way to confirm character selection without a keyboard
- End screen asked for "R to restart"
- Portrait mode was the default and broke the layout
- Desktop hints cluttered the mobile screen

Fixes:

*Portrait landscape lock*:
- New `#rotate-prompt` overlay with a rotating phone icon and "Please
  rotate your device" text
- CSS `@media (orientation: portrait)` + `body.touch-mode` combo → only
  appears on touch devices in portrait, invisible on desktop

*Desktop/touch hint differentiation*:
- Added `.desktop-only` and `.touch-only` CSS classes
- `body.touch-mode .desktop-only { display: none !important }` hides
  keyboard hints on mobile
- Without `body.touch-mode`, `.touch-only` elements are hidden
- Title, character select, and end screens now carry both versions of
  their prompt text

*Tap menus*:
- `hud.ts` registers click listeners on the title screen and end screen
  overlays (work for both mouse click and touch tap)
- Exposes `setTitleTapHandler`, `setEndTapHandler`, `setSlotClickHandler`
  for game.ts to wire phase transitions
- `game.ts` registers: title tap → enterCharacterSelect, end tap →
  enterCountdown, slot click → select-or-confirm logic
- Slot click on unselected slot → select + refresh preview
- Slot click on already-selected slot → confirm and enter match
- Locked slots ignore clicks
- The keyboard flow still works unchanged (arrow keys + Space + T)

### Files created / modified
**Modified only** (no new files this sprint):
- `src/critter.ts` — materials with transparent: true, dramatic blink
- `src/arena.ts` — collapse warning system, deferred radius shrink
- `src/audio.ts` — toggleMuted, loadMutedState, localStorage persistence
- `src/hud.ts` — settings button ref, tap handlers + setters,
  setSlotClickHandler with select-or-confirm logic
- `src/game.ts` — wire tap/click handlers in constructor
- `src/main.ts` — load mute state, wire sound button
- `index.html` — settings button, rotate prompt, desktop-only/touch-only
  classes on all menu hints

### Docs refreshed in this sprint
- **STACK.md**: added `audio.ts`, `input.ts`, `input-touch.ts`,
  `preview.ts` to the architecture list; updated `player.ts` description
  to reflect input abstraction
- **GAME_DESIGN.md**: updated Rojo abilities table with current values,
  added per-critter ability listings for Azul/Verde/Morado, updated
  Arena section with warning blink, updated Phase 1 → Current Scope,
  Game Feel section expanded with shake/flash/immunity/ring-warning/audio
- **RULES.md**: updated match duration (90 → 120), collapse interval
  (15 → 20), critter stats table (new speed/mass/power values per
  preset), added mobile controls section, added per-critter ability
  table, added lives + immunity mechanics
- **SUBMISSION_CHECKLIST.md**: checked off sound effects, screen shake,
  hit flash, arena warning, immunity blink, rotatable preview; checked
  off git auto-deploy and mobile support in Deployment
- **README.md**: updated Deployment section (git auto-deploy is now
  active), added Mobile controls section, updated Tech Stack (two
  renderers, Web Audio), updated Status to v0.3
- **MEMORY.md**: added Mobile Support, Audio, Arena Collapse, and
  Immunity Blink sections with the decisions made this sprint

Not touched:
- `CLAUDE.md` — project rules, unchanged
- `ULTI_DESIGN.md` — future design, unchanged
- `ERROR_LOG.md` — no new recurring errors
- `PROMPTS.md` — only the initial kickoff prompt, sprint history is in
  BUILD_LOG instead

### Verification
- `npx tsc --noEmit` → clean
- `npm run build` → 509 KB (130 KB gzip), 604 ms
- Size growth: +1.5 KB vs previous sprint

### Intentionally NOT in this sprint
- ULTI system implementation (still awaiting go)
- Winner posing screen (documented, not built)
- Per-critter pedestals (documented, not built)
- Background music (settings button has room when added)
- Touch UI visual polish beyond functional

### Next sprint options
1. **Implement ULTI system** following `ULTI_DESIGN.md` (5–6 h)
2. **Winner posing screen** on end overlay using preview.ts
3. **Per-critter pedestals** in the preview scene
4. **Playtest report round 2** on the fixes delivered in this sprint
5. **Background music** (would also need a second toggle button)

---

## 2026-04-12 — Phase A: Engine Preparation for 9-Character Roster

### Context
The 4 current critters (Rojo, Azul, Verde, Morado) are **placeholders/scaffolding**.
The real target roster is 9 characters defined in `CHARACTER_DESIGN.md`, each with
2 abilities + 1 ultimate. This sprint prepares the engine to absorb N critters,
3 abilities per critter, and per-critter stats — without implementing any final
character or changing gameplay.

### Discipline constraint
Avoid gameplay/HUD/input coupling, avoid hiding state in visual layer. Do NOT
introduce networking abstractions — only clean up local architecture.

### Tasks completed (6 commits, 8 files, +351 / −42 lines)

| Task | Commit | What |
|------|--------|------|
| T1 | `969c5a4` | `headbuttCooldown?: number` in `CritterConfig` — per-critter override, falls back to `FEEL.headbutt.cooldown` |
| T2 | `938f296` | Dynamic match builder: pure `buildMatchRoster()` + `rebuildCritters()` + `Critter.dispose()` for GPU cleanup |
| T3 | `3c770d3` | `AbilityTag` type + `tags` field on `AbilityDef` + `findAbilityByTag()` helper. Bot AI fully decoupled from slot indices |
| T4 | `ef7df30` | `HeldAction.ultimate` + `KeyL` mapping + null-safe hook in `player.ts`. Reserved `#critter-info-ulti` in character select |
| T5 | `c6f9980` | 4th touch button (`data-action="ultimate"`) in 2×2 cluster layout (200×200). No backend changes needed |
| T6 | `ede05ad` | `src/stats.ts` — localStorage persistence (`br-stats-v1`). Zero gameplay imports. Hooks in `game.ts`: pick / outcome / fall |

### Key decisions
- **Bot AI uses semantic tags, not slot indices.** `findAbilityByTag('mobility')` / `findAbilityByTag('aoe_push')` means critters can reorder or omit abilities without breaking the bot. Unknown tags are silently ignored.
- **Match builder is a pure function.** `buildMatchRoster(playerIdx, presets, botCount)` wraps around the presets array. `rebuildCritters()` disposes old Three.js resources before spawning new ones — no GPU leaks on roster changes.
- **Stats module has zero coupling.** `src/stats.ts` receives plain strings (`critterName`) and a `'win'|'lose'` enum. Does not import Critter, Game, HUD, or anything from gameplay. Only `game.ts` calls the 3 recording functions.
- **Ultimate slot is null-safe.** `abilityStates[2]` is `undefined` for current placeholders. `player.ts` guards with `&& critter.abilityStates[2]`. HUD iterates `states.length` — 3rd slot auto-appears when a critter has 3 abilities.
- **Touch layout shifted from triangle (3 buttons) to 2×2 grid (4 buttons).** Headbutt stays bottom-right as the largest button.

### Files touched
- `src/critter.ts` — T1 (optional field), T2 (dispose method)
- `src/game.ts` — T2 (match builder, rebuildCritters), T6 (stats hooks)
- `src/abilities.ts` — T3 (AbilityTag, tags field, findAbilityByTag)
- `src/bot.ts` — T3 (full rewrite to tag-based decisions)
- `src/input.ts` — T4 (ultimate in HeldAction union + KeyL mapping)
- `src/player.ts` — T4 (ultimate hook with null guard)
- `index.html` — T4 (critter-info-ulti placeholder), T5 (4th touch button + CSS)
- `src/stats.ts` — T6 (new file)

### Verification
- `npx tsc --noEmit` → clean after every commit
- `npm run build` → 512 KB (131 KB gzip), 600 ms — +3 KB vs previous sprint
- `buildMatchRoster` tested in isolation: N=9, idx=8 wraps correctly, idx=99 and idx=-1 safe, N=0 returns []
- Stats module exercised in Node mock: pick/win/loss/fall counters persist and reload correctly
- Module coupling audit: stats imports 0, input imports 0, bot imports only critter+abilities+gamefeel, HUD imports only types

### Open debts (small)
- No runtime browser test framework — all validation is build + static + isolated Node
- 4th touch button not tested on a real mobile device yet (code path identical to J/K)
- Stats are collected but not displayed anywhere yet (intentional — display is a later task)

---

## 2026-04-12 — Phase B: Sergei (first real roster character)

### What was built
Sergei (gorilla, Balanced) — first character from the final 9-character roster.
Validates the 3-ability pipeline from Phase A.

Kit: Gorilla Rush (J, charge_rush), Shockwave (K, ground_pound), Frenzy (L, buff ultimate).
Frenzy is a pure stat buff: +30% speed, +35% mass for 4s with 18s cooldown.

### Files changed (4 files, +87 / −1 lines)
- `src/gamefeel.ts` — `FEEL.frenzy` tuning section
- `src/abilities.ts` — `'frenzy'` AbilityType, `'buff'` AbilityTag, `makeFrenzy()`,
  `fireFrenzy()`, Sergei in CRITTER_ABILITIES
- `src/critter.ts` — Sergei in CRITTER_PRESETS, frenzy visual in updateVisuals()
- `src/bot.ts` — `'buff'` tag heuristic

### Key decisions
- Frenzy multipliers are conservative (speed ×1.3, mass ×1.35) pending playtest
- Frenzy visual: pulsing deep-red glow via `sin(Date.now())`, no VFX system
- Bot uses Frenzy when near enemy (dist < 3.5), low probability (0.8%/frame)

---

## 2026-04-13 — Visual Pipeline + Sergei GLB Integration

### What was built
Complete 3D model loading pipeline, validated end-to-end with Sergei.

### New files (7)
- `STYLE_LOCK.md` — mandatory visual rules
- `ASSET_PIPELINE.md` — asset integration guide + optimization record
- `scripts/optimize-models.mjs` — reproducible GLB optimization pipeline
- `public/models/critters/sergei.glb` — 425 KB, 7K verts (from 40 MB, 956K verts)
- `public/draco/` — Draco WASM decoder (1.1 MB, for future compressed models)
- `src/model-loader.ts` — GLTFLoader + cache + deep clone + material isolation
- `src/roster.ts` — 13-entry data-driven roster (9 real + 4 internal)

### Modified files (5)
- `src/critter.ts` — async GLB swap, procedural fallback, configurable radius
- `src/hud.ts` — roster-aware grid (playable/wip/locked status)
- `src/game.ts` — display roster for select, preload in countdown, confirm guard
- `index.html` — WIP slot CSS
- `package.json` — devDeps for gltf-transform + meshoptimizer

### Key decisions
- **Procedural mesh always built** (sync), GLB swaps in async. Body/head stay as
  invisible references — existing code runs harmlessly on hidden meshes.
- **Deep clone + material isolation** per critter instance. Textures shared (read-only).
- **Race guard** in attachGlbMesh: discards GLB if critter was disposed during load.
- **Placeholders invisible in UX** (status 'internal'), used only for bots.
- **Only Sergei GLB integrated**. Other 8 have roster entries with WIP status.

### Verification
- Build: 624 KB JS (163 KB gzip) — +111 KB from GLTFLoader/DRACOLoader
- Optimization: Sergei 956K → 7K verts, 40 MB → 425 KB
- Typecheck clean

### Open debts
- Sergei GLB never validated visually in browser (scale/pivotY may need tuning)
- public/draco/ (1.1 MB) is currently unused — models are not Draco-compressed
- 8 remaining GLBs need optimization before integration

---

## 2026-04-13 — Compliance Fix: Widget URL Update

### What was fixed
Jam widget URL changed from `jam.pieter.com` to `vibej.am`. Updated in:
- `index.html` (the actual widget script tag)
- `README.md` (jam link)
- `SUBMISSION_CHECKLIST.md` (widget reference + added deadline/form info)

### Jam deadline
May 1, 2026 @ 13:37 UTC. Submission form: https://forms.gle/bGG4e3uD9PUUJKUc7

---

## 2026-04-13 — Post-validation fixes + merge to production

### Fixes applied (4 commits)
- Sergei GLB transform corrected: scale 2.0, rotation -π/2, pivotY 0.98
  (model was 0.93 units underground due to wrong pivotY)
- Stale abilities bug in WIP character select (early return skipped clear)
- Touch controls hidden in title/select/ended (CSS `.match-active` gate)
- `__tune()` debug tool gated behind `import.meta.env.DEV`

### Merge
15 commits merged dev → main (fast-forward). Production verified at
bichitosrumble.com. All features from Phase A, Phase B, and GLB pipeline
now live.

### Current production state
- 9-character roster grid (1 playable: Sergei with 3D GLB model)
- 8 WIP characters with planned ability info
- 4 internal placeholders for bot matches
- Widget: vibej.am/2026/widget.js (verified)
- Bundle: 624 KB JS (163 KB gzip) + 425 KB Sergei GLB + 1.1 MB Draco decoder

---

## 2026-04-14 — Portal feature closed + operational cleanup

### Portal feature — final state
Full arc of commits for the Vibe Jam portal (`3fe20d8` → `6df5c15`):
- `3fe20d8` feat: portal integration (exit + start portal scaffolding)
- `26193e8` feat: portal end-screen P/B flow + exit/return URLs
- `4f4b4dc` fix: clear portal context when returning to title (T)
- `1c69c95` polish: portal visuals + end screen + countdown pop
- `4f49d3f` feat: portal minimize/expand system + HUD legend
- `5a8fb06` fix: vertical door orientation + usable only when expanded
- `6df5c15` fix: particles orbit vertical ring + bump count to 28

Closing summary:
- Exit portal (green): always present, redirects to vibej.am/portal/2026
- Start portal (orange): only when arriving via `?portal=true&ref=...`
- Both minimized by default (0.5× scale, dim, tight hitbox disabled)
- Expand with P (desktop) or mobile toggle button
- Usable only when expanded (expansionT > 0.7), preventing combat accidents
- HUD legend panel top-left explaining portal colors + P key hint
- URL context cleanup on T (back to title) via history.replaceState
- 17 days to deadline, no further portal iterations unless bug

### Operational cleanup (2026-04-14)
- Removed `public/draco/` (unused decoder, 1.1 MB). Sergei GLB is not
  Draco-compressed and optimize-models.mjs doesn't apply Draco. Decoder
  files were not being fetched at runtime so initial load was unaffected,
  but they were dead storage on deploy.
- Removed DRACOLoader instantiation from `model-loader.ts`. Documented
  how to re-enable in a block comment if Draco is added later.
- Committed `CHARACTER_DESIGN.md` (was untracked — design reference for
  the 9-character roster).
- Updated docs to match reality post-merge:
  - SUBMISSION_CHECKLIST: Portal marked done, Submit Google Form moved
    to top as pending user action.
  - README: Status section mentions portal + minimize/expand. Controls
    table adds P and B keys with their phase-dependent behavior.
  - MEMORY: Next Priorities rewritten for the last 17 days — prioritize
    Google Form submission, Lighthouse measurement, 2-3 more playable
    characters with real GLBs.

### Bundle after cleanup
- 622 KB JS (163 KB gzip)
- 425 KB Sergei GLB
- Draco decoder removed → no longer in deploy

---

## 2026-04-16 — Fix: arena visual desync (Bloque B 3a follow-up)

### What was fixed
Bug: "outer ring stays rendered on one client even after server shrunk the radius."
Diagnosed by the previous commit (diagnostic logging). Root cause: `syncFromServer`
was using `collapsedRings` counter to determine ring visibility, but `collapsedRings`
could arrive in a partial or delayed state relative to `arenaRadius`.

### Fix
Replaced counter-based visibility with a **geometric check**:

```
const outerEdge = (i + 1) * ringWidth;
ring.visible = outerEdge <= radius + 0.1;
```

`arenaRadius` is the most reliable field — it already drives player falloff on both
clients. If a client correctly falls off the shrunken arena, its `radius` is correct,
and the ring will now also correctly disappear.

The epsilon (0.1) keeps the outermost ring visible during the warning phase (when
radius is still at max but the ring is blinking, not yet removed).

### Optimization added
`syncFromServer` no longer runs material traversals every frame. It tracks the
last synced `radius` and `warningRingIndex`:
- Visibility updates: only on `radius` change (every ~20s in normal play)
- Blink traversal: every frame only while a ring is warning
- Color restoration: only once on the frame when `warningRingIndex` transitions

This eliminates ~15 material.color/emissive writes per frame in stable state.

### Files changed
- `src/arena.ts` — `syncFromServer` rewritten, `reset()` clears sync tracking
- `src/game.ts` — removed diagnostic logs, simplified `syncFromServer` call

### Bundle
- 769 KB JS (209 KB gzip) — includes Colyseus; pre-existing chunking advisory

---

## 2026-04-17 — Bloque B #3b: Irregular Fragment Collapse

### What changed
Replaced the uniform 6-ring collapse system with seed-deterministic irregular
sector fragments. Both offline and online modes now use the same fragment system.

### Architecture
- **Shared generator** (`src/arena-fragments.ts` + `server/src/sim/arena-fragments.ts`):
  mulberry32 PRNG seeded per match. Generates 29 fragments: 1 immune center
  (r=0..2.5) + 28 collapsible sectors across 3 radial bands with angular jitter (25%).
  Collapse schedule: outer band → inner, shuffled within each band, 4-5 batches of
  4-8 pieces. Mixed timing: first batch at 20s, then 8-10s between.
- **Server ArenaSim**: seed-based, tracks alive[], collapseLevel, warningBatch.
  `isOnArena(x,z)` checks all alive fragments (polar sector test).
- **Client Arena**: ExtrudeGeometry sectors + CircleGeometry immune center.
  `buildFromSeed(seed)` for deterministic mesh generation. Offline: `update(dt)`.
  Online: `syncFromServer(seed, level, warningBatch)`.

### State sync (GameState)
- `arenaSeed`: sent once per match (deterministic layout generation)
- `arenaCollapseLevel`: completed batch count (0..totalBatches)
- `arenaWarningBatch`: batch currently blinking (-1 if none)
- `arenaRadius`: approximate max playable radius (for camera/respawn)

### Verified behaviour
- 120s simulation: 4 batches collapse by t≈53s, center immune persists
- isOnArena spatial queries correct (center=true, void=false)
- Both compilation targets clean, bundle +32KB (800 KB total)

### Files created
- `src/arena-fragments.ts`, `server/src/sim/arena-fragments.ts`

### Files changed
- `src/arena.ts` — full rewrite (fragment meshes, buildFromSeed, syncFromServer)
- `src/game.ts` — offline: buildFromSeed on countdown; online: seed-based sync
- `server/src/sim/arena.ts` — full rewrite (fragment-based ArenaSim)
- `server/src/state/GameState.ts` — new fields (arenaSeed, arenaCollapseLevel, etc.)
- `server/src/sim/physics.ts` — checkFalloff now receives isOnArena callback
- `server/src/BrawlRoom.ts` — seed generation on countdown, fragment state sync
- `server/src/sim/config.ts` — removed ring-specific values

---

## 2026-04-18 — Lab v2: DevApi layer + bots/gameplay/perf/input panels

### Why
The v1 lab (matchup tuner + arena inspector + animation sliders + playback)
was useful but the sidebar was calling `game.debug*` directly and any new
capability was heading straight into `Game`. With 5 days to jam and more
debug tools planned (bots, events, cooldown injection, perf, input,
gamepad) that was going to bloat `Game` fast. Added a DevApi layer.

### Architecture change
- **New file `src/tools/dev-api.ts`** (~270 LOC): `DevApi` class wrapping
  `Game` + `WebGLRenderer`. Owns every new lab capability. Game keeps only
  its 5 existing `debug*` primitives (speedScale, startOfflineMatch,
  forceArenaSeed, getArenaInfo, endMatchImmediately) — no new ones added.
- Sidebar (`src/tools/sidebar.ts`) now receives `DevApi` instead of `Game`.
- `src/tools/main.ts` instantiates DevApi once, passes to sidebar, ticks
  it each frame after render so `renderer.info` perf counters reflect the
  current frame.

### Debug surface delivered
1. **Bot AI panel (priority 1)** — per-bot behaviour dropdown (normal / idle
   / passive / aggressive / chase / ability_only) + bulk "all bots" control.
   Backed by new `Critter.debugBotBehaviour` field read each frame in
   `bot.ts`. Defaults to `normal` in production so nothing changes there.
2. **Gameplay panel (priority 2)** — live event log (headbutt, ability
   cast/end, fall, respawn, eliminate, collapse warn/batch, match start/end)
   via edge-detection polling (no engine patching), player cooldown bars,
   Reset-CDs / Force J / Force K / Force L buttons, teleport player to
   centre, teleport bots to presets (center/corners/line/bunch).
3. **Performance panel (priority 3)** — FPS (30-sample rolling average),
   frame ms, draw calls, triangles, geometries, textures, critter count,
   arena fragments alive/total. All from `renderer.info` + `DevApi` arena
   math.
4. **Input panel (priority 4)** — live move vector, held-actions chips
   (headbutt/ability1/ability2/ultimate), held KeyboardEvent codes,
   gamepad list via `navigator.getGamepads()`. Base ready for future
   gamepad + touch debug.

### Discarded / deferred on purpose
- **Online / netcode debug (priority 5)** — not implemented. The current
  online path only has 2-player rooms and the safety cost of adding
  mutable hooks to real rooms is too high for this jam. The DevApi note
  at the bottom of the file spells out the contract: online debug must be
  read-only by default; any mutation requires an explicit "connect as
  debug observer" opt-in.
- **Replay from mid-collapse** — skipped, covered well enough via
  `Force Seed` + `Replay Last` for deterministic reproduction.
- **Reaction-speed toggle on bots** — skipped, aggressive/passive/
  ability_only already cover the axes we actually wanted to isolate.

### Safety posture on `tools.html`
- `<meta name="robots" content="noindex, nofollow">` +
  `<meta name="googlebot" content="noindex, nofollow">` added.
- Banner "INTERNAL DEV TOOL · not for players" at top of sidebar.
- Title tag → "Bichitos Rumble — Lab (internal)".
- No link from the game UI at any point. Access via direct URL only.
- All mutations target the LOCAL game instance; no server/room write paths
  are exposed.

### Files created
- `src/tools/dev-api.ts`

### Files changed
- `src/tools/sidebar.ts` — rewritten to take `DevApi`; 4 new panels added.
- `src/tools/main.ts` — instantiates `DevApi`, ticks it each frame.
- `tools.html` — noindex meta + updated title.
- `src/critter.ts` — new `debugBotBehaviour: BotBehaviourTag = 'normal'` field.
- `src/bot.ts` — honours `bot.debugBotBehaviour` (idle/passive/aggressive/
  chase/ability_only/normal). Zero effect in production (default 'normal').
- `src/input.ts` — exports `getHeldKeyCodes()` and `getHeldActionsSnapshot()`
  for the Input panel. Game code still reads via `getMoveVector`/`isHeld`.

### Bundle impact
- `dist/assets/tools-*.js`: 10.04 kB → 25.58 kB (gzip 3.94 → 8.21 kB).
  Internal-only bundle, acceptable.
- `dist/assets/index-*.js` (main game): unchanged at 3.07 kB.
- `dist/assets/input-touch-*.js` (shared): +0.21 kB (two input exports).

### How to use (lab-side, console)
- `__devApi.setAllBotsBehaviour('idle')` — freeze every bot in place.
- `__devApi.setBotBehaviour(1, 'aggressive')` — bot at index 1 gets 3×
  ability fire rate + lower headbutt threshold.
- `__devApi.forceAbility(0)` — fire the player's J slot ignoring CD.
- `__devApi.resetPlayerCooldowns()` — all player cooldowns back to 0.
- `__devApi.teleportBotsPreset('corners')` — scatter bots to the 4 corners.
- `__devApi.getEventLog()` — last 60 events (timestamp + type + actor).

Sidebar surfaces all of the above as buttons/dropdowns too.

---

## 2026-04-19 — Lab v2.1: dropdown fix + full match recorder + DEV_TOOLS.md

### What changed

1. **Fix**: individual bot dropdowns in the Bots panel never opened. Root
   cause: `refreshBotsPanel` called `innerHTML = ''` every 250 ms and
   recreated every `<select>`, so the browser tore down the dropdown
   before it could render. Rewritten to cache row elements per
   `bot.index`, only update state on the existing DOM, and skip
   overwriting a select's `value` while it has focus (would close the
   open dropdown). Added the same guard pattern to any future panel
   that renders live lists with interactive widgets.
2. **Exhaustive match recorder** inside `DevApi`:
   - Session auto-starts with each `startMatch`. Previous session (if
     not downloaded) is overwritten.
   - Captures: every `GameplayEvent` (uncapped), every `LabAction`
     (force_ability, teleport_player, teleport_bots,
     set_bot_behaviour, set_all_bots_behaviour, reset_cooldowns,
     force_seed, set_speed, end_match), and one `RecordingSnapshot`
     every 200 ms with every critter's full state (pos/vel/lives/
     abilities/behaviour/etc), arena (collapseLevel/warning/radius) and
     perf (fps/frameMs/drawCalls/triangles).
   - Outcome auto-detected: `last_standing` when alive count drops to 1,
     `user_stopped` when `endMatch` is called, `match_timeout` when
     finalised without a survivor emerging.
   - Two download buttons in the sidebar: **Download JSON** (raw dump)
     + **Download MD** (human summary with events-by-type table,
     per-critter stats, arena timeline, lab actions, sampling stats).
   - Filename pattern: `bichitos-<ISO>-<player>-<bot1>-<bot2>-<bot3>.<ext>`.
   - Typical session size: 0.5–1.5 MB JSON for a 90 s match.
3. **`DEV_TOOLS.md`** added — single source of truth for the lab's
   architecture, panels, event types, recording format, how to extend,
   safety boundaries and TODOs. Living document: updated whenever the
   lab grows.

### Files created
- `DEV_TOOLS.md`

### Files changed
- `src/tools/dev-api.ts` — new types (RecordingSession, RecordingSnapshot,
  LabAction, RecordingMeta, RecordingOutcome, CritterFrame,
  LabActionType), recorder fields, `startRecording/stopRecording/
  isRecording/hasRecording/getRecording/clearRecording/
  downloadRecordingJSON/downloadRecordingMD`, snapshot sampling on
  `tick`, auto-outcome detection, per-mutation `logAction` calls,
  `buildRecordingSummaryMD` exported helper.
- `src/tools/sidebar.ts` — bot dropdown fix (DOM caching), new
  Recording panel, refresh function wired to the slow interval.
- `BUILD_LOG.md` — this entry.
- `NEXT_STEPS.md` — pointer to `DEV_TOOLS.md`.

### Verification
- Typecheck clean.
- Build clean (tools chunk ~40–42 kB expected after recorder weight;
  main game bundle unchanged).
- Manual checklist: open `/tools.html`, start a match, verify
  individual bot dropdowns open and changes apply, watch the
  Recording panel count events/actions/snapshots, let the match end,
  click `Download JSON` → verify filename + contents, click
  `Download MD` → verify summary renders.

---

## 2026-04-19 — Lab v2.2 + respawn safety fix (client + server)

### Gameplay fix: respawn in collapsed void

**Bug**: after fragmenting the arena into irregular sectors (Pattern A /
B), `pickRespawnPos` was picking `currentRadius * 0.4` with a fully
random angle and NO `isOnArena` check. On Pattern B (axis-split) in
particular, half of the ring is already gone at mid-match — if the
respawn roll landed there, the critter would reappear in the void and
fall again on the same frame.

**Fix** applied to both client and server (same logic in both):

- Up to 12 retries. Each retry shrinks the radius toward the immune
  islet (r=0.5..maxR, decreasing linearly).
- Every candidate is validated with `arena.isOnArena(x, z)` /
  `arenaSim.isOnArena(x, z)`.
- Last-resort fallback: `(0, 0)` — sits on the central islet which
  never collapses, so ground is guaranteed.
- Client: `src/game.ts` → `pickRespawnPos`.
- Server: `server/src/BrawlRoom.ts` → new private `pickRespawnPos`
  helper, replaces the inline angle × 0.4·r block.

This benefits both offline (bots and player) and online matches.

### Lab fix: recorder didn't close on last_standing

**Bug**: when a match ended because the user survived (last_standing),
the recording's `outcome.survivor` + `outcome.reason` were set but
`finaliseRecording` was never called. Downloading the JSON/MD showed
`Ended: (still recording)` and `Duration: (running)` even for a
clearly-finished match.

**Fix**: in `DevApi.tickRecording`, when the alive-count drops to 1 we
now also push a `match_ended` event and call `finaliseRecording(
'last_standing')` so the session carries correct `endedAt` +
`durationSec` + locked event history.

### Sidebar reorg: thematic groups + collapsible sections

The v2.1 sidebar had 10 flat panels with only a thin heading separating
them — the density was high and there was no visual hint about what
each panel was for. Reorganised into 4 thematic groups with coloured
separator bars:

- **MATCH SETUP** (blue) — Matchup, Arena
- **LIVE CONTROL** (red) — Bots, Gameplay, Playback
- **OBSERVE** (green) — Recording, Performance, Input, Player info
- **TUNING** (yellow) — Animation

Every section is now collapsible (click header). Defaults chosen for
the "start a match and observe" flow: Bots / Gameplay / Recording /
Performance expanded, the rest collapsed. State is per-pageload only
(no localStorage — deliberate simplicity).

New helper `group(parent, label, kind)` in `src/tools/sidebar.ts`.
`section(parent, title, { collapsed })` now returns the content element
so callers keep appending the same way they did before.

### Files changed
- `src/game.ts` — `pickRespawnPos` rewritten with retry + fallback.
- `server/src/BrawlRoom.ts` — inline respawn block replaced with new
  `pickRespawnPos` helper; same retry + fallback strategy.
- `src/tools/dev-api.ts` — `tickRecording` now pushes `match_ended` and
  finalises recording on last-standing detection.
- `src/tools/sidebar.ts` — full rewrite of the panel layout + CSS for
  thematic groups and collapsible sections.
- `DEV_TOOLS.md` — groups + defaults + canonical DOM-caching pattern
  documented.
- `BUILD_LOG.md` — this entry.

### Verification
- `npx tsc --noEmit` clean (client + server).
- Build clean.
- Respawn fix visually testable via lab Pattern B (axis-split): force a
  seed that triggers pattern B, push bots to chase = eliminar uno, se
  respawnea → debe caer en una zona válida (never in void).

---

## 2026-04-19 — 4P online + bot-fill + waiting UX + music API stub

### Scope change

Originally this phase (Phase 2 in `NEXT_STEPS.md`) was planned for 25-27
apr, with sound-integration as Phase 1 first. The user chose to pull
Phase 2 forward (online carries more technical risk) and defer music
hooks to the next block; MP3 assets are now in the bundle and the
playback API is live but nothing calls it automatically yet.

### Server changes

- `maxClients = 4` (was 2). `MAX_PLAYERS = 4`, `WAITING_TIMEOUT = 60`.
- New `PlayerSchema.isBot: boolean`. Bots are fully normal
  PlayerSchemas; only the input source differs.
- New `GameState.waitingTimeLeft: number` — counts down every tick in
  `waiting` so the client can render the countdown.
- `onJoin`: rejects joins outside `waiting`; resets timer on first
  human; arms instant-start when `size === MAX_PLAYERS`.
- `onLeave`:
  - In `waiting` / `ended` → simple delete.
  - In `countdown` / `playing` with ≥ 2 survivors → **bot-takeover**:
    flip `isBot = true`, reset held input, match continues. Only below
    2 survivors does the match end with `opponent_left`.
- New `tickWaiting(dt)`: counts down `waitingTimeLeft`. When it reaches
  0 with at least one human in the room, fills the empty slots with
  bots and transitions to countdown. Empty room holds the timer.
- New `spawnBot()`: generates `bot_N` sessionIds, picks a free spawn
  position + a critter name not already in use.
- New `transitionToCountdown()` centralises the waiting → countdown
  transition and also locks the room so late `joinOrCreate` calls
  don't land in an already-starting match.
- New `buildPlayerSchema()` helper — same builder for humans and bots.
- New `server/src/sim/bot.ts` → `computeBotInput(bot, allPlayers)`:
  chase nearest, headbutt < 2u, ability1 at mid-range, ability2 when
  surrounded. Inputs injected into the normal pipeline at the top of
  `simulatePlaying`, so everything downstream treats bots identically
  to humans.

### Client changes

- `src/critter.ts` → new `isBot: boolean = false` field.
- `src/hud.ts` → `showWaitingScreen` / `hideWaitingScreen` /
  `updateWaitingScreen(data)`. Lives-row renders a 🤖 badge for bots.
  All functions are null-safe so `/tools.html` (no waiting flow)
  doesn't break.
- `src/game.ts`:
  - `spawnOnlineCritter` propagates `playerState.isBot`.
  - Per-frame sync loop reads `p.isBot` and rebuilds the lives HUD if
    it flips mid-match (bot-takeover).
  - Phase transition in `updateOnline`:
    - `waiting` → `hideOverlay()` + `showWaitingScreen()` + per-frame
      `updateWaitingScreen(data)`.
    - any other phase → `hideWaitingScreen()`.
    - `ended` → subtitle distinguishes bot vs human winner.
  - New `buildWaitingScreenData(state)` — builds slot array padded to
    `ONLINE_MAX_PLAYERS`.
  - New const `ONLINE_MAX_PLAYERS = 4`.
- `index.html` → new `#waiting-screen` overlay + CSS for slots,
  countdown urgency pulse (< 10s), HUD bot badge.

### Music (API only, no auto-hooks)

- MP3s copied to `public/audio/intro.mp3`, `ingame.mp3`, `special.mp3`
  (~3 MB total).
- `src/audio.ts`:
  - New `MusicTrack = 'intro' | 'ingame' | 'special'` type.
  - Independent `musicGain` bus at 0.22 level, separate from `masterGain`
    (SFX) at 0.35 level. Each bus has its own mute state.
  - `playMusic(track)`: lazy fetch + decode, loop, crossfade 1.2s if
    another track is active. No-op if same track.
  - `stopMusic()`: fade out 1.2s.
  - `preloadMusic(track)`: warm cache without playing.
  - `isMusicPlaying(track?)`.
  - `setMusicMuted` now actually mutes (was a TODO before).
- No hooks yet from `game.ts` — integration is 4 calls in phase
  transitions (documented in `ONLINE.md`). Console playable today:
  `(await import('/src/audio.ts')).playMusic('intro')`.

### Docs

- New `ONLINE.md` — living doc of the online flow, edge cases, params,
  bot AI, music plan. Goes in the root next to `DEV_TOOLS.md`.
- `NEXT_STEPS.md` — Phase 1 reorganised (música API lista, hooks
  pendientes), Phase 2 marked done.
- `BUILD_LOG.md` — this entry.

### Files created
- `server/src/sim/bot.ts`
- `ONLINE.md`
- `public/audio/intro.mp3`, `ingame.mp3`, `special.mp3`

### Files changed
- `server/src/state/PlayerSchema.ts` (+isBot)
- `server/src/state/GameState.ts` (+waitingTimeLeft)
- `server/src/BrawlRoom.ts` (major: maxClients, onJoin/onLeave,
  tickWaiting, spawnBot, transitionToCountdown, bot input injection)
- `src/critter.ts` (+isBot field)
- `src/hud.ts` (waiting screen API + lives badge)
- `src/game.ts` (waiting screen wiring, bot flag sync, end-screen)
- `src/audio.ts` (music API + musicGain bus)
- `index.html` (waiting-screen DOM + CSS)

### Verification
- Typecheck: client + server clean.
- Build: client 3.07 kB main (unchanged) · input-touch 813.6 kB
  (+2.1 kB for waiting + music API) · tools 37.57 kB (unchanged).
- Server `npx tsc` clean.
- **Manual online testing (2-4 clients over network) pending** — see
  `ONLINE.md` validation checklist.

### Known limitations (documented, not fixed)
- No `allowReconnection` (standby).
- Single global room pool, no region-based matchmaking.
- No persistence / ranking.
- Server bot AI simpler than offline bot (deliberate — bots are fill,
  not main experience).
- Music integration hooks deferred to the next block — 4 calls in
  `game.ts` phase transitions. API is ready and testable from console.

---

## 2026-04-19 — Music hooks + "(up to 4P)" label fix

Tiny follow-up while the user tests online manually.

### Music hooks wired in `src/game.ts`

Music now auto-switches with every phase transition (previously the API
was ready but nothing called it). Tracks mapped:

- `enterTitle()` → `playMusic('intro')` + `preloadMusic('ingame')`
- `enterCountdown()` offline → `playMusic('ingame')`
- `enterEnded(win)` → `playMusic('special')`; lose/draw → `playMusic('intro')`
- Online `updateOnline` phase change:
  - `waiting` → `playMusic('intro')` + `preloadMusic('ingame')`
  - `countdown` → `playMusic('ingame')`
  - `ended` win/lose/draw → `special` / `intro` / `intro`
- `debugStartOfflineMatch` (lab) → `playMusic('ingame')`
- `debugEndMatchImmediately` (lab) → `playMusic('intro')`

The `/tools.html` lab inherits these automatically because it drives
matches through the same `debug*` methods. No lab-specific wiring
needed; the 🎶 HUD button covers the "silence while tuning balance"
case.

### Label fix

`index.html` + `tools.html`: title mode button text changed from
`🌐 Online Multiplayer (2P)` to `🌐 Online Multiplayer (up to 4P)` so
it reflects the new bot-fill flow.

### Files changed
- `src/game.ts` — 7 call sites added across phase transitions.
- `index.html` — button label.
- `tools.html` — button label.
- `ONLINE.md` — music section updated with the actual hook table.
- `NEXT_STEPS.md` — music hooks marked done.

### Verification
- Typecheck + build clean.
- Bundle delta trivial (input-touch +1.17 kB for the 7 call sites).
- Autoplay policy: music only starts after first user gesture — the
  title loop is silent on first load until the user clicks anything.
  Documented in `ONLINE.md`.

---

## 2026-04-19 — Online UX polish round (post-manual-test)

User-reported issues from the 4P online smoke test. Four concrete fixes.

### 1. Waiting-slot visuals: thumbnail + name instead of plain dot

The waiting screen was showing a coloured circle per slot with the
critter's signature colour, plus the name as small text. The user
couldn't easily tell which critter each participant had picked at a
glance. Now each slot renders the character-select 3D thumbnail (via
the existing `getCritterThumbnail` loader, cached across pages) and
the critter name in a larger font. The coloured tile stays as an
instant fallback while the thumbnail async-loads. Occupied slots gently
breathe (2.6s scale cycle) to feel alive.

### 2. `T` during waiting left the overlay stuck on the title screen

`enterTitle` never hid `#waiting-screen`, so pressing T to leave the
room left the waiting overlay on top of the title — no clicks went
through. Fix: `hideWaitingScreen()` (and `hideSpectatorPrompt()`, see
below) are now called defensively at the top of `enterTitle` on every
path.

### 3. Spectator prompt when the local player is eliminated online

Previously, if you lost all lives mid-match in an online game, there
was no way to leave other than pressing T with no visual hint. Added
a discreet fixed prompt at the bottom center (`#spectator-prompt`)
that reads:

> 💀 You're out · Press T to leave

Pointer-events disabled (purely a hint). Shown only when
`serverPhase === 'playing' && player !== null && !player.alive`;
hidden automatically in any other state, and on `enterTitle` as
defensive cleanup. Pulse animation 2.2s so it grabs attention without
being loud.

### 4. Settings buttons (SFX + music) reachable on every screen

The 🔊 and 🎶 toggles were tucked inside `#hud`, which sat behind the
full-overlays (title / character-select / waiting / end). Result:
users couldn't mute before entering a match, which matters now that
music starts as soon as the intro track plays. Fix:

- `#hud { z-index: 20 }` — lifts the whole HUD above full-overlays.
- `body:not(.match-active) #hud-top-left, #hud-lives { display: none }`
  — hides the alive-count, timer, and lives rows on non-match screens
  so only the settings cluster draws over the overlay (rest of the
  HUD stays invisible until a match is live).
- Same CSS applied to `tools.html` for consistency.

### Files changed
- `src/game.ts` — hideWaiting/Spectator in enterTitle, spectator show
  logic in updateOnline, import of spectator helpers.
- `src/hud.ts` — waiting-slot avatar + async thumbnail, spectator
  show/hide helpers, roster import.
- `index.html` — spectator-prompt DOM + CSS, waiting-slot CSS rework
  (avatar 74×74, breathe animation, bigger slot), z-index + match-active
  display rules on HUD.
- `tools.html` — same z-index/display fix.

### Verification
- Typecheck + build clean.
- Main game bundle unchanged at 3.07 kB. input-touch chunk +0.41 kB.
  index.html +3.2 kB (CSS).
- **Manual validation pending from the user** (browser testing).
- No server changes this round — only client UX.
