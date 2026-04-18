// ---------------------------------------------------------------------------
// Server-side physics — replicated from client's src/physics.ts
// ---------------------------------------------------------------------------
//
// Same algorithm as the client but operates on PlayerSchema instances
// instead of Critter. No visual side-effects (no camera shake, no hit stop,
// no sounds) — those stay client-only and fire on state change.
// ---------------------------------------------------------------------------

import type { PlayerSchema } from '../state/PlayerSchema.js';
import { SIM, getCritterConfig } from './config.js';
import { getAbilityKit } from './abilities.js';

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
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive || a.falling) continue;
    const aCfg = getCritterConfig(a.critterName);
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.alive || b.falling) continue;
      const bCfg = getCritterConfig(b.critterName);

      const eitherImmune = a.immunityTimer > 0 || b.immunityTimer > 0;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = aCfg.radius + bCfg.radius;

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

        // Knockback force — headbutt multiplies. Use the attacker's config.
        let force = SIM.collision.normalPushForce;
        if (a.isHeadbutting) force = aCfg.headbuttForce * SIM.collision.headbuttMultiplier;
        else if (b.isHeadbutting) force = bCfg.headbuttForce * SIM.collision.headbuttMultiplier;

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

/**
 * Falloff check using the authoritative ArenaSim fragment layout.
 * A player falls if they're NOT on any alive fragment (including immune center).
 */
export function checkFalloff(
  players: PlayerSchema[],
  internal: Map<string, InternalLike>,
  isOnArena: (x: number, z: number) => boolean,
): void {
  for (const p of players) {
    if (!p.alive || p.falling || p.immunityTimer > 0) continue;
    if (!isOnArena(p.x, p.z)) {
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

/** Effective mass = base mass × active buff multipliers (per-kit overrides). */
export function effectiveMass(p: PlayerSchema): number {
  let m = getCritterConfig(p.critterName).mass;
  const kit = getAbilityKit(p.critterName);
  for (let i = 0; i < p.abilities.length; i++) {
    const a = p.abilities[i];
    const def = kit[i];
    if (!def || !a.active || a.windUpLeft > 0) continue;
    if (a.abilityType === 'charge_rush') {
      m *= def.massMultiplier ?? SIM.chargeRush.massMultiplier;
    } else if (a.abilityType === 'frenzy') {
      m *= def.frenzyMassMult ?? SIM.frenzy.massMultiplier;
    }
  }
  return m;
}

/** Effective speed = base speed × active buff multipliers (per-kit overrides). */
export function effectiveSpeed(p: PlayerSchema): number {
  let s = getCritterConfig(p.critterName).speed;
  const kit = getAbilityKit(p.critterName);
  for (let i = 0; i < p.abilities.length; i++) {
    const a = p.abilities[i];
    const def = kit[i];
    if (!def || !a.active || a.windUpLeft > 0) continue;
    if (a.abilityType === 'charge_rush') {
      s *= def.speedMultiplier ?? SIM.chargeRush.speedMultiplier;
    } else if (a.abilityType === 'frenzy') {
      s *= def.frenzySpeedMult ?? SIM.frenzy.speedMultiplier;
    }
  }
  return s;
}
