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
- **tsc** — type checking (noEmit) for both client and server targets

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
- **Tripo AI** — 3D character models. All 9 playable critters
  (`public/models/critters/*.glb`) were generated and iterated there.
  Models imported as GLB + scaled in-engine via `src/model-loader.ts`.
  Procedural animation layer (`src/critter-animation.ts`) adds idle
  bob, run bounce, lean, sway and headbutt pose on top of the static
  meshes — no bones, no rigged animations yet.

Everything AI-generated is exported as static assets that ship with
the bundle. No runtime calls to Suno or Tripo from the game.

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

All AI-generated content (Suno audio, Tripo models) is baked into
`public/` — no external API calls from the shipped build.
