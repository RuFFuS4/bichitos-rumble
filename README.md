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

Current state:
- Production URL: `https://www.bichitosrumble.com` (custom domain, public)
- Vercel project: `ruffus4s-projects/bichitos-rumble`
- Manual deploys: `npx vercel deploy --prod` from project root

To enable automatic push-triggered deploys (`main` → prod, `dev` → preview),
connect the GitHub repo from the Vercel dashboard:
Project → Settings → Git → Connect Git Repository.

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
