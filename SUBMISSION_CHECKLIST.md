# Submission Checklist — Bichitos Rumble

## ✅ Submitted

- [x] **SUBMITTED via Google Form on 2026-04-23** (well before May 1 deadline) → https://forms.gle/bGG4e3uD9PUUJKUc7

## Jam Info
- **Deadline**: May 1, 2026 @ 13:37 UTC
- **Submission form**: https://forms.gle/bGG4e3uD9PUUJKUc7
- **Official site**: https://vibej.am/2026/
- **Portal hub**: https://vibej.am/portal/2026

## Required for Jam Submission
- [x] Game runs in browser without install
- [x] No login or signup required
- [x] Free to play
- [ ] Fast startup (< 3 seconds to gameplay) — measure on public URL with Lighthouse
- [x] Game is brand new (created after April 1, 2026)
- [x] 90%+ AI-generated code
- [x] Deployed to public URL → https://www.bichitosrumble.com
- [x] README explains the game
- [x] Source code on GitHub
- [x] Jam widget included (`<script async src="https://vibej.am/2026/widget.js">`)

## Gameplay Minimum
- [x] Playable character with movement
- [x] At least 1 attack (headbutt)
- [x] Opponents to fight (3 offline bots and/or up to 3 online humans + bot-fill)
- [x] Win/lose condition
- [x] Restart flow
- [x] Character selection (9-slot roster, all playable)
- [x] Special abilities (up to 3 per critter: J, K, L)
- [x] Lives system (3 lives, respawn with 1.5s immunity)
- [x] All-critter lives HUD (with 🤖 badge for bots in online 4P)
- [x] Title screen
- [x] End screen with per-result messaging (distinguishes bot winners)
- [x] Online waiting room with countdown + humans/bots slots

