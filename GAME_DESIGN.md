# Game Design — Bichitos Rumble

## Core Fantasy
You are a big-headed critter in a chaotic arena. Headbutt your rivals off the edge before the floor disappears beneath you.

## Pillars
1. **Satisfying knockback** — the headbutt should feel punchy and consequential
2. **Escalating pressure** — the collapsing arena forces action and creates tension
3. **Instant fun** — zero friction from page load to gameplay
4. **Readable chaos** — 4 colorful critters, clear arena, easy to follow

## Match Flow
1. 3-second countdown
2. 90 seconds of combat
3. Arena collapses every 15 seconds (6 collapse events total)
4. Last survivor wins, or time-up survival

## Movement Model
- Acceleration-based with friction (0.92 damping per frame)
- Each critter has a speed stat controlling acceleration
- Diagonal movement is normalized

## Controls
- **WASD**: Movement
- **Space**: Headbutt
- **J**: Ability 1
- **K**: Ability 2
- **R**: Restart (after match ends)

## Combat
- **Headbutt**: 0.2s lunge forward, applies directional knockback force
- **Cooldown**: 0.5s after each headbutt
- **Abilities**: Each critter has 2 unique special abilities (J and K)
- **Mass**: affects knockback received (heavier = harder to move)
- **Collision**: all critters push each other on overlap, headbutts amplify force 2.5x

## Arena
- Circular, 12-unit radius
- 6 concentric rings
- Outer ring collapses first, working inward
- Collapsed rings flash red then disappear
- Red rim glow marks the current edge

## Critter Design
- Spherical body (small) + spherical head (larger) = big-headed look
- Two white eyes with dark pupils
- Distinct color per critter
- Bobbing idle animation

## Phase 1 Scope
- 1 arena
- 4 preset critters
- Player controls Rojo
- 3 bot opponents (chase nearest + headbutt AI)
- No character select (yet)
- No special abilities (yet)

## Future Phases
- Character select screen
- 2 special abilities per critter (J and K keys)
- More arenas
- Online multiplayer
- Ranking / belts
