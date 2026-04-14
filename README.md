# Bichitos Rumble

A chaotic arena brawler where big-headed critters fight inside a circular arena that progressively collapses. Knock your rivals into the void!

Built for the [**2026 Vibe Coding Game Jam**](https://vibej.am/2026).

## Play

Live: **[https://www.bichitosrumble.com](https://www.bichitosrumble.com)**

Run locally:

```bash
npm install
npm run dev
```

## Multiplayer (local dev)

The online mode needs a Colyseus server running alongside the Vite client:

```bash
# terminal 1 — client
npm install
npm run dev

# terminal 2 — server
cd server
npm install
npm run dev
```

Client points at `ws://localhost:2567` by default in dev. Override with
`VITE_SERVER_URL` (e.g. `VITE_SERVER_URL=wss://my-server.fly.dev npm run dev`).

Once both are running, open `http://localhost:5173` in two browser
windows and click "Play Online (2P)" in each. The first becomes player 1,
the second joins as player 2, countdown starts, match begins.

Offline mode (title → select → match with bots) works without the server.

## Deployment

Configured for Vercel via `vercel.json` (SPA rewrites + Vite framework).
GitHub ↔ Vercel auto-deploy is connected:
- Push to `main` → production (`www.bichitosrumble.com`)
- Push to `dev` → preview URL (auto-generated per push)

Project: `ruffus4s-projects/bichitos-rumble`.

## Controls

### Desktop
| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move |
| Space | Headbutt |
| J | Ability 1 |
| K | Ability 2 |
| L | Ultimate (if available) |
| P | Expand/minimize portals (in match) · Next game (end screen, portal visitors) |
| B | Return to previous game (end screen, portal visitors only) |
| R | Restart / confirm |
| T / Esc | Back to title |

Top-right buttons: toggle SFX / music (state persists in localStorage).

### Mobile
- Virtual joystick bottom-left for movement
- Four action buttons bottom-right: L / J / ⚡ headbutt (large) / K
- Tap title/end screens to continue, tap a critter slot to select (tap again to confirm)
- Drag the 3D character preview in the select screen to rotate it
- **Landscape orientation required** (portrait shows a rotation prompt)

## Tech Stack

- TypeScript + Vite
- Three.js for 3D rendering (two isolated renderers: main arena + menu preview)
- Web Audio API for synthesized SFX (no asset files)
- No backend
- Vercel deployment

## Status

9-character roster shown in character select. Sergei (gorilla) is the first
fully playable real character with 3D GLB model and 3 abilities including
an ultimate. 8 remaining characters are marked WIP and not yet confirmable.
4 procedural placeholders are used internally as bot opponents.

Vibe Jam portal integration is live: exit portal (webring) and return portal
are minimized by default and expand with P key or mobile toggle. Players
arriving via `?portal=true` skip menus and drop straight into a match.

See [BUILD_LOG.md](BUILD_LOG.md) for sprint history.