## Polish Targets
- [x] Synthesized SFX (headbutt, ground pound, ability, fall, respawn, victory, arena warning)
- [x] Background music — 3 MP3 tracks (intro / ingame / special) with independent mute bus, exponential crossfade
- [x] SFX + music toggle buttons with localStorage persistence (accessible from every screen)
- [x] Screen shake on headbutt and ground pound
- [x] Hit flash on impact
- [x] **Arena warning**: localised per-fragment shake + warm orange emissive + seismic rumble SFX for 3s before collapse (replaces old red blink)
- [x] Immunity blink on respawn
- [x] 3D GLB models for all 9 playable critters
- [x] Procedural animation layer (idle bob / run bounce / lean / sway / squash-stretch per critter)
- [x] **Skeletal animation loader** — drops Mixamo/Tripo animated GLBs in `public/models/critters/` and the engine picks them up; procedural layer coexists and steps aside for heavy clips
- [x] Title screen
- [x] Victory/defeat screen
- [x] 3D rotatable preview in character select (auto-fit uniform scale per critter via `max(h,w,d)` sampling over 900ms — all 9 read at ~1.9u regardless of Tripo vs Meshy source)
- [x] **Matte-Meshy materials fixed** — `metalness=0 + roughness=0.7` forced whenever source PBR came in with `metalness>0.5`. Restores the flat-colour look from the Meshy visor.
- [x] Skeletal animations populated for the roster — **9/9 completos** 🎉 (Cheeto 8/8, Kermit 7/8 + Hypnosapo procedural, Kowalski 8/8, Trunk 8/8, Shelly 6/8 + Shell Charge/Shell Shield procedurales, Kurama 8/8 via Meshy, Sebastian 6/8 + Claw Rush/Crab Slash procedurales via Meshy, Sihans 8/8 via Meshy, Sergei 8/8 via Meshy). User pipeline: Meshy AI + Tripo Animate → `scripts/import-critter.mjs`.
- [x] **3 abilities per critter (J / K / L)** — **all 9 critters now ship signature L abilities** (Trunk Stampede battering ram, Kermit Toxic Touch confusion, Sihans Sinkhole real arena hole, Kowalski Frozen Floor slippery zone, Cheeto Cone Pulse channeled, Sebastian All-in side slash, Shelly Saw Shell spinning contact, Kurama Copycat mimics last-hit, Sergei Frenzy near-immovable berserk). Each L is flag-driven on top of the shared `frenzy` type so client + server stay parity-aligned. See `ABILITY_QA_CHECKLIST.md` for the full list + tuning history.
- [x] **Countdown drop desync'd** — critters hover at random altitudes (10–16u) with per-index delay (player instant, bots staggered 0.15–0.35s each) and play their `fall` clip under gravity, snapping to `idle` on landing.
- [x] **Offline pause menu** — ESC during `phase === 'playing'` (vs-bots only) opens a card with Resume / Restart / Quit-to-title. Freezes input + bots + physics; online path unaffected.
- [x] **"Press P" portal hint** — sprite floats above each portal when it's minimized (inverse opacity to the main label), switches to "TAP 🌀" on touch devices.
- [x] **HUD lives in 4 corners** — TL/TR/BL/BR with big avatars (70×70), critter name, hearts 16px, local-player gold highlight. Margins dodge the Vibe Jam widget + portal legend.
- [x] **Top-centre hero cluster** — timer 44px gold + Alive count uppercase letter-spaced. Readable from arm's length.
- [x] **Sprite system + AI-generated icons** — `/images/hud-icons.png` (4×7 grid, 26 icons) and `/images/ability-icons.png` (3×9 grid, 27 icons) preloaded by `main.ts`. Body classes `has-hud-sprites` / `has-ability-sprites` activate sprites only on load; emoji fallbacks stay on if the asset 404s. First integration live: abilities in character-select info pane + cooldown HUD. Hearts / bot-mask / belts-trophy / SFX / music icons pending next tanda.
- [x] **Favicon** — `/favicon-br.png` (AI-generated BR mark) as primary, previous SVG kept as fallback.
- [x] **5 themed arena packs** with skybox + ground texture + 40-50 in-arena decor GLBs each (jungle / frozen_tundra / desert_dunes / coral_beach / kitsune_shrine). Per-pack uniform decoration scaling so the largest prop hits ≈ 2.5× critter height for stronger pack identity.
- [x] **Scene-ready countdown gate** — "Preparing arena…" overlay holds the 3-2-1 sequence until skybox / ground / decor GLBs settle (or 2.5 s timeout). Eliminates the "GO! → decor pops in mid-fight" pop-in.
- [x] **Status effect HUD** — emoji glyphs above each critter (frozen / slowed / poisoned / stunned / vulnerable / frenzy / steel-shell / decoy-ghost), top-3 by priority, diff-rendered DOM overlay. `?` button opens an always-available legend.
- [x] **Sihans Sinkhole real hole** — L knocks out actual arena fragments under the disc (server-authoritative, broadcast `arenaFragmentsKilled`). Critters standing on the broken fragments fall to void. Centre immune fragment protected at 3 layers.
- [x] **Kurama Copycat HUD indicator** — when Kurama hits an enemy, a small portrait of the target appears in her L slot so she knows whose ultimate she'll mimic if she fires now.
- [x] **Persistent online identity v2 (BLOQUE FINAL)** — `sessionStorage` = THIS tab's confirmed identity, `localStorage` = device-preferred nickname for prefill only. Single tab + refresh = silent recovery. Two tabs same browser = second tab does NOT autologin (modal opens prefilled). Same nickname active in two tabs = clear `nickname_active_in_room` error.
- [x] **Hall of Belts 3D** — 16 offline + 5 online belts render as 3D thumbnails of their GLBs (shared offscreen WebGLRenderer 144×144, cached per id). Click any belt → full-screen modal with drag-to-rotate + idle auto-rotate + ESC/backdrop close. Same upgrade applied to badge unlock toasts and the online belt change toasts.
- [x] **Belt orientation final fix** — shared constants `BELT_FRONT_ROTATION_Y = -π/2` + `BELT_PREVIEW_ROTATION_X = 0.06` in `belt-thumbnail.ts` imported by `belt-viewer.ts`. Compensates for the GLB's native +X-facing export so belts read frontal across grid, modal, and toasts.
- [x] **Server admin scripts** for player table cleanup — `npm run admin:list-players`, `admin:player-stats`, `admin:delete-test`, `admin:delete-pattern`, `admin:reset-players` (in `server/scripts/admin-players.mjs`).
- [x] **Local dev DB cleaned** (`server/data/br-online.sqlite` reset 1 → 0 players via `npm run admin:reset-players -- --confirm --i-know-what-im-doing`).
- [ ] **Production / Railway DB cleaned** — Rafa to run on Railway shell:
  ```sh
  cd /app/server
  npm run admin:list-players                                              # before
  npm run admin:reset-players -- --confirm --i-know-what-im-doing
  npm run admin:list-players                                              # confirm 0
  ```
  Default DB path is `$DATA_DIR/br-online.sqlite` (Railway persistent volume). The script DRY-RUNs without `--confirm` and requires both `--confirm` AND `--i-know-what-im-doing` for the wipe.
- [x] Signature per-critter abilities — 9/9 L abilities authored and parity-verified (was 3/9 placeholders in the early build).
- [ ] Particle effects (beyond shockwave rings) — POST-JAM
- [ ] Remaining sprite integrations (hearts, bot-mask, belts, sfx/music icons, critter-head fallbacks) — POST-JAM

### Skeletal state policy (congelada 2026-04-21)
- **8 estados target** por bichito: `idle`, `run`, `ability_1`,
  `ability_2`, `ability_3` (ULTI), `victory`, `defeat`, `fall`.
