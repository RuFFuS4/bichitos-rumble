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

9-character roster with 3D GLB models. Sergei (gorilla) is the first fully
playable real character with 3 abilities including an ultimate. 4 placeholder
critters remain for bot matches. Character select shows the real roster with
WIP badges for characters without gameplay yet.

See [BUILD_LOG.md](BUILD_LOG.md) for sprint history.
