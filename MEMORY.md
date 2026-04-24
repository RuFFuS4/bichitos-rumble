# Memory — Bichitos Rumble

## Fuentes de verdad (canónico — 2026-04-24 handoff)

Si algo de esta lista entra en conflicto con cualquier otra sección
del proyecto, ESTA gana. Actualizar aquí cuando cambie la verdad
subyacente, no en duplicado por varios docs.

### Escala visual de los críttrs

- **SoT real**: el auto-fit en `Critter.attachGlbMesh` con constante
  `IN_GAME_TARGET_HEIGHT = 1.7` en `src/critter.ts`. Se aplica TANTO
  al preview del selector COMO al gameplay (misma clase).
- `roster.ts` entry.scale **YA NO es el tamaño final visible**. Es el
  "scale de entrada al auto-fit": el GLB se escala primero por
  `entry.scale`, después el auto-fit recomputa para llevar la altura
  idle-pose a 1.7u. Todos los 9 críttrs terminan a 1.700u.
- Herramienta de calibración manual: `/calibrate.html` (tercer entry
  de Vite). Los sliders mutan la mesh en vivo; el botón "Export"
  dumpa un snippet para pegar en `roster.ts`. **El lab es auxiliar
  — no edita `roster.ts` automáticamente.** Cualquier ajuste fino
  pasa por exportar manualmente.

### Sheet HUD canónica

- **Source authored**: `HUD_mejorado.png` en root del proyecto
  (4×6 grid, 20px margen + 20px gutter, 1024×1536).
- **Runtime**: `public/images/hud-icons.png` (4×6 grid, 256×256 cells
  sin padding, mismas dimensiones 1024×1536).
- **Regeneración**: `node scripts/rebuild-hud-sheet.mjs`. Idempotente:
  siempre lee del source authored. **Ejecutar cada vez que el authored
  cambie.** NO editar a mano el PNG runtime.
- **Backups**:
  - `public/images/hud-icons.original.png` — backup de la v1 con
    labels ("5. ELEPHANT", etc.) antes de que el usuario pasara el
    authored v2.
- **CSS**: `background-size: 400% 600%`, positions `0/33/66/100% × 0/20/40/60/80/100%`.
  Definido en `index.html` sección "SPRITE ICON SYSTEMS".

### Sprites del HUD — specificity (lección aprendida)

- Las clases `.sprite-hud-{id}` definen `background-position` pero
  la regla genérica `.sprite-hud { width: var(--icon-size, 24px) }`
  gana sobre cualquier override que tenga la misma specificity y vaya
  antes en el CSS. Para sitios donde el sprite debe llenar un slot
  (avatar 70×70, slot 74×74, etc.), usar **compound selectors** tipo
  `.sprite-hud.slot-avatar-sprite` o `.sprite-hud.lives-avatar-sprite`
  para subir specificity a (0,0,2).
- Esto se descubrió con MCP screenshots reales; la QA por DOM decía
  "sprite visible, bgImage correcto" pero el sprite renderizaba 24×24
  en la esquina.

### Clip resolver de animaciones skeletal

**4 tiers** en `src/critter-skeletal.ts`:

0. **Override explícito por crítter** (Tier 0, añadido 2026-04-24
   noche): `ANIMATION_OVERRIDES[critterId]?.[state]` en
   `src/animation-overrides.ts`. Si existe + el clip con ese nombre
   existe en el GLB, gana. Si el clip no existe en el GLB, fallback al
   resolver automático.
1. **Exact** (`name.replace(/[_\s-]/g, '') === state`). `Run` gana
   sobre `Running` para `state='run'`.
2. **Prefix** (`normalised.startsWith(keyword)`).
3. **Contains** (`name.includes(keyword)`).

- `isClipEffectivelyStatic` eps 1e-3 (antes 1e-4). Así los idle con
  breath micro-motion (~0.5 mm) no caen en la criba de "dead clip".
- `SkeletalAnimator.getResolveReport()` expone `{state, clipName,
  source}` para cada logical state. `source` ∈ `override | exact |
  prefix | contains | missing`. Consumer directo: `/anim-lab.html`.

