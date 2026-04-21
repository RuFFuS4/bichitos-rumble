# Tech Stack — Bichitos Rumble

## Client runtime
- **TypeScript** — strict mode, ES2020 target
- **Three.js** v0.172 — 3D rendering (scene, meshes, lighting, camera,
  GLTF loader for critter models)
- **Web Audio API** — native, no Howler. Synthesized SFX +
  crossfaded MP3 music buses

## Server runtime
- **Node.js** — production on Railway
- **Colyseus** 0.16 — authoritative rooms + binary state sync over
  WebSocket
- **@colyseus/schema** v3 — typed schemas synced to clients

## Build
- **Vite** v6.2 — multi-entry bundler (`index.html` = game,
  `tools.html` = internal dev lab). Static assets from `public/`
  served before the SPA rewrite so `/tools.html` resolves.
- **tsc** — type checking (noEmit) for both client and server targets.
- **`mesh2motion/` subpackage** — separate Vite 8 build that lands its
  output in `public/animations/`, so the main game's build copies it
  straight into `dist/animations/`. See `mesh2motion/README-INTEGRATION.md`.

## Deployment
- **Vercel** — client CI/CD and hosting (autodeploy from `main`)
- **Railway** — server CI/CD and hosting (autodeploy from `main`)
- **Hostinger** — custom domain `bichitosrumble.com`
- **GitHub** — source control. Dev branch `dev`; main branch `main`.

## Content generation (AI-assisted)
- **Suno** — background music. Three MP3 tracks shipped in
  `public/audio/`:
  - `intro.mp3` — title / character-select / waiting-room loop
  - `ingame.mp3` — countdown + match loop
  - `special.mp3` — victory stinger
  Prompts iterated in Suno Advanced (Lyrics + Styles + Title). Mute
  toggles (SFX 🔊, Music 🎶) persist across sessions via
  `localStorage`.
- **Tripo AI** — 3D character model generation. All 9 playable critters
  (`public/models/critters/*.glb`) were generated and iterated there.
  Models imported as GLB + scaled in-engine via `src/model-loader.ts`.
- **Tripo Animate** (Tripo's rigging + animation product) —
  auto-rigs the generated model and provides a small animation
  library per critter. Used for Kermit's 7-clip set (idle, run,
  ability_1 leap, ability_2 poison cloud, victory, defeat, fall).
  **Gotcha**: Tripo exports the clips inside NLA tracks → clip names
  come out as `NlaTrack.XXX` (semantic names lost). The re-name flow
  lives in `BLENDER_MCP.md` → "Animaciones via Tripo Animate".
- **Meshy AI** (external, primary animation source going forward) —
  alternative auto-rigger with a considerably larger stock-animation
  library than Tripo Animate. Better results on non-humanoid
  morphologies. Same downstream integration path as Tripo Animate:
  export GLB with animations → rename actions to match our
  `STATE_KEYWORDS` (in `src/critter-skeletal.ts`) → drop into
  `public/models/critters/<id>.glb`. If any specific clip exports
  corrupt (static / 0-variance — observed once with Kermit's
  Run + Ability1), transplant the affected clips from the source
  GLB via `gltf-transform` (see the "transplant fix" at the end of
  the Tripo Animate section in `BLENDER_MCP.md`).

### On standby (kept in the stack, not in active use)

- **Mesh2Motion** (integrated as `/animations` internal lab, subpackage
  `mesh2motion/`) — open-source (MIT code + CC0 assets) web tool for
  rigging models and exporting animated GLBs. Ships a 124-clip human
  library that we can retarget onto Tripo rigs via the custom
  `BichitosTripoRetargeter` (bone-name mapping) and an opt-in
  "Use existing rig" button injected into the Edit Skeleton step.
  **Standby reason**: Meshy + Tripo Animate together cover animation
  needs without requiring browser-side retargeting; the lab stays
  functional for ad-hoc experiments but isn't on the critical path.
  Full integration details in `mesh2motion/README-INTEGRATION.md`.
