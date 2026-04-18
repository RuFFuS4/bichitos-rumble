# Next Steps — Bichitos Rumble

> **Deadline: May 1, 2026 @ 13:37 UTC**
> Single source of truth for what to work on next.
> Dispatch sessions: read this first.

## Status — Bloques A, B y C CERRADOS

### Validated in production
- [x] **Bloque A** — Multiplayer vertical slice (Colyseus, 2 players, deploy)
- [x] **Bloque B** — Online kit + arena fragment collapse + state-machine
      hardening (restart, input gating, clean transitions, macro variety,
      rotation-mirror fix). Full post-mortem of the visual/physics mirror
      bug in `ERROR_LOG.md`.

### Bloque C — Roster completo (9 playables)
- [x] 9 optimised GLBs in `public/models/critters/` (sergei, trunk, kurama,
      shelly, kermit, sihans, kowalski, cheeto, sebastian)
- [x] Per-kit ability overrides on server (impulse/radius/force/multipliers)
      so each critter feels different ONLINE, not just offline
- [x] 7 new `CRITTER_PRESETS` + `CRITTER_ABILITIES` entries client-side
- [x] 7 new `CRITTER_CONFIGS` + `CRITTER_ABILITY_KITS` entries server-side
- [x] roster.ts status flipped `wip` → `playable` for all 7
- [x] Verified in preview: all 9 selectable, Kermit test match runs clean
      (GLB loaded, 2 abilities active, bots spawning, no console errors)

### Temporary-but-real roster identity
Every critter gets distinct STATS + ABILITY TUNING, not unique ability TYPES.
All reuse base factories (charge_rush / ground_pound / frenzy):

| Critter   | Role         | Kit          | Stats                         |
|-----------|--------------|--------------|-------------------------------|
| Sergei    | Balanced     | CR + GP + F  | speed 10, mass 1.1, HB 15     |
| Trunk     | Bruiser      | CR + GP      | speed 7, mass 1.4, HB 17      |
| Kurama    | Trickster    | CR + GP + F  | speed 12, mass 0.8, HB 12     |
| Shelly    | Tank         | CR + GP + F  | speed 6.5, mass 1.5, HB 16    |
| Kermit    | Controller   | CR + GP      | speed 9, mass 1.0, HB 13      |
| Sihans    | Trapper      | CR + GP      | speed 8, mass 1.15, HB 14     |
| Kowalski  | Mage         | CR + GP      | speed 10, mass 0.9, HB 11     |
| Cheeto    | Assassin     | CR + GP      | speed 13, mass 0.7, HB 11     |
| Sebastian | Glass Cannon | CR + GP      | speed 10.5, mass 0.75, HB 18  |

Per-ability tuning (impulse/radius/force/cooldown/multipliers) differs per
critter — kept identical between client and server so feel matches online.

### Known cosmetic debt from Bloque C (NOT blocking)
- The 7 new GLBs inherit default transforms (scale 2.0, rotation π, pivotY 0.05).
  May need per-critter `__tune({rotation, scale, pivotY})` once seen rendered
  in real play. Addressable one-by-one with no code risk via roster.ts.
- No visual feedback yet for Frenzy (L). Characters that use it (Sergei,
  Kurama, Shelly) show HUD cooldown but no screen VFX.

## Next block — shared procedural animations

Now that the roster is complete, the next real ROI is **shared procedural
animations**. All 9 critters currently only have the bobbing + scale
feedback + knockback tilt baked into critter.ts. Missing:

- Idle pose (subtle head sway, breathing)
- Walking/running squash
- Pre-headbutt wind-up body lean (currently just position/scale)
- Landing impact anticipation
- Directional lean when turning

Plan: keep it **shared/procedural**. No per-critter rig. All 9 use the
same Animation class driven by speed magnitude, state flags, and dt.
Ships in one pass for the whole roster.

After that, in order:
1. **Sound / feedback essential** — hit impact sound per critter mass
   tier, ability fire sounds already half-wired, missing victory/defeat
   stinger variations.
2. **Real balance pass** — play test matches, tune stats that feel wrong.
3. **Character-specific ultimates** — only then, Bloque D: replace the
   temporary CR/GP/F reuse with unique per-critter final abilities.

## Blocked / explicitly deferred

| Item | Reason | Revisit? |
|------|--------|----------|
| Frenzy feedback (L visuals/audio) | Low ROI vs shared animations which buff ALL critters at once | Covered by next block |
| Waiting-for-opponent screen polish | Cosmetic | Post-jam or if time |
| More complex/irregular arena collapse | Stable/temporary version works — explicit post-jam item | Post-jam |
| Reconnection (`allowReconnection`) | Non-critical for 2-player 2-min matches | Only if stability complaints |
| Client-side prediction, rollback, matchmaking, login, ranking | All non-goals per CLAUDE.md | Post-jam |
| Skeletal animations, advanced cosmetics | Against style lock | Post-jam |
| Per-critter ultimate abilities | Temporary kit with base factories is sufficient for jam | After animations + sound |

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
