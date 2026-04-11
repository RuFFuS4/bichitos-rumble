# Bichitos Rumble

A chaotic arena brawler where big-headed critters fight inside a circular arena that progressively collapses. Knock your rivals into the void!

Built for the [**2026 Vibe Coding Game Jam**](https://jam.pieter.com/2026).

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
| R | Restart / confirm |
| T / Esc | Back to title |

Top-right button: toggle all sound (state persists in localStorage).

### Mobile
- Virtual joystick bottom-left for movement
- Three action buttons bottom-right: J / ⚡ headbutt (large) / K
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

v0.3 "core gameplay loop" is the current tag on `main`. Full playable flow
(title → character select → match → end screen) with mobile support,
differentiated critters, audio, and game feel pass. See
[BUILD_LOG.md](BUILD_LOG.md) for sprint history and [ULTI_DESIGN.md](ULTI_DESIGN.md)
for the upcoming Ultimate Ability system.
