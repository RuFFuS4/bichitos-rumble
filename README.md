# Bichitos Rumble

A chaotic arena brawler where big-headed critters fight inside a circular arena that progressively collapses. Knock your rivals into the void!

Built for the [**2026 Vibe Coding Game Jam**](https://jam.pieter.com/2026).

## Play

Run locally:

```bash
npm install
npm run dev
```

A public URL will be added here once the game is deployed.

## Deployment

The project is configured for Vercel via `vercel.json` (SPA rewrites + Vite framework). Once the GitHub repo is connected to a Vercel project:
- `main` branch → production URL
- `dev` branch → preview URL (auto-generated per push)

Not yet deployed at the time of writing.

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move |
| Space | Headbutt |
| J | Ability 1 |
| K | Ability 2 |
| R | Restart (after match ends) |

## Tech Stack

- TypeScript + Vite
- Three.js for 3D rendering
- No backend required for the prototype
- Vercel deployment configured (see `vercel.json`)

## Status

Phase 1: Local prototype with bots. See [BUILD_LOG.md](BUILD_LOG.md) for progress.
