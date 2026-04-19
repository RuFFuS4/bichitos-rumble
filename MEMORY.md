# Memory — Bichitos Rumble

## Key Decisions
- **Online multiplayer delivered** (Colyseus authoritative, Railway hosted,
  up to 4 players per room with 60s auto bot-fill, bot-takeover on
  disconnect). Architecture: NO Vercel Functions for realtime, NO
  WebRTC/P2P, NO rollback. Client sends inputs, server simulates +
  broadcasts state.
- Offline mode with bots stays as alternate path (no regression allowed).
- Roster is data-driven: `src/roster.ts`. **All 9 playable critters**
  (Sergei, Trunk, Kurama, Shelly, Kermit, Sihans, Kowalski, Cheeto,
  Sebastian) ship with 3D GLBs and are confirmable from character
  select. Rojo/Azul/Verde/Morado are legacy prototypes kept only as
  internal placeholders for lab/debug fallback.
- GLB pipeline: `scripts/optimize-models.mjs` → `public/models/critters/<id>.glb`. Procedural fallback if GLB missing.
- **Skeletal animation loader** implemented (`src/critter-skeletal.ts`).
  GLBs that ship AnimationClips auto-attach an `AnimationMixer`; clip
  names resolved by fuzzy match (Mixamo title-case, Tripo snake_case).
  Procedural layer coexists for idle/run states and steps aside for
  heavy clips (victory/defeat/ability/lunge/fall/hit).
- Each critter has up to 3 abilities. Keys: J, K, L (ultimate). Abilities are config-driven with semantic tags.
- Bot AI uses `findAbilityByTag()` — decoupled from ability slot indices.
- `__tune()` debug tool available only in dev mode (`import.meta.env.DEV`).
- Controls: keyboard (WASD + Space/J/K/L + R/T), gamepad (standard
  Xbox/PS layout, A=HB, X=J, Y=K, RB=L), touch (joystick + 4 buttons).
- Camera: pseudo-isometric with depth (FOV 40, pos 0/23/25, lookAt 0/-3/0).
- Lives system: 3 lives per critter (default). On fall → pickRespawnPos
  (12 tries with shrinking radius, isOnArena validated, fallback (0,0)
  on immune centre) with 1.5s immunity.
- Public deploy: https://www.bichitosrumble.com (Vercel, auto-deploy from main).

## Known Physics Values
- Arena radius: 12 units, 29 fragments (1 immune + 28 collapsible)
- Immune center radius: 2.5 units (never collapses)
- Friction: frame-independent, halfLife 0.08s (input) / 0.03s (idle), deadZone 0.15
- Max speed: 20
- Acceleration scale: 1.6x
- Rojo base speed: 10
- Headbutt: anticipation 0.12s, lunge 0.15s, cooldown 0.45s, velocityBoost 4.0, recoil 0.35x
- Collision: normalPush 3.0, headbuttMult 3.5 (Rojo: 14×3.5=49, contrast 16x vs normal)
- Match duration: 120s, arena full collapse by ~53s

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

## Implemented: Organic Arena Collapse (Bloque B 3b)
- ~~Replace circular rings with procedural irregular sectors~~ DONE
- 29 fragments: 1 immune center (r=2.5) + 28 collapsible sectors (3 bands)
- Seed-deterministic: both server and client generate identical layout from the same seed
- Collapse: outer→inner, batches of 4-8 pieces, 8-10s timing, **3s warning window**
- **Warning effect** (2026-04-19): replaced red blink with localised
  per-fragment shake (three-sine composition, per-fragment phase,
  ~8cm amp) + warm orange emissive pulse (0 → 0.65) + seismic SFX
  (sub sine + filtered noise + crack chirps). Collisions unaffected
  because shake writes only to `fragmentGroup.position` while
  `isOnArena` uses the static layout.
- Server authoritative: arenaSeed + arenaCollapseLevel + arenaWarningBatch
- Shared generator: `src/arena-fragments.ts` + `server/src/sim/arena-fragments.ts`

## Future: Reusable PreviewScene for menus
- The `src/preview.ts` system (a second isolated WebGL renderer + scene)
  was built for the character select. It should be reused for:
  - **Winner posing screen** on the end overlay: show the winning critter
    on its pedestal, maybe with a subtle victory pose / trophy.
    Concrete idea: when entering `enterEnded('win', ...)`, fade out the
    3D arena, fade in the preview overlay with the player critter doing
    a celebration bob + slight scale pulse, name and stats panel on the
    side. Reuse existing `showPreview(config)` API.
  - Possible stats/achievements screen where the selected critter reacts