### Animation overrides — fuente de verdad del mapping

- **SoT**: `src/animation-overrides.ts` (nuevo 2026-04-24). Record sparse
  `{ critterId: { state: clipName } }`. Vacío por default → 100%
  automático via resolver 3-tier. Cada entrada overridea SOLO los
  states problemáticos de ese crítter. Ejemplo:
  ```ts
  // Si un día Sergei ambiguase entre Run y Running y el resolver no
  // lo resolviera bien, añadiríamos:
  sergei: { run: 'Run' }
  ```
  Hoy el record está VACÍO porque el resolver Tier 1 (exact) ya maneja
  `Run` vs `Running` correctamente — documentado como caso-estudio
  en el comment del file.
- **Validación + edición** visual: `/anim-lab.html` (cuarto entry
  Vite, añadido 2026-04-24). Ver sección dedicada abajo.
- **Contrato**: si el override apunta a un clip name que no existe
  en el GLB, es un no-op (console.debug aviso) y el resolver
  automático corre normal. Los overrides son best-effort, no hard
  contract.

### `/anim-lab.html` — validación + override runtime de clips

Cuarto entry de Vite, dedicado a animaciones. Estructura paralela a
`/calibrate.html`:

- Panel izquierdo: roster picker (9 críttrs).
- Viewport central: Three.js con orbit + zoom, critter seleccionado.
- Panel derecho:
  - Playback (Play / Pause / Restart / Stop / Loop / Speed).
  - Clips in GLB (todos los clips + duración + state resuelto + Play
    individual).
  - Resolved mapping (los 13 logical states con dropdown por cada uno
    + badge de `source` tier).
  - Export overrides → clipboard con snippet pasteable en
    `src/animation-overrides.ts`.

**Flujo de uso**:
1. Abrir `/anim-lab.html`.
2. Click en crítter → carga GLB + skeletal animator.
3. Inspeccionar clips y el mapping resuelto. Ver el badge `source`
   (override / exact / prefix / contains / missing) para saber POR
   QUÉ el resolver eligió ese clip.
4. Para forzar un cambio: dropdown de la tabla de mapping. Cambiar
   → click **"Apply & reload critter"** → el critter se rebuildeará
   con el override en efecto.
5. Si el override se confirma bueno: click **"Export snippet"** →
   pegar en `src/animation-overrides.ts`.

**Debug hook**: `window.__animLab()` desde la consola devuelve
`{ currentId, critter, sessionOverrides, effectiveOverrides }`.

### Arena packs cosméticos

- 5 packs: `jungle / frozen_tundra / desert_dunes / coral_beach /
  kitsune_shrine`. Seleccionado aleatoriamente cada partida.
- **Sync online**: `GameState.arenaPackId` (string, default 'jungle').
  Rolado en `BrawlRoom.transitionToCountdown`. Layout de props
  determinístico desde `(seed, packId)` via `mulberry32` en
  `arena-decorations.ts`.
- Assets en `public/models/arenas/<pack>/*.glb` + skyboxes en
  `public/images/skyboxes/<pack>.png` + ground tiles en
  `public/images/arena-ground/<pack>.png`.
- Loader completo en `src/arena-decorations.ts`. `Arena.buildFromSeed`
  acepta `packId` opcional.

### MCP Claude Preview — screenshots

- Default viewport es **portrait** (~452×1600). El juego bloquea
  portrait → screenshot vacío. **Obligatorio** llamar
  `preview_resize({ width: 1280, height: 800 })` antes de capturar.
- Presets `desktop` / `tablet` no redimensionan (reset a native).
  Siempre dimensiones explícitas.
- rAF está pausado sin foco en el tab MCP. El game loop no corre.
  Workaround: `preview_eval` con `window.__game.update(0.016)`
  manualmente en bucle.
- Tras soft reload el browser cachea assets estáticos. Para forzar
  fresh fetch: `location.href = '/?_t=' + Date.now()`.

### Scripts activos vs obsoletos (2026-04-24)

