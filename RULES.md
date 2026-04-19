# Game Rules — Bichitos Rumble

## Objective
Be the last critter standing in the arena.

## Match Format
- **Up to 4 critters per match**.
  - Offline: 1 human + 3 bots.
  - Online: up to 4 humans; if the room doesn't fill in 60s, bots fill
    the remaining slots automatically.
- **120-second** time limit.
- **Irregular fragment arena**. Seed-deterministic, 29 fragments total
  (1 immune centre that never falls + 28 collapsible sectors in 3
  radial bands). Fragments fall in batches over the course of the
  match — the usable floor shrinks toward the centre.

## Controls

### Desktop — Keyboard
- **WASD / Arrow Keys**: Move.
- **Space**: Headbutt attack (short cooldown).
- **J**: Ability 1 (unique per critter).
- **K**: Ability 2 (unique per critter).
- **L**: Ultimate (if the critter has one).
- **R**: Restart (after match ends) / confirm.
- **T / Escape**: Return to title (end screen) / leave online room.
- **🔊 / 🎶 buttons** (top-right): Toggle SFX / music. Persist via
  `localStorage`.

### Desktop — Gamepad (standard Xbox/PS layout)
- **Left stick**: Move.
- **A**: Headbutt (held) + menu confirm.
- **B**: Menu back / leave room.
- **X**: Ability 1.
- **Y**: Ability 2.
- **RB**: Ultimate.
- **Start**: Restart.
- **D-Pad**: Menu navigation.

### Mobile (touch)
- **Virtual joystick** (bottom-left): Move.
- **⚡ button** (bottom-right): Headbutt.
- **J / K buttons** (bottom-right): Abilities.
- **L button**: Ultimate (critters without an ultimate simply ignore).
- **Tap** title screen to start, **tap** end screen to play again.
- **Tap** a critter slot to select, tap again to confirm.
- **Drag** the 3D preview in character select to rotate it.
- Landscape orientation required (a prompt appears in portrait).

## Mechanics

### Headbutt
- Anticipation → lunge → impact → recovery.
- Knocks nearby opponents back with force scaled by the critter's
  `headbuttForce` stat.
- Short cooldown after the lunge; anticipation is interruptible by
  state transitions (immunity, fall).

### Knockback
- Every collision pushes critters apart.
- Headbutts amplify the push multiple times over a casual bump.
- Heavier critters (higher mass) are pushed less and push harder.

### Lives & respawn
- Each critter starts with **3 lives**.
- Falling off the arena costs 1 life.
- On respawn: spawn on a guaranteed-safe point (retry up to 12 times
  picking positions that pass `isOnArena`, fall back to the immune
  centre). **1.5s of immunity** with a visible blink + emissive tint.
- 0 lives left → permanent elimination from the match.

### Arena collapse
- Fragments are scheduled to fall in batches. First batch ~20s into
  the match, then every 8-10s.
- **Warning**: 3s before a batch actually collapses, the affected
  fragments visibly **shake** (distributed tremor with per-fragment
  phase offsets, amplitude ≈ 8cm) and glow warm orange. A seismic
  rumble SFX plays for the full 3s window.
- Shake is purely visual — collisions and ground detection use the
  static layout so the floor stays trustworthy during the warning.
- After the warning, the fragments disappear.

### Immune centre
- The central islet (radius 2.5) never collapses. Guaranteed safe
  ground for the last stretch of the match.

## Win conditions
- Last critter alive wins the match.
- If the 120s timer runs out, the player with the most surviving
  lives wins. In a tie, the match ends as a draw.

## Roster stats

The 9 playable critters share three base ability types (Charge Rush,
Ground Pound, Frenzy) with per-critter tuning. The differences the
player feels come from combinations of speed, mass, headbutt force,
and each ability's impulse / radius / cooldown / wind-up.

| Name | Animal | Role | Speed | Mass | HB force |
|------|--------|------|-------|------|----------|
| Sergei | Gorilla | Balanced | 13 | 1.10 | 15 |
| Trunk | Elephant | Bruiser | 9.1 | 1.40 | 17 |
| Kurama | Fox | Trickster | 15.6 | 0.80 | 12 |
| Shelly | Turtle | Tank | 8.45 | 1.50 | 16 |
| Kermit | Frog | Controller | 11.7 | 1.00 | 13 |
| Sihans | Mole | Trapper | 10.4 | 1.15 | 14 |
| Kowalski | Penguin | Mage | 13 | 0.90 | 11 |
| Cheeto | Tiger | Assassin | 16.9 | 0.70 | 11 |
| Sebastian | Crab | Glass Cannon | 13.65 | 0.75 | 18 |

Per-critter ability tuning (names, cooldowns, radii, impulses) is
defined in `src/abilities.ts`. Final ability designs and signature
moves are documented in [`CHARACTER_DESIGN.md`](CHARACTER_DESIGN.md);
not all signature moves are implemented yet — the gap between the
temporary kits and the final designs is tracked there.
