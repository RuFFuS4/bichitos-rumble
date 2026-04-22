# Submission Checklist — Bichitos Rumble

## ⚠️ Pending user action

- [ ] **SUBMIT VIA GOOGLE FORM before May 1, 2026 @ 13:37 UTC** → https://forms.gle/bGG4e3uD9PUUJKUc7

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
- [x] 3D rotatable preview in character select
- [x] Skeletal animations populated for the roster — **9/9 completos** 🎉 (Cheeto 8/8, Kermit 7/8 + Hypnosapo procedural, Kowalski 8/8, Trunk 8/8, Shelly 6/8 + Shell Charge/Shell Shield procedurales, Kurama 8/8 via Meshy, Sebastian 6/8 + Claw Rush/Crab Slash procedurales via Meshy, Sihans 8/8 via Meshy, Sergei 8/8 via Meshy). User pipeline: Meshy AI + Tripo Animate → `scripts/import-critter.mjs`.
- [ ] Signature per-critter abilities (gap vs placeholders tracked in CHARACTER_DESIGN.md)
- [ ] Particle effects (beyond shockwave rings)

### Skeletal state policy (congelada 2026-04-21)
- **8 estados target** por bichito: `idle`, `run`, `ability_1`,
  `ability_2`, `ability_3` (ULTI), `victory`, `defeat`, `fall`.
- **Procedurales para todos** (no se autorizan clips): `headbutt_anticip`,
  `headbutt_lunge`, `hit`, `walk` (descartado), `respawn` (cubierto por
  inmunidad + parpadeo).
- Excepciones per-critter sólo si se especifica (ej. Kermit `ability_3`
  Hypnosapo = efecto emissivo procedural porque no hay clip).

## Input / Accessibility
- [x] Keyboard support (WASD + Space/J/K/L + R/T)
- [x] **Gamepad support** (standard Xbox/PS layout, connect/disconnect toast)
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
  - main game bundle: ~3 kB (entry)
  - shared chunk: ~840 kB (Three.js + Colyseus.js + game logic)
  - index.html: ~34 kB
  - tools chunk: ~37 kB (internal dev lab, separate entry)
  - music assets: ~3 MB (intro/ingame/special MP3 in `public/audio/`)
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
