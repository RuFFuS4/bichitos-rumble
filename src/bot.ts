import { Critter } from './critter';
import { activateAbility, canActivateAbility, findAbilityByTag } from './abilities';
import { FEEL } from './gamefeel';

/**
 * Placeholder bot AI: chase the nearest alive critter, headbutt when close,
 * and use abilities based on their SEMANTIC TAGS (not on their slot index).
 *
 * The bot is intentionally dumb. Its only job is to not crash with new
 * ability types and to use abilities in roughly sensible contexts. Any
 * real intelligence is out of scope — the bot is itself a placeholder
 * and will likely be rewritten once the final roster is in.
 *
 * Decisions:
 *   - A 'mobility' ability gets used to close mid-range gaps (dist 3..6)
 *   - An 'aoe_push' ability gets used when surrounded (>= 2 enemies nearby)
 *
 * If an ability has neither of those tags, the bot simply doesn't touch
 * it — the player will, and we don't care about bot optimality with
 * unknown abilities right now.
 */
export function updateBot(bot: Critter, allCritters: Critter[], dt: number): void {
  if (!bot.alive) return;

  // Find nearest alive enemy + count enemies within 4 units
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

  // --- Movement: chase the target, with the same steering reduction as
  // the player has during a mobility-tagged ability's active window.
  if (dist > 0.01) {
    let nx = dx / dist;
    let nz = dz / dist;

    const mobility = findAbilityByTag(bot.abilityStates, 'mobility');
    if (mobility?.active && mobility.windUpLeft <= 0) {
      nx *= FEEL.chargeRush.steerFactor;
      nz *= FEEL.chargeRush.steerFactor;
    }

    const accel = bot.effectiveSpeed * FEEL.movement.accelerationScale * 0.55;
    bot.vx += nx * accel * dt;
    bot.vz += nz * accel * dt;
  }

  // --- Basic headbutt when close
  if (nearestDist < 2.0) {
    bot.startHeadbutt();
  }

  // --- Mobility ability: use at mid-range to close the gap
  const mobilityAbility = findAbilityByTag(bot.abilityStates, 'mobility');
  if (
    mobilityAbility &&
    canActivateAbility(mobilityAbility) &&
    nearestDist > 3.0 &&
    nearestDist < 6.0
  ) {
    // ~40% chance per second at 60fps
    if (Math.random() < 0.02) {
      activateAbility(mobilityAbility, bot);
    }
  }

  // --- AoE push ability: use when surrounded
  const aoeAbility = findAbilityByTag(bot.abilityStates, 'aoe_push');
  if (aoeAbility && canActivateAbility(aoeAbility) && nearbyCount >= 2) {
    if (Math.random() < 0.015) {
      activateAbility(aoeAbility, bot);
    }
  }
}
