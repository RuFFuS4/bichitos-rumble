# Next Steps — Bichitos Rumble

> **Deadline: May 1, 2026 @ 13:37 UTC**
> Single source of truth for what to work on next.
> Dispatch sessions: read this first.

## Status (2026-04-17) — Bloque B CERRADO

### Validated in production
- [x] **Bloque A** — Multiplayer vertical slice (Colyseus, 2 players, deploy)
- [x] **Bloque B #1** — ground_pound (K) end-to-end online
- [x] **Bloque B #2** — Character select online + Trunk as 2nd playable
- [x] **Bloque B #3 (portal)** — Portal as individual forfeit
- [x] **Bloque B #3a+b** — Irregular fragment collapse (seed-deterministic)
- [x] **Title menu** — "vs Bots" vs "Online Multiplayer" explicit buttons
- [x] **Rotation fix** — fragment meshes no longer mirrored vs physics
- [x] **Online restart (R) wired** — end-screen R/tap now re-queues in online
- [x] **Input gating** — no parallel `connectOnlineWith`; `sendInput` only fires during server `'playing'` phase
- [x] **Clean transition** — idle critters + arena disposed BEFORE network await
- [x] **Collapse variety** — 2 macro patterns (A ≈55% outer→inner sweep, B ≈45% axis-split sideA/sideB)

## Next block — PROPOSAL: more playable characters

Goal: ship at least **4 real playable critters** for the jam. Currently only
Sergei and Trunk are confirmable. Content is directly visible to jam reviewers,
and the pipeline is mature enough that each new character is ~30-60 min work.

Order (adjust based on which GLBs are ready):
1. Audit GLB status in `public/models/critters/` — which of the 9 roster
   entries have optimised models already.
2. Pick the next 2 characters with the clearest stat/ability identity.
3. For each:
   - `src/critter.ts` — CRITTER_PRESETS entry (color, speed, mass, headbuttForce).
   - `src/abilities.ts` — CRITTER_ABILITIES entry, reusing `charge_rush` /
     `ground_pound` / `frenzy` factories with per-critter tuning.
   - `server/src/sim/config.ts` — CRITTER_CONFIGS entry matching the client.
   - `server/src/sim/abilities.ts` — CRITTER_ABILITY_KITS entry listing the
     ability tags this critter has.
   - `src/roster.ts` — mark status as `playable`.
4. Test: pick the new character in character select, confirm match works
   offline and online.

Each character added = **visible jam deliverable** + more distinct kit
combinations to play against.

## Blocked / explicitly deferred

| Item | Reason | Revisit? |
|------|--------|----------|
| Frenzy feedback (L visuals/audio) | Polish, low ROI vs a new character | Post-content, if time |
| Waiting-for-opponent screen polish | Cosmetic — current text overlay is functional | Post-jam or if time |
| More complex/irregular arena collapse | Current system works and is legible — explicit deferral, considered stable/temporary | Post-jam |
| Reconnection (`allowReconnection`) | Non-critical for a 2-player jam, match length ~2 min | Only if stability complaints |
| Client-side prediction, rollback, matchmaking, login, ranking | All non-goals per CLAUDE.md | Post-jam |
| Skeletal animations, advanced cosmetics | Against style lock | Post-jam |

## Accepted technical debt for the jam

- **Fragment generator duplicated** between `src/arena-fragments.ts` and
  `server/src/sim/arena-fragments.ts`. Kept byte-identical via
  `sed 's/CLIENT copy/SERVER copy/' src/arena-fragments.ts > server/...`
  on every edit. Deliberately no shared package (CLAUDE.md simplicity).
- **Arena collapse = 2 macro patterns only**. Visually varied enough for
  MVP. A more complex irregular destruction is a known post-jam target.
- **Colyseus v3 state callbacks via `getStateCallbacks()`** — quirky
  pattern but works; don't refactor.
- **Patch latency on fragment collapse** — 30Hz server tick means 1-2 render
  frames of drift at the exact collapse moment. 3s warning blink masks it.
- **`BrawlRoom.internal` Map** holds per-player non-synced data (inputs,
  timers). Required to avoid the Colyseus-v3 schema anti-pattern we hit
  in Bloque A. Keep.
- **Offline and online seed generation are independent** — no common
  abstraction. Fine for MVP.

## Diagnostic tools (kept for real bugs, zero runtime overhead if unused)

Open DevTools console on a live match:

- `__arena.checkPlayer()` — first probe after any "visible but fall" /
  "void but walk" suspicion. Prints local player's position and whether
  physics and render agree there.
- `__arena.check(x, z)` — same check at an arbitrary world point.
- `__arena.compass()` — toggle N/S/E/W world-axis markers. If Red (N)
  isn't at `+Z`, Blue (S) at `-Z`, Green (E) at `+X`, Yellow (W) at `-X`,
  the rotation mirror has regressed.
- `__arena.dump()` — list fragments per band with alive + visible flags.
  Any `MISMATCH(alive=X visible=Y)` = sync bug.
- `__arena.logCollapses()` — toggle per-batch collapse/warning log.

Full bug post-mortem for the rotation bug: `ERROR_LOG.md` entry
"[2026-04-17] Arena fragment render MIRRORED vs physics".

## Key architecture notes (for dispatch sessions)

- Work on `dev`, merge to `main` for deploy. Vercel (client) and Railway
  (server) both auto-deploy from `main`.
- Server in `server/`, Colyseus 0.16, schema v3, multi-stage Dockerfile.
- Arena fragments generator MUST stay byte-identical client ↔ server.
- NEVER put non-synced fields on Schema classes — use `BrawlRoom.internal`.
- Match-end on server: always go through `BrawlRoom.endMatch()` (it locks
  the room so clients can cleanly re-queue into fresh matches).
- Offline mode must not regress with any online change.
