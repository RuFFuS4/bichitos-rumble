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
- [ ] Character selection (4 critters)
- [x] Special abilities (2 per critter, J and K keys)
- [x] Lives system (3 lives, respawn with immunity)
- [x] All-critter lives HUD

## Polish Targets
- [ ] Sound effects
- [ ] Screen shake on hit
- [ ] Particle effects
- [ ] Title screen
- [ ] Victory/defeat screen with stats

## Deployment
- [x] `vercel.json` with SPA rewrites config (in repo root)
- [x] `vite.config.ts` with `base: './'` (relative asset paths)
- [x] Build verified locally (`npx vite build` → 125 KB gzip)
- [x] Vercel project created (`ruffus4s-projects/bichitos-rumble`)
- [x] Production deploy live (`npx vercel deploy --prod`)
- [x] Custom domain `www.bichitosrumble.com` aliased to production
- [x] SPA rewrite verified (`/test`, `/random-route` → 200, serve game)
- [x] Final build tested on Vercel public URL
- [ ] GitHub ↔ Vercel auto-deploy on push (manual dashboard step pending)
- [ ] Production branch set to `main` in Vercel dashboard (auto-deploy step)
- [ ] Preview deployments working on `dev` branch (auto-deploy step)
- [ ] Mobile responsiveness checked
