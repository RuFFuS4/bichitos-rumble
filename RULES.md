# Game Rules — Bichitos Rumble

## Objective
Be the last critter standing in the arena.

## Match Format
- 4 critters per match (1 player + 3 bots)
- 120-second time limit
- Circular arena that collapses one ring every 20 seconds (with a 1.5s warning blink before each ring actually disappears)

## Controls

### Desktop
- **WASD / Arrow Keys**: Move your critter
- **Space**: Headbutt attack (short cooldown)
- **J**: Ability 1 (unique per critter)
- **K**: Ability 2 (unique per critter)
- **R**: Restart (after match ends)
- **T / Escape**: Return to title (on end screen) / back (in menus)
- **Top-right sound button**: Toggle all sound (persists across sessions)

### Mobile (touch)
- **Virtual joystick** (bottom-left): Move your critter
- **⚡ button** (bottom-right): Headbutt
- **J / K buttons** (bottom-right): Abilities
- **Tap** title screen to start, tap end screen to play again
- **Tap** a critter slot to select it, tap again to confirm
- **Drag** the 3D preview in character select to rotate it
- Landscape orientation required (a prompt appears in portrait)

## Mechanics
- **Headbutt**: Anticipation → lunge → impact → recovery. Knocks nearby opponents back with force. 0.45s cooldown after lunge.
- **Knockback**: All collisions push critters. Headbutts push ~16× harder than casual bumps.
- **Lives**: Each critter starts with **3 lives**. Falling off costs 1 life. Respawn at center with **1.5s of immunity** (visual blink) before permanent elimination when all lives are spent.
- **Arena Collapse**: Every 20s the outermost ring blinks red with an accelerating rhythm for 1.5s, then disappears. The ring stays standable during the warning — you have time to step off.
- **Elimination**: Fall off with 0 lives left and you're out of the match.
- **Mass**: Heavier critters are harder to push but move slower. Some abilities temporarily multiply effective mass.

## Win Conditions
- Last critter alive wins the match
- If time runs out, the player wins if they survived

## Critters — stats and identity
| Name | Color | Role | Speed | Mass | Headbutt |
|------|-------|------|-------|------|----------|
| Rojo | Red | Balanced | 10 | 1.00 | 14 |
| Azul | Blue | Skirmisher | 12 | 0.85 | 12 |
| Verde | Green | Crusher | 7 | 1.40 | 17 |
| Morado | Purple | Glass Cannon | 10 | 0.75 | 13 |

## Critter abilities
Each critter has 2 unique abilities. Same base types (dash + AoE) but distinct numbers and feel.

| Critter | Ability 1 (J) | Ability 2 (K) |
|---------|---------------|---------------|
| **Rojo** | Charge Rush — balanced dash | Ground Pound — balanced AoE |
| **Azul** | Quick Dash — fast, light, short cooldown | Sharp Stomp — small radius, low cooldown |
| **Verde** | Heavy Charge — slow, 3× mass, big commitment | Earthquake — huge radius, massive force, long wind-up |
| **Morado** | Blitz — strongest impulse, fastest cooldown | Shockwave — mid radius, strong force |
