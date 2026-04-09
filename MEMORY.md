# Memory — Bichitos Rumble

## Key Decisions
- Phase 1 is offline-only with bots. No multiplayer until core loop is validated.
- Player always controls Rojo (index 0) in phase 1.
- Arena has 6 rings, collapses every 15s from outside in.
- 4 critter presets with different speed/mass/headbutt tradeoffs.
- Each critter will have 2 special abilities (not 1). Keys: J and K.
- Controls: WASD move, Space headbutt, J ability 1, K ability 2, R restart.
- Camera: pseudo-isometric (FOV 32, pos 0/34/14, lookAt 0/0/-1).
- Lives system: each critter has 2-3 lives (default 3, may vary per critter later). On fall → respawn with 1-2s of immunity. Elimination only when all lives are spent.

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

## Development Priorities (current)
- Jam widget included in index.html (required for submission)
- Do NOT invest more time in bots — they are minimal temporary opposition
- Next focus: reduce "orthopedic" feel — improve game feel structurally
- Priorities: anticipation, hit stop, squash/stretch, recoil, impact readability
- Leave clean hooks for animation/VFX but don't add final art yet
- Game must stay fast-loading, no heavy screens
