# Game Design — Bichitos Rumble

## Core Fantasy
You are a big-headed critter in a chaotic arena. Headbutt your rivals off the edge before the floor disappears beneath you.

## Art Direction
Cartoon squashy arcade. Game feel over realism. Every action should feel exaggerated and impactful.

## Pillars
1. **Satisfying knockback** — the headbutt should feel punchy and consequential
2. **Escalating pressure** — the collapsing arena forces action and creates tension
3. **Instant fun** — zero friction from page load to gameplay
4. **Readable chaos** — up to 4 colourful critters, clear arena, easy to follow
5. **Critter identity** — each critter feels distinct through stats, timing and visual personality (procedural animation derived from mass/speed + optional skeletal clips)

## Match Flow
1. 3-second countdown
2. 120 seconds of combat
3. Arena collapses in batches: first ~20s in, then every 8-10s (each
   batch gets a 3s shake+rumble warning before it actually falls)
4. Last survivor wins (all lives spent = eliminated); if time runs
   out, most lives survive wins (ties → draw)

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
Keyboard, gamepad and touch are all supported end-to-end through a single
device-agnostic input abstraction (`src/input.ts`). Game logic never
reads physical keys directly.

- **WASD / Arrow Keys**: Movement
- **Space**: Headbutt
- **J / K**: Abilities 1 and 2
- **L**: Ultimate (if available)
- **R**: Restart / confirm
- **T / Escape**: Back to title / leave online room
- **P**: Toggle portal expand/minimize (vs Vibe Jam webring)
- **B**: Open Hall of Belts (from character-select / end screen)
- **Gamepad**: A=headbutt+confirm · B=back · X=J · Y=K · RB=L · LB=portal toggle · Start=restart · D-Pad/stick=menu nav
- **Auto glyph swap**: every J / K / L / SPACE chip in the UI rewrites to its gamepad equivalent (X / Y / RB / A) the moment a controller is connected, and reverts on disconnect (`src/input-glyphs.ts`).
- **Touch**: virtual joystick (left) + 4 action buttons (right)

Full key → action table in [`RULES.md`](RULES.md).

## Combat
- **Headbutt**: 0.2 s lunge forward, applies directional knockback,
  0.5 s cooldown. Per-critter `headbuttBoost` scales the impact
  (Trunk ×2.30, Sebastian ×1.45, Cheeto ×1.30, Sergei/Kowalski ×1.20-1.40).
- **Abilities**: Each critter has 3 active abilities (J / K / L)
  with independent cooldowns. L is the "ultimate"-feel slot.
- **Mass**: affects knockback received (heavier = harder to move).
  Abilities modify effective mass at activation time — Shelly's
  Steel Shell anchors to ×9999, Sergei's Frenzy hardens to ×5.5, etc.
  Trunk's PWS-derived mass (1.2) is unchanged; the elephant's
  presence comes from the cabezazo + speed buff, not mass.
- **Collision**: critters push each other on overlap; headbutts
  amplify force ~2.5×; collision response uses mass-ratio so heavy
  vs. light reads correctly.
- **Status**: stun (Trunk Slam 1.5 s AoE / Trunk Grip 3.8 s frontal),
  vulnerable (×2 incoming knockback while stunned, ×4 in the Trunk
  pipeline), slow (Sihans Quicksand, Kermit Poison Cloud), frozen
  (Kowalski Snowball / Frozen Floor), confused (Kermit Toxic Touch,
  inverts movement), sinkhole pull (Sihans). All sync online.

## Abilities (differentiated per critter)
Every critter has 3 active abilities sharing a small set of base
types, each with per-critter tuning + flag-driven specialisation:

- **charge_rush** (J slot for everyone) — directional dash with
  speed/mass multipliers. Tuning: impulse, duration, multipliers.
- **ground_pound** — AoE radial knockback with wind-up. Specialised
  via flags: `slamStunDuration` (Trunk Slam — radius 7, force 50,
  brief AoE stun), `gripK` (Trunk Grip — frontal yank to 1.6 u
  in front + 3.8 s rooted vulnerable), `coneAngleDeg` (Sebastian
  Claw Wave frontal cone), `selfBuffOnly` (Shelly Steel Shell,
  Kurama Mirror Trick decoy).
- **blink** — instant teleport with optional zone-at-origin.
  Specialised via `blinkSeekNearest` (Cheeto Shadow Step seeks the
  closest target), `zoneAtOrigin` (Sihans Sand Trap leaves
  quicksand behind).