- **Procedurales para todos** (no se autorizan clips): `headbutt_anticip`,
  `headbutt_lunge`, `hit`, `walk` (descartado), `respawn` (cubierto por
  inmunidad + parpadeo).
- Excepciones per-critter sólo si se especifica (ej. Kermit `ability_3`
  Hypnosapo = efecto emissivo procedural porque no hay clip).

## Input / Accessibility
- [x] Keyboard support (WASD + Space/J/K/L + R/T + P portal + B belts)
- [x] **Gamepad support** (standard Xbox/PS layout, connect/disconnect toast)
- [x] **Gamepad LB → portal toggle** (replaces P key when controller connected)
- [x] **Auto glyph swap on gamepad connect** — every J / K / L / SPACE / R chip in the UI rewrites to its gamepad equivalent (X / Y / RB / A / Start) and reverts on disconnect
- [x] Mobile touch (virtual joystick + 4 action buttons, landscape lock)
- [x] Settings buttons (🔊 / 🎶) reachable on every screen, not hidden behind overlays

## Online (Colyseus on Railway)
- [x] Up to 4 players per room (`maxClients = 4`)
- [x] 60s waiting timeout → auto bot-fill to start the match
- [x] Instant-start if 4 humans arrive before the timer
- [x] Bot-takeover on human disconnect mid-match (keeps match alive while ≥2 survivors)
- [x] Waiting screen (countdown + 4 slots with thumbnail + HUMAN/BOT badge)
- [x] Spectator prompt when the local player is eliminated mid-match (press T to leave)
- [x] End-screen distinguishes wins/losses against bots vs humans

## Deployment
- [x] `vercel.json` with SPA rewrites config
- [x] `vite.config.ts` with `base: './'` (relative asset paths) + multi-entry (`index.html` + `tools.html`)
- [x] Client build verified locally (`npm run build`)
  - index.html: ~96 kB / 22 kB gzip
  - main bundle: ~108 kB / 34 kB gzip (game logic + HUD + critter pipeline)
  - three.js chunk: ~628 kB / 158 kB gzip (cached across deploys)
  - colyseus.js chunk: ~127 kB / 39 kB gzip
  - model-loader + critter chunks: ~170 kB combined
  - critter GLBs: ~58 MB total (loaded on demand, browser-cached
    via `Cache-Control: max-age=31536000, immutable` per pack)
  - arena pack GLBs: ~88 MB total (5 packs, decor + skyboxes)
  - music: ~2.9 MB (intro / ingame / special MP3, lazy-loaded)
  - **dist post-build: ~240 MB total** (down from 2.7 GB before
    `clean-dist-raw.mjs` postbuild — see commit `df1cb5c`)
- [x] Vercel project connected (auto-deploy from GitHub: main → prod, dev → preview)
- [x] Custom domain `www.bichitosrumble.com` aliased to production
- [x] Server autodeploy to Railway
- [x] GitHub ↔ CI/CD stable (main → prod, dev → preview)
- [ ] Full cross-device playtest
- [ ] Lighthouse pass on prod URL

## Portal Feature (implemented)
- [x] Exit portal (green vertical ring) redirects to vibej.am/portal/2026 with player params
- [x] Start portal (orange) redirects back to ref URL (grace period 5s)
- [x] Minimized by default, expand with P key / mobile toggle button
- [x] Only usable when expanded (prevents accidental redirects from knockback)
- [x] HUD legend showing what each portal colour means
- [x] Portal entry (?portal=true) skips title/select, drops straight into a match
- [x] Character resolved data-driven from roster (matches URL `username` if playable; else random)

## Internal tooling (not shipped as player-facing)
- [x] `/tools.html` — internal dev lab with `<meta robots="noindex,nofollow">`, banner "INTERNAL DEV TOOL"
- [x] Grouped collapsible panels: Setup / Live Control / Observe / Tuning
- [x] Bot behaviour overrides (idle / passive / aggressive / chase / ability_only) per-bot and bulk
- [x] Gameplay helpers (reset CDs, force ability, teleport player/bots)
- [x] Match recorder with JSON + MD export (snapshots, events, actions, outcome)
- [x] Performance panel (FPS / drawCalls / tris / geo / tex / fragments)
- [x] Input panel (keys / held actions / gamepad axes+buttons)
- [x] Living docs: `DEV_TOOLS.md` + `ONLINE.md`

## Known deferrals (post-jam or explicit scope cut)
- Full per-character signature abilities (gap vs placeholders in CHARACTER_DESIGN.md)
- `allowReconnection` for online
- Region-based matchmaking / ranking / login / persistence
- Additional music tracks (defeat stinger, character select theme)
- Pattern C collapse (non-radial cuts)
