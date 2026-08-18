// ---------------------------------------------------------------------------
// frame-ticks — per-frame gameplay subsystem ticks shared by both entries
// ---------------------------------------------------------------------------
//
// H3 slice 7. Extracted from src/main.ts's loop so /tools.html stops
// running a DIVERGED copy: the lab's old loop never ticked dust puffs,
// ability zones, offline-L mechanics, projectiles or status icons —
// abilities with zones/projectiles literally froze in the lab while
// working in production. There is exactly ONE list of per-frame
// gameplay ticks now; if a new subsystem gets a tick, add it here and
// both the game and the lab pick it up.
//
// The poison-cloud screen overlay + critter fade logic stays in
// src/main.ts: it drives index.html-specific DOM vignette layers and
// is presentation, not simulation.
// ---------------------------------------------------------------------------

import type * as THREE from 'three';
import type { Game } from './game';
import type { Critter } from './critter';
import { updateDustPuffs } from './dust-puff';
import { tickAbilityZones, isInsideZoneOfKind, tickLOffline } from './abilities';
import { tickProjectiles } from './projectiles';
import {
  setCritterStatus,
  updateAllStatusPositions,
  type CritterStatus,
} from './hud/status-icons';

const EMPTY_STATUS_SET: ReadonlySet<CritterStatus> = new Set();

/**
 * Recalculate the status-icon set for one critter. Moved verbatim from
 * src/main.ts (2026-04-30 final-polish). See status-icons.ts for the
 * rendering side.
 */
export function computeCritterStatuses(c: Critter): Set<CritterStatus> {
  const out = new Set<CritterStatus>();
  if (c.stunTimer > 0) {
    out.add('stunned');
    out.add('vulnerable');
  }
  if (c.slowTimer > 0) out.add('frozen');
  // 2026-04-30 final-L — Toxic Touch confused → poisoned icon.
  if (c.confusedTimer > 0) out.add('poisoned');
  if (c.config.name === 'Shelly' && c.selfTintTimer > 0) out.add('steel-shell');
  if (c.config.name === 'Kurama' && c.invisibilityTimer > 0) out.add('decoy-ghost');
  // Frenzy slot is ability index 2 in our kits.
  const frenzy = c.abilityStates[2];
  if (frenzy?.active && frenzy.windUpLeft <= 0) out.add('frenzy');
  // Zones — only count enemy zones (caster is exempt by name).
  if (c.config.name !== 'Kermit' && isInsideZoneOfKind(c.x, c.z, 'poison')) out.add('poisoned');
  if (c.config.name !== 'Sihans' && isInsideZoneOfKind(c.x, c.z, 'sand')) out.add('slowed');
  // 2026-04-30 final-L — Frozen Floor: critters in 'ice' zone show frozen.
  if (c.config.name !== 'Kowalski' && isInsideZoneOfKind(c.x, c.z, 'ice')) out.add('frozen');
  return out;
}

/**
 * The per-frame gameplay ticks that live OUTSIDE game.update but must
 * run every frame a match is on screen. Pause gating matches the
 * original loop exactly: a paused offline match freezes puffs, zones,
 * L-mechanics and projectiles so nothing keeps animating behind the
 * pause menu.
 */
export function tickSharedGameplay(
  dt: number,
  game: Game,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  viewport: { width: number; height: number },
): void {
  if (game.isPaused()) return;

  // Dust puff pool tick — no-op when empty.
  updateDustPuffs(dt);
  // Ability zones (Kermit Poison Cloud, Sihans Quicksand, Kowalski
  // legacy Arctic Burst).
  tickAbilityZones(dt);
  // Per-tick L mechanics (Cone Pulse / Saw / Toxic Touch contact,
  // Sinkhole pull). Server runs the same logic in `simulatePlaying`;
  // this branch covers offline.
  tickLOffline(dt, game.getActiveCritters(), scene);
  // Kowalski Snowball projectile tick.
  tickProjectiles(dt, game.getActiveCritters());

  // Status icons — only while a match is actually in play (title /
  // select / countdown / ended phases must not re-add icons; the
  // phase-transition clearAllCritterStatus() calls keep the DOM clean).
  if (game.isMatchPlaying()) {
    const critters = game.getActiveCritters();
    for (const c of critters) {
      if (!c.alive) {
        setCritterStatus(c, EMPTY_STATUS_SET);
        continue;
      }
      setCritterStatus(c, computeCritterStatuses(c));
    }
    updateAllStatusPositions(camera, viewport);
  }
}
