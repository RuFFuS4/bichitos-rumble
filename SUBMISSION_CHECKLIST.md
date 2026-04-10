# Submission Checklist — Bichitos Rumble

## Required for Jam Submission
- [ ] Game runs in browser without install (pending — verify on public deploy)
- [x] No login or signup required
- [x] Free to play
- [ ] Fast startup (< 3 seconds to gameplay) (pending — verify on public deploy)
- [x] Game is brand new (created during jam)
- [x] 90%+ AI-generated code
- [ ] Deployed to public URL
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
- [ ] Vercel project connected to GitHub repo
- [ ] Production branch set to `main` in Vercel dashboard
- [ ] Preview deployments working on `dev` branch
- [ ] Custom domain configured (Hostinger)
- [ ] Final build tested on Vercel public URL
- [ ] Mobile responsiveness checked
