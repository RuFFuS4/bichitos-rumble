# Next Steps — Bichitos Rumble

> **Deadline: May 1, 2026 @ 13:37 UTC**
> This file is the single source of truth for what to work on next.
> Updated after every significant step. Dispatch sessions: read this first.

## Current status (2026-04-17)

### Completed
- [x] **Bloque A** — Multiplayer vertical slice (Colyseus, 2 players, Sergei, deploy)
- [x] **Bloque B #1** — ground_pound (K) end-to-end online
- [x] **Bloque B #2** — Character select online + Trunk as 2nd playable
- [x] **Bloque B #3 (portal)** — Portal as individual forfeit (server-authoritative)
- [x] **Bloque B #3a** — Arena collapse sync (server-authoritative rings)
- [x] **Bloque B #3b** — Irregular fragment collapse (seed-deterministic sectors)

### Next up (priority order)

1. **Validate 3b in production** — Open 2 tabs on bichitosrumble.com, play online,
   verify fragments collapse identically on both clients. Check: immune center stays,
   outer fragments go first, warning blink visible, falloff works on collapsed areas.

2. **Frenzy feedback** (if cheap) — L key ability. Server already buffs speed/mass.
   Client needs visual: emissive glow + camera pulse + sound. Skip if >2h.

3. **Reconnection** (if cheap) — Colyseus `allowReconnection(client, seconds)`.
   Client auto-reconnects on disconnect. Skip if >3h.

4. **Polish pass** — Fragment visual gaps between bands (thin void strips for readability),
   camera framing adjusts to currentRadius as arena shrinks, end-game endReason
   precision (portal_exit vs disconnect vs eliminated vs timeout).

5. **More playable characters** — 9 roster characters have GLB files in Downloads.
   Pipeline: optimize-models.mjs → public/models/critters/ → CRITTER_PRESETS entry +
   abilities + server config. Priority: characters with distinct mass/speed from
   Sergei and Trunk.

6. **Submission prep** — Google Form (user task), Lighthouse measurement on prod URL,
   SUBMISSION_CHECKLIST review.

### Skipped / deferred (with reason)

| Item | Reason | Revisit? |
|------|--------|----------|
| Client-side prediction | Complexity too high for jam scope | Post-jam |
| Matchmaking / ranking / login | Non-goal per CLAUDE.md | Post-jam |
| Rollback netcode | Colyseus doesn't support it natively | Post-jam |
| Full 9-character kits | Time — focus on 2-3 playable | If time |
| HUD mobile restructure | Functional enough for jam | Post-jam |
| Skeletal animations | Against style lock (procedural only) | Post-jam |
| Advanced cosmetics | Non-goal for early phase | Post-jam |
| Warp animation on portal | Pure polish, low priority | If time |
| Stats display in end screen | Nice-to-have only | If time |

### Key architecture notes for dispatch sessions

- **Branch**: work on `dev`, merge to `main` for deploy. Both Vercel (client) and
  Railway (server) auto-deploy from `main`.
- **Server path**: `server/` — Colyseus 0.16, schema v3, multi-stage Dockerfile for Railway.
- **Arena fragments**: `src/arena-fragments.ts` and `server/src/sim/arena-fragments.ts`
  must be kept **identical** (shared deterministic generator, duplicated because no
  shared package in the monorepo).
- **Colyseus schema anti-pattern**: NEVER put non-synced fields on Schema classes.
  Use `BrawlRoom.internal` Map for server-only per-player data.
- **Offline mode must not regress**: all online features must leave the offline
  bot-match path working.