**Activos** (seguir usando):
- `rebuild-hud-sheet.mjs` (regenera hud-icons desde authored)
- `optimize-arena-props.mjs` · `aggressive-simplify.mjs` ·
  `compress-arena-textures.mjs` (pipeline arena)
- `inspect-clips.mjs` (medir duraciones de clips de un GLB — sigue
  útil para `scripts/inspect-clips.mjs <path>` en terminal, aunque
  `/anim-lab.html` ahora expone lo mismo en UI).
- `import-belts.mjs` · `import-critter.mjs`
- `verify-critter-glbs.mjs`
- `doctor.mjs` · `compress-audio.mjs` · `make-og-image.mjs`

**Entries HTML de Vite** (cuatro):
- `index.html` → juego (prod).
- `tools.html` → dev lab (partida con debug panel).
- `calibrate.html` → roster calibration (tamaños scale/pivot).
- `anim-lab.html` → **animation validation + override** (nuevo
  2026-04-24 noche).

**Obsoletos** (marcados, candidatos a limpieza post-jam):
- `scripts/trim-hud-sheet.mjs` — servía para limpiar labels de debug
  del sheet v1. La sheet v2 (`HUD_mejorado.png`) ya viene sin labels,
  así que este script es redundante. No borrar por si vuelve a
  aparecer un sheet con labels; marcado como histórico.

## Key Decisions (latest at top)

### 2026-04-23 — Character-select auto-fit + HUD rework + sprites

- **`preview.ts` has a `fitWrapper` inside `holder`** that applies a
  per-critter uniform scale. The scale is computed during a 900ms sample
  window of the idle loop, taking `max(h, w, d)` of the bone bounding
  box and normalising to `TARGET_SILHOUETTE_MAX = 1.9u`. Preserves
  proportions per critter (Trunk tall/slim, Sebastian wide/short).
- **Meshy matte material fix**: `Critter.attachGlbMesh` forces
  `metalness=0 + roughness=0.7` whenever the source PBR came in with
  `metalness > 0.5`. Meshy exports at `metalness=1` without an envMap,
  which rendered as dark grey. Tripo materials are untouched.
- **Settings HUD always visible**: `setMatchHudVisible` used to
  `display:none` the entire `#hud`, killing `#hud-settings` (SFX+music).
  Fixed — now the function only toggles `body.match-active` and CSS
  gates individual children. Root stays visible so 🔊/🎶 are reachable
  on every screen.
- **Lives in 4 corners** (TL/TR/BL/BR) instead of centered top column.
  70×70 avatars, critter name, hearts, local-player highlighted in gold.
- **6 ULTIs added** (placeholder `frenzy`) so every critter shows 3
  slots: Trunk Stampede / Kermit Hypnosapo / Sihans Diggy Rush /
  Kowalski Blizzard / Cheeto Tiger Rage / Sebastian Red Claw. Client +
  server mirrored.
- **Countdown drop is staggered**: player (index 0) falls immediately;
  bots cascade with `i × (0.15..0.35)s` + jitter. Each critter plays
  its `fall` clip on gravity onset and snaps to `idle` on landing.
- **Offline pause menu (ESC → Resume/Restart/Quit)** in vs-bots only.
  Online doesn't pause (authoritative server).
- **Portal "Press P" hint** — 3D sprite above each portal, inverse
  opacity to the main label. Switches to "TAP 🌀" on touch.
- **Sprite sheet system** `.sprite-hud-*` + `.sprite-ability-*`, activated
  by `body.has-hud-sprites` / `body.has-ability-sprites` classes only
  when the backing PNG loads. Emoji fallbacks stay otherwise. Sheets
  live at `public/images/hud-icons.png` (4×7, 26 icons) and
  `public/images/ability-icons.png` (3×9, 27 icons). First integration:
  ability icons in character-select info pane + in-match cooldown HUD.
- **Favicon**: `/favicon-br.png` (AI-generated BR mark) primary, SVG
  kept as secondary.
- **Submitted to Vibe Jam Google Form on 2026-04-23** (well before
  the May 1 deadline). Repo is now polish-only.

## Key Decisions (historical)
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
