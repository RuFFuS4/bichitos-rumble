import { Critter } from './critter';

/** Simple bot AI: chase the nearest alive critter and headbutt when close. */
export function updateBot(bot: Critter, allCritters: Critter[], dt: number): void {
  if (!bot.alive) return;

  // Find nearest alive enemy
  let nearest: Critter | null = null;
  let nearestDist = Infinity;
  for (const other of allCritters) {
    if (other === bot || !other.alive) continue;
    const dx = other.x - bot.x;
    const dz = other.z - bot.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }

  if (!nearest) return;

  const dx = nearest.x - bot.x;
  const dz = nearest.z - bot.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > 0.01) {
    const nx = dx / dist;
    const nz = dz / dist;
    const accel = bot.config.speed * 0.7; // bots are slightly slower
    bot.vx += nx * accel * dt;
    bot.vz += nz * accel * dt;
  }

  // Headbutt when close
  if (nearestDist < 2.0) {
    bot.startHeadbutt();
  }
}
