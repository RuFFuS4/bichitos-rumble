# Submission Checklist — Bichitos Rumble

## Jam Info
- **Deadline**: May 1, 2026 @ 13:37 UTC
- **Submission form**: https://forms.gle/bGG4e3uD9PUUJKUc7
- **Official site**: https://vibej.am/2026/
- **Portal (optional)**: https://vibej.am/portal/2026

## Required for Jam Submission
- [x] Game runs in browser without install
- [x] No login or signup required
- [x] Free to play
- [ ] Fast startup (< 3 seconds to gameplay) — measure on public URL with Lighthouse
- [x] Game is brand new (created after April 1, 2026)
- [x] 90%+ AI-generated code
- [x] Deployed to public URL → https://www.bichitosrumble.com
- [x] README explains the game
- [x] Source code on GitHub
- [x] Jam widget included (`<script async src="https://vibej.am/2026/widget.js">`)

## Gameplay Minimum
- [x] Playable character with movement
- [x] At least 1 attack (headbutt)
- [x] Opponents to fight
- [x] Win/lose condition
- [x] Restart flow
- [x] Character selection (9-slot roster, 1+ playable)
- [x] Special abilities (up to 3 per critter: J, K, L)
- [x] Lives system (3 lives, respawn with immunity)
- [x] All-critter lives HUD
- [x] Title screen
- [x] End screen with per-result messaging

## Polish Targets
- [x] Sound effects (6 synthesized via Web Audio API)
- [x] SFX + music toggle buttons with localStorage persistence
- [x] Screen shake on headbutt and ground pound
- [x] Hit flash on impact
- [x] Arena ring warning blink before collapse
- [x] Immunity blink on respawn
- [ ] Particle effects (beyond shockwave rings)
- [x] Title screen
- [x] Victory/defeat screen
- [x] 3D rotatable preview in character select
- [x] 3D GLB models for real roster characters

## Deployment
- [x] `vercel.json` with SPA rewrites config
- [x] `vite.config.ts` with `base: './'` (relative asset paths)
- [x] Build verified locally (`npm run build` → 624 KB JS, 163 KB gzip)
- [x] Vercel project connected (auto-deploy from GitHub)
- [x] Custom domain `www.bichitosrumble.com` aliased to production
- [x] GitHub ↔ Vercel auto-deploy (dev → preview, main → production)
- [x] Mobile support (virtual joystick, 4 action buttons, landscape lock)
- [ ] Merge dev → main with current features
- [ ] Verify production after merge
- [ ] Portal integration (optional)
- [ ] Submit via Google Form
- [ ] Full cross-device playtest
