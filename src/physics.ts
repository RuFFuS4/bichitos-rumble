import { Critter } from './critter';
import { Arena } from './arena';

const PUSH_FORCE = 6;
const HEADBUTT_MULTIPLIER = 2.5;
const FALL_SPEED = 12;

/** Check and resolve collisions between all critters. */
export function resolveCollisions(critters: Critter[]): void {
  for (let i = 0; i < critters.length; i++) {
    const a = critters[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < critters.length; j++) {
      const b = critters[j];
      if (!b.alive) continue;

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

        // Knockback force
        let force = PUSH_FORCE;
        if (a.isHeadbutting) force = a.config.headbuttForce * HEADBUTT_MULTIPLIER;
        else if (b.isHeadbutting) force = b.config.headbuttForce * HEADBUTT_MULTIPLIER;

        const massRatioA = b.config.mass / (a.config.mass + b.config.mass);
        const massRatioB = a.config.mass / (a.config.mass + b.config.mass);

        if (a.isHeadbutting) {
          // A headbutts B: B gets heavy knockback, A gets minor recoil
          b.vx += nx * force * massRatioB;
          b.vz += nz * force * massRatioB;
          a.vx -= nx * force * 0.2;
          a.vz -= nz * force * 0.2;
        } else if (b.isHeadbutting) {
          // B headbutts A: A gets heavy knockback
          a.vx -= nx * force * massRatioA;
          a.vz -= nz * force * massRatioA;
          b.vx += nx * force * 0.2;
          b.vz += nz * force * 0.2;
        } else {
          // Normal collision push
          a.vx -= nx * force * massRatioA;
          a.vz -= nz * force * massRatioA;
          b.vx += nx * force * massRatioB;
          b.vz += nz * force * massRatioB;
        }
      }
    }
  }
}

/** Check if critters have fallen off the arena. */
export function checkFalloff(critters: Critter[], arena: Arena, dt: number): void {
  for (const c of critters) {
    if (!c.alive) continue;
    if (!arena.isOnArena(c.x, c.z)) {
      // Fall animation
      c.mesh.position.y -= FALL_SPEED * dt;
      if (c.mesh.position.y < -10) {
        c.eliminate();
      }
    }
  }
}
