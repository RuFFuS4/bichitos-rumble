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
