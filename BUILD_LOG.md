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

### Next sprint (recommended)
1. **Playtest the live deploy** and report back which predictions were
   right / wrong — this is the real validation
2. **Mobile input implementation** based on this sprint's abstraction
   (on-screen joystick + action buttons)
3. **First sound pass** — 5-6 SFX (headbutt, ground pound, fall, respawn,
   ability use) using Howler.js or native `HTMLAudioElement`
4. **Dynamic ability HUD** — show bot ability cooldowns too, so you can
   read which opponent is about to do what
