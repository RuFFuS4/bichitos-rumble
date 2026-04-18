import { Critter } from './critter';
import { activateAbility, canActivateAbility, findAbilityByTag } from './abilities';
import { FEEL } from './gamefeel';

/**
 * Placeholder bot AI: chase the nearest alive critter, headbutt when close,
 * and use abilities based on their SEMANTIC TAGS (not on their slot index).
 *
 * Respects `bot.debugBotBehaviour` so the /tools.html dev lab can isolate
 * behaviour components without touching this file. In production all bots
 * run with the default 'normal' tag and this code path is a no-op extra.
 *
 * Behaviour modes:
 *   - normal       : full AI (chase + headbutt + abilities)
 *   - idle         : freeze in place, don't touch anything
 *   - passive      : chase only, never headbutt or fire abilities
 *   - aggressive   : ~3× ability fire rate, headbutt sooner
 *   - chase        : chase only, no headbutt, no abilities
 *   - ability_only : skip headbutt, still fires abilities
 */
export function updateBot(bot: Critter, allCritters: Critter[], dt: number): void {
  if (!bot.alive) return;

  const mode = bot.debugBotBehaviour;

  // 'idle' = freeze in place. No input, no abilities, nothing.
  if (mode === 'idle') {
    bot.hasInput = false;
    return;
  }

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

  // Early-out paths that disable offensive actions ------------------------
  if (mode === 'passive' || mode === 'chase') return;

  // --- Headbutt when close (unless ability_only) ---
  const skipHeadbutt = mode === 'ability_only';
  const headbuttRange = mode === 'aggressive' ? 2.5 : 2.0;
  if (!skipHeadbutt && nearestDist < headbuttRange) {
    bot.startHeadbutt();
  }

  // Ability fire rate multiplier (aggressive mode fires more often)
  const aggroMul = mode === 'aggressive' ? 3.0 : 1.0;

  // --- Mobility ability: use at mid-range to close the gap
  const mobilityAbility = findAbilityByTag(bot.abilityStates, 'mobility');
  if (
    mobilityAbility &&
    canActivateAbility(mobilityAbility) &&
    nearestDist > 3.0 &&
    nearestDist < 6.0
  ) {
    if (Math.random() < 0.02 * aggroMul) {
      activateAbility(mobilityAbility, bot);
    }
  }

  // --- AoE push ability: use when surrounded
  const aoeAbility = findAbilityByTag(bot.abilityStates, 'aoe_push');
  if (aoeAbility && canActivateAbility(aoeAbility) && nearbyCount >= 2) {
    if (Math.random() < 0.015 * aggroMul) {
      activateAbility(aoeAbility, bot);
    }
  }

  // --- Buff ability (e.g. Frenzy): activate when close to an enemy
  const buffAbility = findAbilityByTag(bot.abilityStates, 'buff');
  if (buffAbility && canActivateAbility(buffAbility) && nearestDist < 3.5) {
    if (Math.random() < 0.008 * aggroMul) {
      activateAbility(buffAbility, bot);
    }
  }
}
