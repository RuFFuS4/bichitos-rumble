# Memory — Bichitos Rumble

## Key Decisions
- Phase 1 is offline-only with bots. No multiplayer until core loop is validated.
- Player always controls Rojo (index 0) in phase 1.
- Arena has 6 rings, collapses every 20s from outside in.
- 4 critter presets with different speed/mass/headbutt tradeoffs.
- Each critter has 2 special abilities. Keys: J and K. Currently all critters share Rojo's abilities (placeholder).
- Controls: WASD move, Space headbutt, J ability 1, K ability 2, R restart.
- Camera: pseudo-isometric with depth (FOV 40, pos 0/23/25, lookAt 0/-3/0).
- Lives system: 3 lives per critter (default). On fall → respawn at center with 1.5s immunity. Permanent elimination when all lives spent.
- Public deploy: https://www.bichitosrumble.com (Vercel, custom domain).

## Known Physics Values
- Arena radius: 12 units, 6 rings
- Friction: frame-independent, halfLife 0.08s (input) / 0.03s (idle), deadZone 0.15
- Max speed: 20
- Acceleration scale: 1.6x
- Rojo base speed: 10
- Headbutt: anticipation 0.12s, lunge 0.15s, cooldown 0.45s, velocityBoost 4.0, recoil 0.35x
- Collision: normalPush 3.0, headbuttMult 3.5 (Rojo: 14×3.5=49, contrast 16x vs normal)
- Match duration: 120s, collapse interval: 20s (6 rings = arena gone at 120s)

## Ability System Architecture
- Config-driven: `AbilityDef` objects in `CRITTER_ABILITIES` record (`src/abilities.ts`)
- Per-type helpers via `EFFECT_MAP` dispatch table
- `canActivateAbility()` separated from `activateAbility()`
- `effectiveSpeed` / `effectiveMass` getters on Critter
- HUD renders from array (not hardcoded to 2 slots)
- ALL tuning values centralized in FEEL config (`src/gamefeel.ts`)

## Ability Tuning (provisional — needs playtesting)
- Charge Rush: cooldown 4s, duration 0.30s, speedMult 2.5, massMult 2.0, impulse 16, steerFactor 0.15, windUp 0.06s
- Ground Pound: cooldown 6s, windUp 0.35s, slowDuringWindUp 0.15, radius 3.5, force 28, windUpSquash 0.50
- Hit stop: headbutt 0.07s, groundPound 0.09s, generic 0.04s
- Bot ability chance: ~2% per frame (Ability 1), ~1.5% per frame (Ability 2), bot accel factor 0.55

## Future: Organic Arena Collapse
- Replace circular rings with procedural irregular sectors
- Collapse biased outside→inside but with randomness per match
- Each match feels different, stays readable
- Do NOT implement until game feel and combat are mature

## Deployment
- Public URL: https://www.bichitosrumble.com (custom domain aliased)
- Vercel project: ruffus4s-projects/bichitos-rumble
- Manual deploy: `npx vercel deploy --prod` from project root
- vercel.json with SPA rewrite verified working in production
- GitHub ↔ Vercel push-triggered deploys NOT yet wired (manual dashboard step)
- `.vercel/` is in `.gitignore` (auto by `vercel link`)

## Critter identity (implemented)
- Rojo: Balanced. Standard stats and abilities (FEEL defaults).
- Azul: Skirmisher. Faster, lighter. Quick Dash + Sharp Stomp.
- Verde: Crusher. Slow, heavy, devastating. Heavy Charge + Earthquake.
- Morado: Glass Cannon. Fastest, lightest. Blitz + Shockwave.
- Abilities use same base types (charge_rush / ground_pound) but with
  per-critter overrides via makeChargeRush/makeGroundPound factories.

## Game flow (implemented)
- title → character_select → countdown → playing → ended
- Title: Press SPACE/Enter
- Select: Arrow keys or A/D to navigate, SPACE/Enter to confirm, T/Esc back
- End: R to restart match, T to return to title
- Player slot is dynamic: `playerIndex` from chosen critter, bots are all others

## Input Architecture
- Device-agnostic: `src/input.ts` is the only module that touches physical keys
- Game logic reads `getMoveVector()`, `isHeld(action)`, `consumeMenuAction(action)`
- Menu actions are edge-detected (no repeat), cleared on phase transitions
- Keyboard backend lives inside `input.ts` (always active)
- Touch backend NOT implemented yet — just add a new file that writes into
  `_setMove`, `_setHeld`, `_pushMenuAction` and the rest of the game works
- Capability detection via `hasTouchSupport()` + `isNarrowViewport()` +
  `isLikelyMobile()` (no user-agent sniffing)

## Development Priorities (next sprint)
- Playtest live deploy and validate which predicted issues were real
- Implement touch input backend (on-screen joystick + buttons)
- First small sound pass (5-6 SFX)
- Dynamic ability HUD showing bot cooldowns (opponent reads)
- Do NOT invest more time in bots — minimal temporary opposition
- Game must stay fast-loading, no heavy screens
- Leave clean hooks for animation/VFX but don't add final art yet
- Jam widget included in index.html (required for submission)
