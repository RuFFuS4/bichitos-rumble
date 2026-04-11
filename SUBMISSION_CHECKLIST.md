# Submission Checklist — Bichitos Rumble

## Required for Jam Submission
- [x] Game runs in browser without install
- [x] No login or signup required
- [x] Free to play
- [ ] Fast startup (< 3 seconds to gameplay) — to measure on public URL
- [x] Game is brand new (created during jam)
- [x] 90%+ AI-generated code
- [x] Deployed to public URL → https://www.bichitosrumble.com
- [x] README explains the game
- [x] Source code on GitHub
- [x] Jam widget included (`<script async src="https://jam.pieter.com/2026/widget.js">`)

## Gameplay Minimum
- [x] Playable character with movement
- [x] At least 1 attack (headbutt)
- [x] Opponents to fight
- [x] Win/lose condition
- [x] Restart flow
- [x] Character selection (4 critters)
- [x] Special abilities (2 per critter, J and K keys)
- [x] Lives system (3 lives, respawn with immunity)
- [x] All-critter lives HUD
- [x] Title screen
- [x] End screen with per-result messaging

## Polish Targets
- [x] Sound effects (6 synthesized via Web Audio API)
- [x] Sound toggle button (top-right) with localStorage persistence
- [x] Screen shake on headbutt and ground pound
- [x] Hit flash on impact
- [x] Arena ring warning blink (1.5s) before collapse
- [x] Immunity blink on respawn
- [ ] Particle effects (beyond shockwave rings)
- [x] Title screen
- [x] Victory/defeat screen
- [x] 3D rotatable preview in character select

## Deployment
- [x] `vercel.json` with SPA rewrites config (in repo root)
- [x] `vite.config.ts` with `base: './'` (relative asset paths)
- [x] Build verified locally (`npx vite build` → 125 KB gzip)
- [x] Vercel project created (`ruffus4s-projects/bichitos-rumble`)
- [x] Production deploy live (`npx vercel deploy --prod`)
- [x] Custom domain `www.bichitosrumble.com` aliased to production
- [x] SPA rewrite verified (`/test`, `/random-route` → 200, serve game)
- [x] Final build tested on Vercel public URL
- [x] GitHub ↔ Vercel auto-deploy on push (dev → preview, main → production)
- [x] Production branch set to `main` in Vercel dashboard
- [x] Preview deployments working on `dev` branch
- [x] Mobile support (virtual joystick, action buttons, landscape lock, tap menus)
- [ ] Full cross-device playtest report
