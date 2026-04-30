# Bichitos Rumble

A chaotic arena brawler where big-headed critters fight inside an
irregularly-collapsing arena. Headbutt your rivals into the void before
the floor disappears beneath them.

Built for the [**2026 Vibe Coding Game Jam**](https://vibej.am/2026).

## Play

Live: **[https://www.bichitosrumble.com](https://www.bichitosrumble.com)**

Modes available from the title screen:
- **vs Bots** — offline, 3 AI opponents, 4 critters total.
- **Online Multiplayer (up to 4P)** — rooms of up to 4 humans. If the
  room doesn't fill in 60s, bots join automatically. Seamless mix of
  humans + bots; humans that disconnect mid-match are replaced by
  bot-takeover.

Run locally:

```bash
npm install
npm run dev
```

## Multiplayer (local dev)

Online mode needs a Colyseus server running alongside the Vite client:

```bash
# terminal 1 — client
npm install
npm run dev

# terminal 2 — server
cd server
npm install
npm run dev
```

The client points at `ws://localhost:2567` by default in dev. Override
with `VITE_SERVER_URL` (e.g.
`VITE_SERVER_URL=wss://my-server.fly.dev npm run dev`).

Open two (or up to four) browser windows, click **Online Multiplayer**
in each. The countdown starts either when the room fills with 4 humans
or when the 60s waiting timer expires (bots fill the rest).

Offline mode (title → select → match vs bots) works without the server.

## Deployment

Configured for Vercel via `vercel.json` (SPA rewrites + Vite framework).
GitHub ↔ Vercel auto-deploy is connected:
- Push to `main` → production (`www.bichitosrumble.com`)
- Push to `dev` → preview URL (auto-generated per push)

Colyseus server auto-deploys to Railway from the same repo.

## Controls

### Desktop — Keyboard
| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move |
| Space | Headbutt |
| J | Ability 1 |
| K | Ability 2 |
| L | Ultimate (if available) |
| P | Expand/minimize portals (in match) · Next game (end screen) |
| B | Return to previous game (end screen, portal visitors only) |
| R | Restart / confirm |
| T / Esc | Back to title / leave online room |

Top-right: 🔊 SFX toggle · 🎶 music toggle (state persists in
`localStorage`).

### Desktop — Gamepad (Xbox / PS / generic standard)
Any controller that reports the W3C 'standard' Gamepad layout works:

| Input | Action |
|-------|--------|
| Left stick | Move (radial deadzone 0.2) |
| A (☒) | Headbutt (held) + confirm (menus) |
| B (◯) | Back / leave room |
| X (▢) | Ability 1 |
| Y (△) | Ability 2 |
| RB (R1) | Ultimate |
| Start | Restart / confirm |
| D-Pad | Menu navigation |

A small toast appears in the bottom-right when a gamepad connects or
disconnects.

### Mobile (touch)
- Virtual joystick bottom-left for movement.
- Four action buttons bottom-right: L (top-left), J (top-right),
  ⚡ headbutt (large, bottom-right), K (bottom-left).
- Tap title/end screens to continue; tap a critter slot to select,
  tap again to confirm.
- Drag the 3D character preview to rotate it.
- **Landscape orientation required** (portrait shows a rotation prompt).

## Tech Stack

Client:
- TypeScript + Vite (multi-entry: `index.html` = game,
  `tools.html` = internal dev lab).
- Three.js 0.172 (scene, GLTF loader, AnimationMixer).
- Web Audio API — SFX synthesized, music from MP3 tracks
  (`public/audio/`).

Server:
- Node + Colyseus 0.16 authoritative rooms + schema v3.

Deployment:
- Vercel (client), Railway (server), custom domain via Hostinger.

AI-assisted content:
- **Tripo AI** — all 9 critter GLB models.
- **Tripo Animate** — primary rigging + animation source for the
  critters that ship skeletal clips (currently Cheeto, Kermit, Kowalski,
  Trunk).
- **Meshy AI** — alternative auto-rigger, kept in the stack for
  non-humanoid morphologies where Tripo Animate struggles.
- **Suno** — 3 MP3 tracks (intro / ingame / special) with exponential
  crossfade between phases.

All AI-generated assets are baked into the bundle as static files; no
runtime calls to any external AI service from the shipped build.

Full stack details: [`STACK.md`](STACK.md).

## Status

9-character roster, all playable with 3D GLB models. Each critter has
3 active abilities (J / K / L) with distinct identities — see the
[Abilities](#abilities-jkl) table below for the current kit.
Procedural animation layer gives each critter distinct idle bob, run
cadence, lean and squash/stretch derived from their mass+speed stats.
Skeletal animation coverage **9 / 9** — every critter ships the
8-state kit (idle / run / ability_1 / ability_2 / ultimate / victory /
defeat / fall) via Mixamo, Tripo Animate, or Meshy clips, with
authored procedural fallback for the few that ship fewer named clips.
Pipeline: `npm run import:critter <id> <source.glb>` with a duration-
mapping JSON under `scripts/mappings/`. See
[`CHARACTER_DESIGN.md`](CHARACTER_DESIGN.md) for the per-critter table.

**Stats are driven by a single P/W/S tuple** per critter
(Power / Weight / Speed, each -2..+2). `src/pws-stats.ts` derives the
raw numeric stats (speed / mass / headbuttForce) via a linear mapping
and the server imports the same table byte-identical, so rebalancing
is a 3-character edit per row that propagates to both client + server.

The arena is a stone platform floating high in a painted sky (custom
shader skydome + distant cloud disc) — when a fragment collapses it
tumbles away under gravity instead of vanishing. Countdown entry: the
fighters drop from the sky with a gravity arc, a dust puff + thud fire
as each one lands. The 3-2-1 digits ramp colour with urgency (red →
amber → yellow) and GO! paints in green with a radial burst.

Online supports up to 4 humans per room with automatic bot-fill. The
waiting room shows the lineup with human/bot badges and a visible
countdown.

Vibe Jam portal integration is live: exit portal (webring) and return
portal; players arriving via `?portal=true` skip menus and drop
straight into a match. A warp transition plays for ~650 ms before each
redirect so the hand-off feels like a portal trip, not a hard-cut.

## Abilities (J/K/L)

Every critter has 3 active abilities + a basic headbutt (Space). The
roster is built around contrasting roles: bruisers anchor and ram
through the crowd, tricksters dodge and copy, mages set up zones, the
glass cannon swings everything on a single strike.

| Critter | J | K | L |
|---|---|---|---|
| Sergei | Gorilla Rush (heavy dash) | Shockwave (radial slam) | Frenzy (near-immovable berserk) |
| Trunk | Trunk Ram (long dash) | Trunk Grip (yank + 4 s stun) | Stampede (battering ram) |
| Kurama | Fox Dash (fast feint) | Mirror Trick (decoy + ghost) | Copycat (mimics last-hit target's L) |
| Shelly | Shell Charge (slow ram) | Steel Shell (immune anchor) | Saw Shell (spinning contact knockback) |
| Kermit | Leap Forward | Poison Cloud (slow + fog) | Toxic Touch (control inversion) |
| Sihans | Burrow Rush | Sand Trap (blink + quicksand) | Sinkhole (real arena hole) |
| Kowalski | Ice Slide | Snowball (freeze projectile) | Frozen Floor (slippery zone) |
| Cheeto | Pounce (lightning lunge) | Shadow Step (blink + impact) | Cone Pulse (frontal pulses) |
| Sebastian | Claw Rush (sideways scuttle) | Claw Wave (frontal cone) | All-in (commit, hit big or fall) |

A floating emoji over each critter signals their current status:
❄️ frozen / 🐌 slowed / ☠️ poisoned / 💫 stunned / 💥 vulnerable /
🔥 frenzy / 🛡️ steel-shell / 👻 decoy-ghost. The "?" button on the
title and HUD opens a status legend so players don't need to memorise
them.

## Arena packs

Five visually distinct arena packs roll randomly per match: jungle,
frozen tundra, desert dunes, coral beach, kitsune shrine. Each ships
its own skybox, fog tint, ground texture, and ~40-50 in-arena decor
GLBs (palms, icebergs, cacti, corals, torii). The countdown waits for
the pack assets to settle before "GO!" so the match never starts on
a bare floor.

**Local achievement system** (BADGES) — 16 WWE-style belts
(9 per-critter Champions + 7 global trophies like Speedrun / Iron
Will / Pain Tolerance) that unlock as you play. Progress persists in
localStorage. A floating toast surfaces new unlocks on the end-screen;
the full catalogue lives in a "Hall of Belts" modal accessible from
character-select (button or **B** key). Placeholder emoji icons until
the generated PNGs drop (prompts in [`AI_PROMPTS.md`](AI_PROMPTS.md)).

## More docs

| File | Topic |
|------|-------|
| [`STACK.md`](STACK.md) | Full client/server tech stack |
| [`ONLINE.md`](ONLINE.md) | Online 4P flow, bot-fill, edge cases |
| [`DEV_TOOLS.md`](DEV_TOOLS.md) | Internal `/tools.html` lab |
| [`GAME_DESIGN.md`](GAME_DESIGN.md) | Core design pillars |
| [`CHARACTER_DESIGN.md`](CHARACTER_DESIGN.md) | Roster + abilities + skeletal coverage |
| [`RULES.md`](RULES.md) | Gameplay rules |
| [`ASSET_PIPELINE.md`](ASSET_PIPELINE.md) | GLB optimization + import flow |
| [`BLENDER_MCP.md`](BLENDER_MCP.md) | Tripo Animate / Meshy cleanup via Blender (standby) |
| [`BADGES_DESIGN.md`](BADGES_DESIGN.md) | WWE-belt achievement system (live in Phases 1-4) |
| [`PROCEDURAL_PARTS.md`](PROCEDURAL_PARTS.md) | Per-critter bone/primitive playbook for future abilities |
| [`AI_PROMPTS.md`](AI_PROMPTS.md) | Prompt library for generative asset passes |
| [`BUILD_LOG.md`](BUILD_LOG.md) | Sprint history (pre-launch in `docs/archive/`) |
| [`NEXT_STEPS.md`](NEXT_STEPS.md) | Roadmap to jam deadline |
| [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md) | Jam deliverables gate |
| [`VALIDATION_CHECKLIST.md`](VALIDATION_CHECKLIST.md) | Manual QA batch |