- Keep the preview module general (not coupled to character_select)

## Future: Character select polish (not yet implemented)
- **Slot transitions**: when navigating left/right, the previous slot
  should slide out / fade while the new slot slides in. Currently it's
  an instant swap. CSS `transition` on transform + opacity would be
  enough. The preview 3D already transitions smoothly thanks to the
  rotation smoothing, but the 2D slot grid feels snappy.
- **Stat bar bounce**: stats currently animate on `width` only. A small
  bounce overshoot (keyframe animation) would sell the "this critter is
  different" feel.
- **Selection sound**: a subtle tick on arrow navigation and a stronger
  confirm on SPACE. Ties in with the audio system.

## Future: Per-critter pedestals in PreviewScene
- Currently every critter stands on the same generic cylinder pedestal
  (`src/preview.ts:buildPedestal`).
- Long-term idea: each critter has a themed pedestal matching its
  identity (rock/lava for Verde, crystal for Morado, metal plate for
  Azul, wooden ring for Rojo).
- Implementation sketch:
  1. Add `pedestal` field to `CritterConfig`: `'default' | 'rock' | 'crystal' | 'metal' | 'wood'`
  2. In `preview.ts`, replace `buildPedestal()` with a map of builder
     functions keyed by pedestal type.
  3. On `showPreview(config)`, dispose the old pedestal meshes (already
     using `disposeMeshTree`) and build the one specified by config.
  4. Keep `'default'` as the current generic cylinder for locked/unknown.
- Same pattern could later extend to background skybox per critter.

## Deployment
- Public URL: https://www.bichitosrumble.com (custom domain aliased)
- Vercel project: ruffus4s-projects/bichitos-rumble
- GitHub ↔ Vercel auto-deploy ACTIVE: main → prod, dev → preview
- vercel.json with SPA rewrite verified working in production
- `.vercel/` is in `.gitignore` (auto by `vercel link`)

## Mobile Support
- Detection via capability probing: `hasTouchSupport()` + `isNarrowViewport(900)` → `isLikelyMobile()`
- Touch backend (`src/input-touch.ts`) only initialized if mobile-leaning
- Landscape orientation is REQUIRED — portrait shows a rotation prompt via CSS media query
- Hints in menus use `.desktop-only` and `.touch-only` CSS classes
- Tap handlers on title/end overlays (HUD layer), slot click handlers in character select
- Touch UI hidden by default, shown via `body.touch-mode` class
- Keyboard backend remains active on mobile too (external keyboards work)

## Future: HUD and character select mobile restructure
The current HUD and character select layouts were designed desktop-first
and then patched for mobile. On narrow landscape phones some elements
still compete for space:
- The 3×3 critter grid + 3D preview + info panel is very wide and can
  overflow on small landscape screens
- The top HUD row (alive + timer / lives / settings) is tight
- The touch controls (joystick + 3 buttons) eat ~200 px each side

Future restructure ideas (NOT yet implemented):
- Character select: stack grid and preview vertically on narrow screens
  (`@media (max-width: 800px) and (orientation: landscape)` or similar)
- Shrink the slot size on mobile, maybe 2×3 or 1×4 grid instead of 3×3
- Move lives panel to the bottom-center above the ability bar so the
  top HUD only has alive/timer on the left and settings on the right
- Make settings buttons slightly smaller on mobile (30 px vs 36 px)
- Consider a dedicated mobile stylesheet section after the current CSS

## Audio
- Web Audio API: `src/audio.ts`. Two independent buses (SFX + Music)
  each respecting its own mute state.
- **SFX** (synthesized, no asset files): headbuttHit, groundPound,
  abilityFire, fall, respawn, victory + arenaWarning (3-layer rumble).
- **Music**: 3 MP3 tracks shipped at `public/audio/` (intro, ingame,
  special). `playMusic(track)` with lazy fetch+decode, loop,
  exponential two-phase crossfade (200ms duck + 1.0s fade). Hooks
  per game phase: title/char-select/waiting → intro,
  countdown/playing → ingame, win → special, lose/draw → intro.
- Mute states persisted to localStorage (`bichitos.sfxMuted` +
  `bichitos.musicMuted`). Top-right 🔊 / 🎶 buttons toggle and
  reflect state. Buttons accessible on every screen (z-index above
  full-overlays).
- AudioContext lazily created on first `play()` / `playMusic()` call
  (respects browser autoplay policies).

