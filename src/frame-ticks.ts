// ---------------------------------------------------------------------------
// frame-ticks — per-frame gameplay subsystem ticks shared by both entries
// ---------------------------------------------------------------------------
//
// H3 slice 7. Extracted from src/main.ts's loop so /tools.html stops
// running a DIVERGED copy: the lab's old loop never ticked dust puffs,
// ability zones, offline-L mechanics, projectiles or status icons —
// abilities with zones/projectiles literally froze in the lab while
// working in production. There is exactly ONE list of these ticks now;
// if a new subsystem gets a tick, add it here and both the game and the
// lab pick it up. Since the fixed step's second cut (2026-09-25) it comes
// in two halves: tickSharedSimulation per sim step, tickSharedPresentation
// per rendered frame; tickSharedGameplay runs both for the per-frame paths.
//
// The poison-cloud screen overlay + critter fade logic stays in
// src/main.ts: it drives index.html-specific DOM vignette layers and
// is presentation, not simulation.
// ---------------------------------------------------------------------------

import type * as THREE from 'three';
import type { Game } from './game';
import type { Critter } from './critter';
import { updateDustPuffs } from './dust-puff';
import { tickAbilityZones, isInsideZoneOfKind, tickLOffline, snapshotZoneClocks, setZoneDrawAlpha } from './abilities-runtime';
import { tickProjectiles, snapshotProjectiles, presentProjectiles } from './projectiles';
import {
  setCritterStatus,
  updateAllStatusPositions,
  type CritterStatus,
} from './hud/status-icons';

const EMPTY_STATUS_SET: ReadonlySet<CritterStatus> = new Set();

/**
 * Recalculate the status-icon set for one critter. Moved verbatim from
 * src/main.ts (2026-04-30 final-polish). See status-icons.ts for the
 * rendering side. `isLocal`: the critter the viewer controls.
 */
export function computeCritterStatuses(c: Critter, isLocal: boolean): Set<CritterStatus> {
  const out = new Set<CritterStatus>();
  if (c.stunTimer > 0) {
    out.add('stunned');
    out.add('vulnerable');
  }
  if (c.slowTimer > 0) out.add('frozen');
  // 2026-04-30 final-L — Toxic Touch confused → poisoned icon.
  if (c.confusedTimer > 0) out.add('poisoned');
  if (c.config.name === 'Shelly' && c.selfTintTimer > 0) out.add('steel-shell');
  // The ghost tells the player her trick is on (tickSharedGameplay shows
  // no icon at all over someone else's invisible critter).
  if (isLocal && c.config.name === 'Kurama' && c.invisibilityTimer > 0) out.add('decoy-ghost');
  // Frenzy slot is ability index 2 in our kits.
  const frenzy = c.abilityStates[2];
  if (frenzy?.active && frenzy.windUpLeft <= 0) out.add('frenzy');
  // Zones — only someone else's: the owner is skipped by name, which is the
  // zones' ownerKey (so offline a Kurama who copied Frozen Floor isn't
  // frozen by her own ice, and Kowalski is by hers; online too, since
  // game.ts onZoneSpawned takes the kind from the zone's L flags).
  const owner = c.config.name;
  if (isInsideZoneOfKind(c.x, c.z, 'poison', owner)) out.add('poisoned');
  if (isInsideZoneOfKind(c.x, c.z, 'sand', owner)) out.add('slowed');
  // 2026-04-30 final-L — Frozen Floor: critters in 'ice' zone show frozen.
  if (isInsideZoneOfKind(c.x, c.z, 'ice', owner)) out.add('frozen');
  return out;
}

/**
 * The gameplay ticks that live OUTSIDE game.simulate, once per sim step
 * (the offline fixed step, the lab's fixed mode), in today's order. Pause
 * gating matches the original loop exactly: a paused offline match freezes
 * zones, L-mechanics and projectiles. Each of them reads the hit-stop
 * freeze once per step (createFrozenFrameGate): never call them per frame.
 */
export function tickSharedSimulation(dt: number, game: Game, scene: THREE.Scene): void {
  // Before the pause and frozen gates: a paused or frozen step leaves the
  // previous state equal to the current one, so balls and rings stand
  // still whatever the draw alpha.
  snapshotProjectiles();
  snapshotZoneClocks();
  if (game.isPaused()) return;
  // Ability zones (Kermit Poison Cloud, Sihans Quicksand, Kowalski
  // legacy Arctic Burst).
  tickAbilityZones(dt);
  // Per-tick L mechanics (Cone Pulse / Saw / Toxic Touch contact,
  // Sinkhole pull). Server runs the same logic in `simulatePlaying`;
  // this branch covers offline.
  tickLOffline(dt, game.getActiveCritters(), scene);
  // Kowalski Snowball projectile tick.
  tickProjectiles(dt, game.getActiveCritters());
}

/**
 * Once per rendered frame, after the camera and inside the pose window
 * (src/main.ts): dust puffs, snowballs and zone rings drawn between their
 * last two sim steps (`alpha`, the pose's), and status icons, which
 * follow the drawn pose. `dt`: real frame time for the dust (it keeps
 * going through a hit stop, as it always has; frozen behind the pause
 * menu).
 */
export function tickSharedPresentation(
  dt: number,
  alpha: number,
  game: Game,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): void {
  if (game.isPaused()) return;
  // Dust puff pool tick — no-op when empty.
  updateDustPuffs(dt);
  presentProjectiles(alpha);
  setZoneDrawAlpha(alpha);
  presentStatusIcons(game, camera, viewport);
}

/**
 * The per-frame paths (online, the lab's clock mode): both halves at once,
 * in the order they always ran — a puff spawned by this tick starts at
 * age 0.
 */
export function tickSharedGameplay(
  dt: number,
  game: Game,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): void {
  if (game.isPaused()) return;
  updateDustPuffs(dt);
  tickSharedSimulation(dt, game, scene);
  presentProjectiles(1);
  setZoneDrawAlpha(1);
  presentStatusIcons(game, camera, viewport);
}

/** Status icons — only while a match is actually in play (title / select /
 *  countdown / ended phases must not re-add icons; the phase-transition
 *  clearAllCritterStatus() calls keep the DOM clean). */
function presentStatusIcons(
  game: Game,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): void {
  if (game.isMatchPlaying()) {
    const critters = game.getActiveCritters();
    for (const c of critters) {
      const isLocal = c === game.player;
      // Nothing over someone else's invisible critter (Mirror Trick, a
      // burrow): any icon floating there would point at the one the trick
      // hides, while the decoy stands bare (2026-09-25).
      if (!c.alive || (!isLocal && c.invisibilityTimer > 0)) {
        setCritterStatus(c, EMPTY_STATUS_SET);
        continue;
      }
      setCritterStatus(c, computeCritterStatuses(c, isLocal));
    }
    updateAllStatusPositions(camera, viewport);
  }
}
