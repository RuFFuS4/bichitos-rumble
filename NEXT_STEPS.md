# Next Steps — Bichitos Rumble

> **Deadline: May 1, 2026 @ 13:37 UTC**
> This file is the single source of truth for what to work on next.
> Updated after every significant step. Dispatch sessions: read this first.

## Current status (2026-04-17)

### Completed
- [x] **Bloque A** — Multiplayer vertical slice (Colyseus, 2 players, deploy)
- [x] **Bloque B #1** — ground_pound (K) end-to-end online
- [x] **Bloque B #2** — Character select online + Trunk as 2nd playable
- [x] **Bloque B #3 (portal)** — Portal as individual forfeit
- [x] **Bloque B #3a** — Arena collapse sync (server-authoritative rings, now superseded)
- [x] **Bloque B #3b** — Irregular fragment collapse (seed-deterministic sectors)
- [x] **Title menu redesign** — "vs Bots" vs "Online Multiplayer" explicit buttons
- [x] **3b hardening (remote-test feedback)**:
  - Online restart actually reconnects (server room lock + client await-leave)
  - Clean transitions to title (arena.reset + idle critter rebuild)
  - Per-band distinct colors (no more visual merge when middle band collapses)
  - Collapse variety: 4-6 batches per match, randomised sector counts,
    adaptive timing (total ≈96s across all seed variations)

### NOT yet validated in production (next priority)
- [ ] Two-browser remote test on bichitosrumble.com with the most recent
      commit to confirm:
      - Restart online reconnects cleanly into a fresh match (no Disconnected flash)
      - No flicker on transitions (title ↔ match in either direction)
      - Visible fragment == walkable fragment (both directions) — **critical
        rotation bug fixed in c4ad1c4**, needs re-test
      - Collapse pattern feels different across 3+ consecutive matches

### Critical bug fixed in c4ad1c4
Fragment meshes used rotation.x = -π/2 which mirrors shape-Y onto world-Z.
Physics `pointInFragment` uses atan2(z, x) without mirror → visual and
physics diverged on opposite halves of the arena. Symptoms (matching user
remote test): "visible fragment not walkable" + "invisible terrain walkable",
both happening at mirrored angles. Fix: rotate by +π/2 (no mirror). Also
removed the compensating position.y = -h since +π/2 extrudes downward
naturally.

### Blocked on production validation (DO NOT start before passing above)
- [ ] Frenzy feedback (L) — visual+audio for Sergei's ultimate
- [ ] More playable characters (GLB models ready, need config + ability kits)
- [ ] Reconnection support (Colyseus `allowReconnection`)

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
| More complex irregular terrain | Explicit deferral — current fragment system considered "temporary but safe" | After MVP validation |

## Technical debt snapshot (after 3b hardening)

### Clean to leave as is
- Fragment generator duplicated between client and server: this is the
  explicit "simple modularity" pattern (CLAUDE.md favours no shared package
  for MVP). Kept in sync by copy-on-edit.
- Colyseus v3 state callback pattern via `getStateCallbacks()`: quirky
  but established and working; don't refactor.
- `BrawlRoom.internal` Map for non-synced per-player data: this is the
  anti-pattern fix from Bloque A; keep.

### Worth cleaning NOW (quick, quirky to touch later)
- None right now. After the 3b rewrite, the arena module is clean.

### Known debt to accept for the jam
- **Patch latency on fragment collapse**: the server broadcasts alive/dead
  transitions at tick rate (30Hz). On a collapse boundary, a client may
  render a piece for 1-2 frames AFTER the server marks it dead. Not worth
  fixing — warning blink gives 3s notice, and the practical impact is a
  visual glitch not a game-feel issue.
- **Batch structure fixed to outer→inner**: we could vary the direction
  (e.g. sometimes inner-first) but it breaks the "encroaching destruction"
  game-design fantasy. Intentionally out of scope.
- **Offline and online generate seeds separately**: no common abstraction.
  Fine for the jam; post-MVP we could extract a shared seeded engine.

### .md files to update later (not urgent)
- `MEMORY.md` — already updated in prev commit, will need another pass
  post-jam to prune "Future:" sections that are now implemented.
- `BUILD_LOG.md` — chronological, no action needed.
- `SUBMISSION_CHECKLIST.md` — review close to deadline (Lighthouse, Google
  form, deployment URL confirmation).
- `CHARACTER_DESIGN.md` / `GAME_DESIGN.md` — will need content pass when
  more characters ship (not now).

## Key architecture notes for dispatch sessions

- **Branch**: work on `dev`, merge to `main` for deploy. Both Vercel (client)
  and Railway (server) auto-deploy from `main`.
- **Server path**: `server/` — Colyseus 0.16, schema v3, multi-stage
  Dockerfile for Railway.
- **Arena fragments**: `src/arena-fragments.ts` and
  `server/src/sim/arena-fragments.ts` MUST be kept **byte-identical**
  (`sed 's/CLIENT copy/SERVER copy/' src/arena-fragments.ts > server/...`).
- **Colyseus schema anti-pattern**: NEVER put non-synced fields on Schema
  classes. Use `BrawlRoom.internal` Map for server-only per-player data.
- **Match-end on server**: always go through `BrawlRoom.endMatch()` — it
  sets phase + reason + winner AND locks the room so restart works.
- **Offline mode must not regress**: all online features must leave the
  offline bot-match path working.