## Arena Collapse (Bloque B 3b — fragments)
- 29 irregular sectors: immune center (r=0-2.5) + 3 radial bands with angular jitter
- Collapse in 4-5 batches (outer→inner), 4-8 fragments per batch
- Timing: first batch at 20s, then 8-10s between batches, 2s warning blink per batch
- Total collapse ~53s into a 120s match → ~67s endgame on immune center
- Both offline and online use the same seed-deterministic system
- Tuning centralised in FRAG config (`arena-fragments.ts`)

## Immunity Blink
- Materials MUST be initialized with `transparent: true` from the start.
  Toggling transparency mid-frame requires `needsUpdate = true` and is flaky.
- Blink uses square wave (not sine) for crisper on/off
- During "on" frame: white emissive at 0.8 intensity on head, 0.5 on body
- During "off" frame: opacity 0.15 (was 0.3, now more dramatic)

## Critter identity (implemented)
9 playable critters with GLB models generated in Tripo and per-critter
tuning of the 3 base ability types (`charge_rush`, `ground_pound`,
`frenzy`). Personalities emerge from stats (speed/mass/headbuttForce) +
ability tuning + procedural animation + optional skeletal clips.

| Name | Role | Animal | Kit |
|------|------|--------|-----|
| Sergei | Balanced | Gorilla | Gorilla Rush + Shockwave + Frenzy |
| Trunk | Bruiser | Elephant | Trunk Ram + Earthquake |
| Kurama | Trickster | Fox | Fox Dash + Mirror Burst + Frenzy |
| Shelly | Tank | Turtle | Shell Charge + Shell Slam + Frenzy |
| Kermit | Controller | Frog | Leap Forward + Poison Cloud |
| Sihans | Trapper | Mole | Burrow Rush + Tremor |
| Kowalski | Mage | Penguin | Ice Slide + Arctic Burst |
| Cheeto | Assassin | Tiger | Pounce + Paw Stomp |
| Sebastian | Glass Cannon | Crab | Claw Rush + Big Claw Slam |

Rojo/Azul/Verde/Morado are legacy prototypes retained only as internal
placeholders for lab/debug fallbacks — not shown in character select.

Abilities use base types (charge_rush / ground_pound / frenzy) with
per-critter overrides via factory functions. Gap between current
placeholder kits and final signature designs tracked in
`CHARACTER_DESIGN.md`. `AbilityDef.description` field used for
character select info pane.

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
- HeldActions: headbutt, ability1, ability2, ultimate (4 actions)
- Keyboard backend lives inside `input.ts` (always active)
- **Gamepad backend**: `src/input-gamepad.ts` (always on, no-op cost if no
  pad connected). Standard Xbox/PS layout. rAF polling. Deadzone 0.2
  radial + rescale. Hysteresis on stick→menu edges (on=0.6, off=0.3).
  `showGamepadToast` on connect/disconnect.
- Touch backend: `src/input-touch.ts` (joystick + 4 buttons, 2×2 layout)
- Touch controls gated with CSS `.match-active` — hidden in title/select/ended
- Capability detection via `hasTouchSupport()` + `isNarrowViewport()` +
  `isLikelyMobile()` (no user-agent sniffing)

## Next Priorities (deadline May 1, 2026 13:37 UTC)

All blocks A/B/C **closed**. Status snapshot as of 2026-04-19:

- **Core game loop**: implemented (offline + online, 9 playable critters).
- **Online 4P + bot-fill + waiting UX**: implemented.
- **Audio (SFX + music + crossfade)**: implemented.
- **Gamepad + touch + keyboard**: implemented.
- **Skeletal animation loader**: wired; waiting on animated GLBs from
  user's Mixamo/Blender/Tripo pipeline.
- **Arena pre-collapse shake + rumble**: implemented (replaces old blink).
- **Internal dev lab** (`/tools.html` with match recorder, bot control,
  perf panel, input panel): implemented.

What's left for submission:
1. User: generate + integrate per-critter skeletal animations (in flight).
2. User: submit via Google Form before May 1 @ 13:37 UTC.
3. Me: sign off Phase 4 polish (Lighthouse measurement, cross-device
   playtest session, screenshots for jam listing, 24h freeze).

## Deferred (post-deadline or if time permits)
- Full 9-character kits with the signature abilities designed in
  CHARACTER_DESIGN.md (current kits are placeholders sharing
  charge_rush/ground_pound/frenzy factories).
- `allowReconnection` for online rooms.
- Matchmaking, login, ranking, chat, rollback.
- Client-side prediction.
- Warp animation + SFX on portal transition.
- Stats display in end screen (recorder data already covers this —
  just need the UI).
- HUD restructure for mobile (current version OK, not ideal).
- Additional music tracks (defeat stinger, character select theme).
- Pattern C collapse (non-radial cuts).
