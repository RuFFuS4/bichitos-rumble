# Memory — Bichitos Rumble

## Key Decisions
- Phase 1 is offline-only with bots. No multiplayer until core loop is validated.
- Player always controls Rojo (index 0) in phase 1.
- Arena has 6 rings, collapses every 15s from outside in.
- 4 critter presets with different speed/mass/headbutt tradeoffs.
- Each critter will have 2 special abilities (not 1). Keys: J and K.
- Controls: WASD move, Space headbutt, J ability 1, K ability 2, R restart.
- Camera: pseudo-isometric (FOV 32, pos 0/34/14, lookAt 0/0/-1).

## Known Physics Values
- Arena radius: 12 units, 6 rings
- Friction damping: 0.92 per frame
- Headbutt duration: 0.2s, cooldown: 0.5s
- Headbutt knockback multiplier: 2.5x
- Base push force: 6, headbutt forces: 11-16 per critter
- Match duration: 90s, collapse interval: 15s
