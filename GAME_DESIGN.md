# Game Design — Bichitos Rumble

## Core Fantasy
You are a big-headed critter in a chaotic arena. Headbutt your rivals off the edge before the floor disappears beneath you.

## Art Direction
Cartoon squashy arcade. Game feel over realism. Every action should feel exaggerated and impactful.

## Pillars
1. **Satisfying knockback** — the headbutt should feel punchy and consequential
2. **Escalating pressure** — the collapsing arena forces action and creates tension
3. **Instant fun** — zero friction from page load to gameplay
4. **Readable chaos** — 4 colorful critters, clear arena, easy to follow
5. **Critter identity** — each critter feels distinct through abilities, timing, and visual personality

## Match Flow
1. 3-second countdown
2. 120 seconds of combat
3. Arena collapses every 20 seconds (6 collapse events = arena fully gone at 120s)
4. Last survivor wins (all lives spent = eliminated), or time-up survival

## Lives & Respawn
- Each critter has **3 lives** by default (may vary per critter in the future: 2-3)
- Falling off the arena costs 1 life
- If lives remain: respawn at center with **1-2s of immunity** (invulnerable, visually distinct)
- If no lives remain: permanently eliminated
- Immunity during respawn prevents spawn-killing

## Movement Model
- Acceleration-based with frame-independent friction (exponential decay with half-life)
- Dual friction: normal when holding input, aggressive braking when idle (prevents drift)
- Velocity dead zone snaps to 0 below threshold
- Each critter has a speed stat controlling acceleration
- Diagonal movement is normalized

## Controls
- **WASD**: Movement
- **Space**: Headbutt
- **J**: Ability 1
- **K**: Ability 2
- **R**: Restart (after match ends)

## Combat
- **Headbutt**: 0.2s lunge forward, applies directional knockback force, 0.5s cooldown
- **Abilities**: Each critter has 2 unique special abilities (J and K), independent cooldowns
- **Mass**: affects knockback received (heavier = harder to move). Abilities can modify effective mass.
- **Collision**: all critters push each other on overlap, headbutts amplify force 2.5x

## Abilities (differentiated per critter)
Each critter has 2 abilities. Same base types (dash + AoE) but different tuning. See `src/abilities.ts` for exact values.

### Rojo — Balanced (baseline)
| | Charge Rush (J) | Ground Pound (K) |
|---|---|---|
| Cooldown | 4.0s | 6.0s |
| Duration | 0.30s | Instant after 0.35s wind-up |
| Effect | Speed ×2.5, Mass ×2.0, impulse 16 | Knockback 28 in radius 3.5 |

### Azul — Skirmisher (fast, light, short cooldowns)
- **Quick Dash** (J): impulse 22, cooldown 3.0s, mass ×1.4, speed ×2.7
- **Sharp Stomp** (K): radius 2.8, force 20, cooldown 4.5s

### Verde — Crusher (slow, heavy, devastating)
- **Heavy Charge** (J): impulse 13, cooldown 5.0s, mass ×3.0, speed ×2.0
- **Earthquake** (K): radius 4.2, force 34, cooldown 8.5s, wind-up 0.5s

### Morado — Glass Cannon (fragile, high-burst)
- **Blitz** (J): impulse 22, cooldown 3.0s, mass ×1.2, speed ×2.8
- **Shockwave** (K): radius 3.2, force 34, cooldown 6.5s

## Arena
- Circular, 12-unit radius, visible side walls
- 6 concentric rings collapse outside → inside, one every 20 seconds
- **Warning blink**: 1.5s before a ring disappears it blinks red with an accelerating rhythm. The ring stays standable during the warning so the player has time to step off.
- Red rim glow marks the current edge

### Future: Organic Arena Collapse (not yet implemented)
Current system uses perfect circular rings. Future evolution:
- Procedural/semi-procedural sector generation at match start
- Irregular fragment shapes instead of perfect rings
- Collapse order biased outside→inside but with controlled randomness
- Each match has a unique arena breakdown pattern
- Must stay readable and fair — organic but not chaotic
- Compatible with current architecture (replace ring meshes with generated sector meshes)
- Implement only after core game feel and combat are mature

## Critter Design
- Spherical body (small) + spherical head (larger) = big-headed look
- Two white eyes with dark pupils
- Distinct color per critter
- Bobbing idle animation
- Each critter must feel distinct: same ability type can differ in timing, force, and visual execution
- Abilities share reusable base logic but allow per-critter customization

## Game Feel (implemented)
- **Hit stop**: brief freeze on headbutt (0.07s) and ground pound (0.09s)
- **Camera shake**: on headbutt connect and on every ground pound slam
- **Hit flash**: target critter flashes white briefly on every impact
- **Squash/stretch**: bounce-overshoot scale deformation on impact, dash, landing
- **Anticipation**: headbutt wind-up (head retract + body squash), ground pound (extreme squash + head drop)
- **Recovery**: headbutt head bounce-back + body stretch, smooth return to neutral
- **Knockback reaction**: critters tilt backward when hit (body + head rotation)
- **Visual state contrast**: distinct glow colors per state (idle/anticipation/attack/ability/cooldown)
- **Immunity blink**: square-wave opacity blink + white emissive tint during respawn immunity
- **Ring warning**: accelerating red blink on arena rings 1.5s before they disappear
- **Synthesized SFX**: Web Audio API, 6 sounds, zero asset weight
- All systems in `gamefeel.ts` / `audio.ts`, visual/audio-only, no gameplay logic coupling

## Current Scope (v0.3-core-gameplay-loop)
- 1 arena with visible side walls, void, and warning blinks
- 4 playable critters with differentiated stats and abilities
- Character select (3×3 grid with 3D rotatable preview)
- Title screen and end screen with per-result messaging
- Lives system with respawn + 1.5s immunity (visible blink)
- 3 bot opponents (chase + headbutt + ability heuristics) — intentionally minimal
- 2 abilities per critter with cooldown HUD
- Synthesized SFX (Web Audio API, 6 sounds)
- Mobile support: landscape lock, virtual joystick, action buttons, tap menus
- Sound toggle button with localStorage persistence

## Future Phases
- **Ultimate Ability system** (designed in ULTI_DESIGN.md, not implemented)
- Winner posing screen (reuses `preview.ts` on end overlay)
- Per-critter pedestals in the preview system
- Organic/procedural arena collapse (irregular sectors instead of rings)
- More arenas
- Online multiplayer
- Ranking / belts
