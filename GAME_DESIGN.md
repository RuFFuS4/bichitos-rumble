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

## Rojo's Abilities
| | Charge Rush (J) | Ground Pound (K) |
|---|---|---|
| Type | Directional dash | Radial AoE |
| Cooldown | 4.0s | 6.0s |
| Duration | 0.35s | Instant (after 0.25s wind-up) |
| Effect | Speed x2.2, Mass x1.5, impulse burst | Knockback 18 in radius 3.5 |
| Visual | Orange glow | Body squish + shockwave ring |
| Synergy | Combo with headbutt for massive knockback | Push enemies toward arena edge |

## Arena
- Circular, 12-unit radius
- 6 concentric rings
- Outer ring collapses first, working inward
- Collapsed rings flash red then disappear
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
- **Squash/stretch**: bounce-overshoot scale deformation on impact, dash, landing
- **Anticipation**: headbutt wind-up (head retract + body squash), ground pound (extreme squash + head drop)
- **Recovery**: headbutt head bounce-back + body stretch, smooth return to neutral
- **Knockback reaction**: critters tilt backward when hit (body + head rotation)
- **Visual state contrast**: distinct glow colors per state (idle/anticipation/attack/ability/cooldown)
- All systems in `gamefeel.ts`, visual-only, no gameplay logic coupling

## Phase 1 Scope
- 1 arena
- 4 preset critters (all share Rojo's abilities for now)
- Player controls Rojo
- 3 bot opponents (chase + headbutt + ability heuristics)
- 2 abilities per critter with cooldown HUD
- No character select (yet)

## Future Phases
- Organic/procedural arena collapse (irregular sectors instead of rings)
- Unique abilities per critter (Azul, Verde, Morado)
- Character select screen
- More arenas
- Online multiplayer
- Ranking / belts