- **projectile** — server-authoritative travelling hit (Kowalski
  Snowball).
- **frenzy** (L slot for everyone) — base speed/mass buff plus an
  L-flag dispatcher:
  · `sawL` (Shelly Saw Shell — spinning contact knockback)
  · `conePulseL` (Cheeto — frontal arc with doubling pulses
    `min(2^(N-1), 8)` over 6 pulses, push along facing not radial)
  · `allInL + holdToFireL` (Sebastian — press-and-hold paints a
    forward trajectory line; release executes a forward dash; hit
    = guaranteed elimination via teleport-past-victim + explicit
    fall flow; miss = void via 1.5× range overshoot)
  · `toxicTouchL` (Kermit — contact confusion inverts target input)
  · `frozenFloorL` (Kowalski — slippery zone, friction × 5)
  · `sinkholeL` (Sihans — real arena fragment killer; centre-clamp
    protects the immune fragment)
  · `copycatL` (Kurama — mimics last-hit-target's L kit)
  All flags compose with the base frenzy buff and stay parity-aligned
  between cliente and server.

Per-character roles, full kit tables, and tuning values: see
[`CHARACTER_DESIGN.md`](CHARACTER_DESIGN.md). Live tuning is in
`src/abilities.ts` (offline) + `server/src/sim/abilities.ts`
(online), kept byte-aligned via `scripts/verify-ability-parity.mjs`.

## Status Effects
Floating emoji glyphs render above each critter while a status
applies. Top 3 by priority survive the diff. The `?` HUD button
opens a full legend.

| Glyph | Status | Source |
|-------|--------|--------|
| 💫 | stunned | Trunk Slam (1.5 s AoE) / Trunk Grip (3.8 s frontal) |
| 💥 | vulnerable | post-stun ×2 incoming knockback |
| ❄️ | frozen | Snowball hit / Frozen Floor zone |
| 🛡️ | steel-shell | Shelly Steel Shell active |
| 🔥 | frenzy | any L active post-windup |
| ☠️ | poisoned | Kermit Poison Cloud / Toxic Touch confusion |
| 🐌 | slowed | Sihans Quicksand zone |
| 👻 | decoy-ghost | Kurama Mirror Trick caster |

## Arena

Seed-deterministic irregular fragment floor. 29 fragments:
- 1 immune centre (radius 2.5) that never falls.
- 28 collapsible sectors organised in 3 radial bands with angular
  jitter.

Collapse happens in batches of 4-8 sectors, outer → inner, with
8-10s between batches. First batch kicks in around t = 20s, total
collapse lands near t = 53s of a 120s match — leaving ~67s of
endgame on the shrinking floor + immune centre.

Two base collapse patterns (A = outer→inner sweep; B = axis-split)
are selected from the seed so each match has a slightly different
breakdown.

### Pre-collapse warning (implemented)
- 3s before a batch falls, its fragments **shake** with a
  three-sine composition (per-fragment phase offsets so it reads as
  distributed tremor, not rigid oscillation). Amplitude capped at
  ~8cm so the player still stands comfortably.
- Warm orange emissive pulse ramps 0 → 0.65 intensity.
- Seismic rumble SFX (sub sine + filtered noise + crack chirps)
  plays for the full 3s window.
- Collisions and `isOnArena` use the static layout — the floor
  stays trustworthy during the shake.

Offline and online render identical warning behaviour; online
clients mirror the `arenaWarningBatch` field from the authoritative
server.

## Critter Design
- 9-character playable roster with 3D GLB models (Tripo-generated).
- Procedural fallback (spherical body + head + eyes) if a GLB fails
  to load — game never crashes on missing assets.
- **Procedural animation layer** (`src/critter-animation.ts`) derives
  per-critter personality from mass + speed: heavier critters breathe
  slower and deeper, lighter/faster ones bounce more and lean harder.
  Same layer handles charge stretch, ground-pound crouch, and the
  headbutt anticipation/lunge pose.
- **Skeletal animation layer** (`src/critter-skeletal.ts`, optional):
  a Critter whose GLB ships AnimationClips (from Mixamo, Tripo
  Animate, etc.) automatically gets an `AnimationMixer` and states
  resolved by fuzzy name match (`idle`, `run`, `victory`, `defeat`,
  `ability_1..3`, `headbutt_lunge`, `fall`, ...). The procedural
  layer steps aside on "heavy" clips so the pose reads cleanly.
  Critters without clips keep rendering 100% procedurally.
- Each critter must feel distinct: same ability type differs in
  timing, force and visual execution; tuning lives in
  `src/abilities.ts`.

## Game Feel (implemented)
- **Hit stop**: brief freeze on headbutt and ground pound impacts.
- **Camera shake**: on headbutt connect and on every ground pound slam.
- **Hit flash**: target critter flashes white briefly on every impact.
- **Squash/stretch**: bounce-overshoot scale deformation on impact,
  dash, landing.
- **Anticipation**: headbutt wind-up (head retract + body squash),
  ground pound (extreme squash + head drop).
- **Recovery**: headbutt head bounce-back + body stretch, smooth
  return to neutral.
- **Knockback reaction**: critters tilt backward when hit (body +
  head rotation).
- **Visual state contrast**: distinct glow colours per state
  (idle / anticipation / attack / ability / cooldown).
- **Immunity blink**: opacity blink + white emissive tint during
  respawn immunity.
- **Arena pre-collapse shake + rumble**: fragments wobble with
  per-fragment phase and warm-orange emissive pulse for 3s before
  falling; seismic SFX (sub + filtered noise + crack chirps) plays
  the full window.
- **SFX**: Web Audio API synthesis (headbutt, ground pound, ability
  fire, fall, respawn, victory, arena warning).
- **Music**: 3 MP3 tracks (intro / ingame / special) with
  independent mute bus and exponential two-phase crossfade (duck +
  preroll) between phase transitions.
- All systems in `gamefeel.ts` / `audio.ts`, visual/audio-only, no
  gameplay logic coupling.

## Rewards (Hall of Belts)
Two parallel achievement ladders surface in the same modal (B key from
character-select / end-screen):

- **Offline (16 belts)** — 9 per-critter Champions (Win 5 matches with
  X) + 7 cross-roster trophies (Speedrun, Iron Will, Untouchable,
  Survivor, Globetrotter, Arena Apex, Pain Tolerance). Progress
  persists in `localStorage`.
- **Online (5 belts)** — server-authoritative leaderboard ladder:
  Throne (most wins), Flash (fastest win), Ironclad (best
  lives-per-match ratio with 5+ matches), Slayer (most human kills),
  Hot Streak (longest win streak). Stored in the SQLite DB on
  Railway, updated on every online match end. The current holder of
  each belt is broadcast to all connected clients via a `beltChanged`
  event.

Each belt renders as a 3D thumbnail of its GLB model in the grid
(shared offscreen renderer 144 × 144, cached per id). Click → full-
screen modal with drag-to-rotate + idle auto-rotate + ESC/backdrop
close. Same 3D upgrade applied to badge unlock toasts and the
online belt-change toasts. The PNG fallback in
`/images/belts/<id>.png` stays as the immediate render until the
GLB resolves, so missing models never break the layout.

## Current Scope
- 1 seed-deterministic fragment arena with 2 collapse patterns.
- 9 playable critters with GLB models + procedural animation layer
  + optional skeletal clip layer.
- Character select (3×3 grid with 3D rotatable preview).
- Title / character-select / waiting / countdown / playing / ended
  flow. Waiting screen (online) shows lineup with human/bot badges
  + countdown.
- Lives system: 3 lives + 1.5s immunity on respawn (respawn picks a
  guaranteed-on-arena point or falls back to the immune centre).
- Bots: offline (`src/bot.ts`) and server-side
  (`server/src/sim/bot.ts`). Both chase + headbutt + occasional
  abilities.
- Online 4P (Colyseus) with 60s waiting timer, auto bot-fill,
  instant-start if 4 humans arrive early, bot-takeover on
  disconnect.
- 3 abilities per critter + HUD cooldown bars.
- Keyboard + gamepad + touch (capability-detected on mobile).
- Vibe Jam portal integration (entry by URL + exit to webring).
- Internal lab at `/tools.html` (see `DEV_TOOLS.md`): matchup tuner,
  arena inspector, bot behaviour override, gameplay helpers,
  exhaustive match recorder with JSON/MD export, performance panel.

## Open design work
Items still to be produced as content (animations, final
signature abilities, etc.) tracked in `NEXT_STEPS.md`. Historical
design bank in `ULTI_DESIGN.md` for ideas that didn't make the jam
cut.
