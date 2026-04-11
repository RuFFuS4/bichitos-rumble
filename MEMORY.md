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

## Audio
- Web Audio API synthesized (no asset files): `src/audio.ts`
- 6 sounds: headbuttHit, groundPound, abilityFire, fall, respawn, victory
- Mute state persisted in localStorage key `bichitos.muted`
- Top-right 🔊/🔇 button toggles mute, reflects state visually
- AudioContext lazily created on first `play()` call (respects autoplay policies)

## Arena Collapse (updated)
- 6 rings, one collapses every 20s starting at ring 0 (outermost)
- 1.5s warning BEFORE disappearance: ring blinks red with accelerating rate
  (WARNING_BASE_RATE 4 → WARNING_PEAK_RATE 16 blinks/s)
- Ring is STANDABLE during warning — `currentRadius` only shrinks when the
  ring actually disappears, so players have real margin to step off

## Immunity Blink
- Materials MUST be initialized with `transparent: true` from the start.
  Toggling transparency mid-frame requires `needsUpdate = true` and is flaky.
- Blink uses square wave (not sine) for crisper on/off
- During "on" frame: white emissive at 0.8 intensity on head, 0.5 on body
- During "off" frame: opacity 0.15 (was 0.3, now more dramatic)

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
