// ---------------------------------------------------------------------------
// Server-side physics — replicated from client's src/physics.ts
// ---------------------------------------------------------------------------
//
// Same algorithm as the client but operates on PlayerSchema instances
// instead of Critter. No visual side-effects (no camera shake, no hit stop,
// no sounds) — those stay client-only and fire on state change.
// ---------------------------------------------------------------------------

import type { PlayerSchema } from '../state/PlayerSchema.js';
import { SIM, SERGEI_CONFIG } from './config.js';

/**
 * Minimal shape for the per-player internal data used here.
 * Kept separate from PlayerSchema (anti-pattern to mix sync + non-sync).
 */
interface InternalLike {
  respawnTimer: number;
}

/**
 * Resolve pairwise collisions between all alive/non-falling players.
 * Applies knockback based on who is headbutting and mass ratios.
 */
export function resolveCollisions(players: PlayerSchema[]): void {
  const radius = SERGEI_CONFIG.radius;
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive || a.falling) continue;
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.alive || b.falling) continue;

      const eitherImmune = a.immunityTimer > 0 || b.immunityTimer > 0;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = radius + radius;

      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist;
        const nz = dz / dist;

        // Separate overlapping players
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;

        if (eitherImmune) continue;

        const massA = effectiveMass(a);
        const massB = effectiveMass(b);

        // Knockback force — headbutt multiplies
        let force = SIM.collision.normalPushForce;
        if (a.isHeadbutting) force = SERGEI_CONFIG.headbuttForce * SIM.collision.headbuttMultiplier;
        else if (b.isHeadbutting) force = SERGEI_CONFIG.headbuttForce * SIM.collision.headbuttMultiplier;

        const ratioA = massB / (massA + massB);
        const ratioB = massA / (massA + massB);

        if (a.isHeadbutting) {
          b.vx += nx * force * ratioB;
          b.vz += nz * force * ratioB;
          a.vx -= nx * force * SIM.headbutt.recoilFactor;
          a.vz -= nz * force * SIM.headbutt.recoilFactor;
        } else if (b.isHeadbutting) {
          a.vx -= nx * force * ratioA;
          a.vz -= nz * force * ratioA;
          b.vx += nx * force * SIM.headbutt.recoilFactor;
          b.vz += nz * force * SIM.headbutt.recoilFactor;
        } else {
          a.vx -= nx * force * ratioA;
          a.vz -= nz * force * ratioA;
          b.vx += nx * force * ratioB;
          b.vz += nz * force * ratioB;
        }
      }
    }
  }
}

/** Check if a player is off the arena and transition to falling state. */
export function checkFalloff(players: PlayerSchema[], internal: Map<string, InternalLike>): void {
  const R = SIM.arena.radius;
  for (const p of players) {
    if (!p.alive || p.falling || p.immunityTimer > 0) continue;
    if (Math.sqrt(p.x * p.x + p.z * p.z) > R) {
      p.falling = true;
      p.lives -= 1;
      const data = internal.get(p.sessionId);
      if (data) data.respawnTimer = SIM.lives.respawnDelay;
    }
  }
}

/**
 * Advance falling animation + respawn countdown. Returns sessionIds of
 * players that should be respawned this tick (caller picks position).
 */
export function updateFalling(
  players: PlayerSchema[],
  internal: Map<string, InternalLike>,
  dt: number,
): string[] {
  const toRespawn: string[] = [];
  for (const p of players) {
    if (!p.falling) continue;
    p.fallY -= SIM.lives.fallSpeed * dt;
    const data = internal.get(p.sessionId);
    if (!data) continue;
    data.respawnTimer -= dt;
    if (data.respawnTimer <= 0) {
      if (p.lives > 0) {
        toRespawn.push(p.sessionId);
      } else {
        p.alive = false;
        p.falling = false;
      }
    }
  }
  return toRespawn;
}

/** Effective mass = base mass × active buff multipliers. */
export function effectiveMass(p: PlayerSchema): number {
  let m = SERGEI_CONFIG.mass;
  for (const a of p.abilities) {
    if (a.active && a.windUpLeft <= 0) {
      if (a.abilityType === 'charge_rush') m *= SIM.chargeRush.massMultiplier;
      if (a.abilityType === 'frenzy') m *= SIM.frenzy.massMultiplier;
    }
  }
  return m;
}

/** Effective speed = base speed × active buff multipliers. */
export function effectiveSpeed(p: PlayerSchema): number {
  let s = SERGEI_CONFIG.speed;
  for (const a of p.abilities) {
    if (a.active && a.windUpLeft <= 0) {
      if (a.abilityType === 'charge_rush') s *= SIM.chargeRush.speedMultiplier;
      if (a.abilityType === 'frenzy') s *= SIM.frenzy.speedMultiplier;
    }
  }
  return s;
}