- **Blender MCP** ([`ahujasid/blender-mcp`](https://github.com/ahujasid/blender-mcp)) —
  local-only MCP server that exposes a running Blender 3.0+ session
  to Claude Code. Claude writes/executes `bpy` Python scripts directly
  (rigging, weight paint, animation retarget, GLB export) while Blender
  is the visual engine. Used heavily during the Tripo / Meshy import
  pipeline (rename actions, join mesh parts, decimate, pose cleanup,
  re-export). **Standby reason**: user keeps the MCP connected for
  ad-hoc debugging and the rare case we need custom bpy tooling, but
  routine animation import work goes straight from Meshy → gltf-
  transform when possible (skips the Blender roundtrip). Setup +
  workflow in `BLENDER_MCP.md`.

Base animation layer is **procedural** (`src/critter-animation.ts`):
idle bob, run bounce, lean, sway, squash/stretch derived from each
critter's mass+speed. Skeletal clips from Tripo Animate / Meshy layer
on top via `src/critter-skeletal.ts` when a critter ships clips.
Critters without clips (or missing specific states like
`headbutt_anticip`, `hit`, `respawn`) fall back to procedural
transparently thanks to the `isClipEffectivelyStatic` safety filter.
Special per-critter effects that don't need keyframes (e.g. Kermit
Hypnosapo = purple flicker for `ability_3`) live in
`critter.ts` → `updateVisuals()` keyed by `config.name`.

Everything AI-generated is exported as static assets that ship with
the bundle. No runtime calls to Suno, Tripo, Meshy or any other AI
service from the shipped build.

## Architecture — client
Game code lives in `src/`:
- `main.ts` — entry point, renderer setup, game loop, camera, audio init
- `game.ts` — full state machine (title → character_select →
  countdown → playing → ended, plus `online` for multiplayer)
- `arena.ts` + `arena-fragments.ts` — seed-deterministic irregular
  fragment collapse (shared generator with server, byte-identical)
- `critter.ts` — critter entity (mesh, physics state, headbutt,
  ability states, lives, immunity blink, `isBot` flag for online fill)
- `critter-animation.ts` — procedural animation layer (per-critter
  personality derived from mass + speed)
- `bot.ts` — offline AI (chase + headbutt + ability heuristics, honours
  `debugBotBehaviour` for the lab)
- `physics.ts` — collision resolution + fall-off detection
- `abilities.ts` — config-driven ability system, VFX shockwave
- `gamefeel.ts` — hit stop, scale feedback, knockback tilt, camera
  shake, hit flash, `FEEL` config
- `input.ts` — device-agnostic input abstraction + keyboard backend
- `input-touch.ts` — touch backend (virtual joystick + buttons), mobile
- `player.ts` — local player controller
- `camera.ts` — pseudo-isometric setup
- `hud.ts` — DOM HUD (lives, timer, abilities, title/select/end
  screens, **waiting-screen + spectator prompt** for online 4P)
- `audio.ts` — Web Audio SFX + music buses (musicGain + exponential
  crossfade with duck-and-preroll shape)
- `network.ts` — Colyseus client wrapper (connectToBrawl, sendInput)
- `portal.ts` — Vibe Jam portal in/out (entry by URL params, exit via
  walking into the green portal)
- `preview.ts` — second isolated WebGL renderer for menu 3D
- `slot-thumbnail.ts` — shared offscreen renderer that caches a PNG
  per critter (used by character-select + waiting-slots)
- `stats.ts` — lightweight localStorage stats (picks / outcomes)

Lab (`/tools.html`) lives in `src/tools/`:
- `main.ts` — lab entry point
- `dev-api.ts` — single debug surface wrapping `Game + Renderer`
  (snapshots, bot control, force-ability, teleports, event log,
  exhaustive match recorder with JSON + MD export)
- `sidebar.ts` — grouped collapsible panels (Setup / Live Control /
  Observe / Tuning)

See `DEV_TOOLS.md` and `ONLINE.md` for living docs on those two
subsystems.

## Architecture — server
`server/src/`:
- `index.ts` — bootstrap, `gameServer.define('brawl', BrawlRoom)`,
  health endpoint
- `BrawlRoom.ts` — authoritative room (maxClients 4, waiting timer,
  bot-fill, bot-takeover, match sim)
- `sim/config.ts` — numeric gameplay constants (MUST stay in sync
  with client's `gamefeel.ts`)
- `sim/arena.ts` + `sim/arena-fragments.ts` — seed-deterministic
  fragment collapse (shared generator with client)
- `sim/physics.ts` — collision + fall-off + falling animation
- `sim/abilities.ts` — ability tick + event broadcasting
- `sim/bot.ts` — server-side bot AI (chase + HB + ability ocasional)
- `state/GameState.ts` — top-level schema (phase, timers,
  waitingTimeLeft, players map)
- `state/PlayerSchema.ts` — per-player schema (position, state,
  abilities, isBot flag)
- `state/AbilityStateSchema.ts` — per-ability state synced to clients

## Dependencies
Client (only 3):
- `three` + `@types/three`
- `typescript`
- `vite`
- `colyseus.js` (runtime) — thin WebSocket client

Server:
- `colyseus`
- `@colyseus/schema`
- `@colyseus/ws-transport`

All AI-generated content (Suno audio, Tripo/Meshy models + anims) is
baked into `public/` — no external API calls from the shipped build.
