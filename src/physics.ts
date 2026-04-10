import { Critter } from './critter';
import { Arena } from './arena';
import { triggerHitStop, applyImpactFeedback, FEEL } from './gamefeel';

/** Check and resolve collisions between all critters. */
export function resolveCollisions(critters: Critter[]): void {
  for (let i = 0; i < critters.length; i++) {
    const a = critters[i];
    if (!a.alive || a.falling) continue;
    for (let j = i + 1; j < critters.length; j++) {
      const b = critters[j];
      if (!b.alive || b.falling) continue;

      // Skip knockback if either critter is immune (still separate overlap though)
      const eitherImmune = a.isImmune || b.isImmune;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = a.radius + b.radius;

      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist;
        const nz = dz / dist;

        // Separate overlapping critters
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;

        // No knockback during immunity — only separation
        if (eitherImmune) continue;

        // Knockback force — reads from centralized FEEL config
        let force = FEEL.collision.normalPushForce;
        if (a.isHeadbutting) force = a.config.headbuttForce * FEEL.collision.headbuttMultiplier;
        else if (b.isHeadbutting) force = b.config.headbuttForce * FEEL.collision.headbuttMultiplier;

        const massRatioA = b.effectiveMass / (a.effectiveMass + b.effectiveMass);
        const massRatioB = a.effectiveMass / (a.effectiveMass + b.effectiveMass);

        if (a.isHeadbutting) {
          b.vx += nx * force * massRatioB;
          b.vz += nz * force * massRatioB;
          a.vx -= nx * force * FEEL.headbutt.recoilFactor;
          a.vz -= nz * force * FEEL.headbutt.recoilFactor;
          triggerHitStop(FEEL.hitStop.headbutt);
          applyImpactFeedback(b);
        } else if (b.isHeadbutting) {
          a.vx -= nx * force * massRatioA;
          a.vz -= nz * force * massRatioA;
          b.vx += nx * force * FEEL.headbutt.recoilFactor;
          b.vz += nz * force * FEEL.headbutt.recoilFactor;
          triggerHitStop(FEEL.hitStop.headbutt);
          applyImpactFeedback(a);
        } else {
          // Normal collision — gentle nudge
          a.vx -= nx * force * massRatioA;
          a.vz -= nz * force * massRatioA;
          b.vx += nx * force * massRatioB;
          b.vz += nz * force * massRatioB;
        }
      }
    }
  }
}

/** Check if critters have fallen off the arena. Starts falling state. */
export function checkFalloff(critters: Critter[], arena: Arena): void {
  for (const c of critters) {
    if (!c.alive || c.falling || c.isImmune) continue;
    if (!arena.isOnArena(c.x, c.z)) {
      c.startFalling();
    }
  }
}

/** Update falling critters — returns list of critters ready to respawn. */
export function updateFalling(critters: Critter[], dt: number): Critter[] {
  const readyToRespawn: Critter[] = [];
  for (const c of critters) {
    if (c.updateFalling(dt)) {
      readyToRespawn.push(c);
    }
  }
  return readyToRespawn;
}
