import { Critter } from './critter';
import { activateAbility, canActivateAbility } from './abilities';
import { FEEL } from './gamefeel';

/** Simple bot AI: chase the nearest alive critter, headbutt when close, use abilities. */
export function updateBot(bot: Critter, allCritters: Critter[], dt: number): void {
  if (!bot.alive) return;

  // Find nearest alive enemy
  let nearest: Critter | null = null;
  let nearestDist = Infinity;
  let nearbyCount = 0;
  for (const other of allCritters) {
    if (other === bot || !other.alive) continue;
    const dx = other.x - bot.x;
    const dz = other.z - bot.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
    if (dist < 4.0) nearbyCount++;
  }

  if (!nearest) {
    bot.hasInput = false;
    return;
  }

  bot.hasInput = true;
  const dx = nearest.x - bot.x;
  const dz = nearest.z - bot.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > 0.01) {
    let nx = dx / dist;
    let nz = dz / dist;

    // Reduce steering during Charge Rush (same commitment as player)
    const chargeState = bot.abilityStates[0];
    if (chargeState?.active && chargeState.def.type === 'charge_rush' && chargeState.windUpLeft <= 0) {
      nx *= FEEL.chargeRush.steerFactor;
      nz *= FEEL.chargeRush.steerFactor;
    }

    const accel = bot.effectiveSpeed * FEEL.movement.accelerationScale * 0.55;
    bot.vx += nx * accel * dt;
    bot.vz += nz * accel * dt;
  }

  // Headbutt when close
  if (nearestDist < 2.0) {
    bot.startHeadbutt();
  }

  // Ability 1: use when enemy is at mid-range (dash/charge type)
  const ab0 = bot.abilityStates[0];
  if (ab0 && canActivateAbility(ab0) && nearestDist > 3.0 && nearestDist < 6.0) {
    if (Math.random() < 0.02) { // ~40% chance per second at 60fps
      activateAbility(ab0, bot);
    }
  }

  // Ability 2: use when surrounded (AoE type)
  const ab1 = bot.abilityStates[1];
  if (ab1 && canActivateAbility(ab1) && nearbyCount >= 2) {
    if (Math.random() < 0.015) {
      activateAbility(ab1, bot);
    }
  }
}
