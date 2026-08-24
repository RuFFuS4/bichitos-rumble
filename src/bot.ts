import { Critter } from './critter';
import { activateAbility, canActivateAbility, findAbilityByTag } from './abilities';
import { FEEL } from './gamefeel';
import { matchRng } from './match-rng';

/**
 * Placeholder bot AI: chase the nearest alive critter, headbutt when close,
 * and use abilities based on their SEMANTIC TAGS (not on their slot index).
 *
 * Respects `bot.debugBotBehaviour` so the /tools.html dev lab can isolate
 * behaviour components without touching this file. In production all bots
 * run with the default 'normal' tag and this code path is a no-op extra.
 *
 * Decision rolls use matchRng() (seeded per match) so a seeded offline
 * match replays the same bot decisions — see src/match-rng.ts.
 *
 * Behaviour modes:
 *   - normal       : full AI (chase + headbutt + abilities)
 *   - idle         : freeze in place, don't touch anything
 *   - passive      : chase only, never headbutt or fire abilities
 *   - aggressive   : ~3× ability fire rate, headbutt sooner
 *   - chase        : chase only, no headbutt, no abilities
 *   - ability_only : skip headbutt, still fires abilities
 */
export function updateBot(
  bot: Critter,
  allCritters: Critter[],
  dt: number,
  // Minimal arena view for edge awareness (balance v2). Optional so
  // headless/unit contexts without an arena keep working.
  arena?: { currentRadius: number; isOnArena(x: number, z: number): boolean },
): void {
  if (!bot.alive) return;

  const mode = bot.debugBotBehaviour;

  // 'idle' = freeze in place. No input, no abilities, nothing.
  if (mode === 'idle') {
    bot.hasInput = false;
    return;
  }

  // Find nearest alive enemy + count enemies within 4 units.
  //
  // Kurama Mirror Trick (v0.11 authorial K, 2026-04-29): bots skip a
  // Kurama target who is currently in an immunity window. The trick
  // writes immunityTimer, and that's the same flag used here as the
  // proxy for "bot loses the scent". 1.6 s of trick → bots literally
  // ignore Kurama and target the next nearest critter, exactly the
  // "decoy + invisibility" read Rafa specified. Other critters in
  // immunity (post-respawn 1.5 s) stay valid targets — only Kurama
  // gets the lost-scent treatment.
  let nearest: Critter | null = null;
  let nearestDist = Infinity;
  let nearbyCount = 0;
  for (const other of allCritters) {
    if (other === bot || !other.alive) continue;
    // Balance v2: a falling target is bait — chasing it walks the bot
    // straight off the edge. Let gravity finish the job unassisted.
    if (other.falling) continue;
    if (other.config.name === 'Kurama' && other.isImmune) continue;
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

    // --- Edge awareness (balance v2, 2026-08-21) -----------------------
    // Two layers, both FEEL-tunable:
    //   1. Void probe: if the spot ~lookAhead ahead of the chase vector
    //      is off the arena (collapse-pattern aware), steer fully inward.
    //   2. Radial margin: within edgeMargin of the shrinking rim, blend
    //      an inward pull proportional to how deep into the danger band
    //      the bot is, then renormalize.
    // Runs BEFORE the confusion inversion on purpose: a confused bot
    // SHOULD still be able to stumble into the void — that's the point
    // of Toxic Touch.
    if (arena) {
      const rd = Math.sqrt(bot.x * bot.x + bot.z * bot.z);
      if (rd > 0.01) {
        const aheadX = bot.x + nx * FEEL.bots.lookAhead;
        const aheadZ = bot.z + nz * FEEL.bots.lookAhead;
        if (!arena.isOnArena(aheadX, aheadZ)) {
          nx = -bot.x / rd;
          nz = -bot.z / rd;
        } else {
          const danger = rd - (arena.currentRadius - FEEL.bots.edgeMargin);
          if (danger > 0) {
            const w = Math.min(1, danger / FEEL.bots.edgeMargin) * FEEL.bots.edgeSteer;
            nx -= (bot.x / rd) * w;
            nz -= (bot.z / rd) * w;
            const len = Math.sqrt(nx * nx + nz * nz);
            if (len > 0.01) { nx /= len; nz /= len; }
          }
        }
      }
    }

    // 2026-04-30 final-L — Toxic Touch confused inversion (offline bot).
    if (bot.confusedTimer > 0) { nx = -nx; nz = -nz; }

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

  // --- Defensive ability: reactive, NOT probabilistic (balance v2 it3).
  // A tank that sometimes forgets the shield is not a tank — and a
  // deterministic reflex keeps batch runs reproducible. Fires when the
  // bot is in the edge danger band with an enemy inside punt distance:
  // exactly the "about to be knocked into the void" moment the audit
  // showed killing Shelly 3×/match.
  {
    const defensive = findAbilityByTag(bot.abilityStates, 'defensive');
    if (defensive && canActivateAbility(defensive)) {
      // Two triggers, both anticipatory (the shell has 0.20 s of windUp
      // — waiting for contact range casts it into the launch):
      //   1. Incoming attack: the nearest enemy is mid-headbutt or in a
      //      mobility charge within defendRange × 1.6 — shield BEFORE
      //      the punt lands, anywhere on the arena (immunity mid-arena
      //      is correct tank play against force-48 charges).
      //   2. Edge pressure: enemy inside defendRange while we sit in
      //      the shrinking rim's danger band.
      const chargeIncoming =
        (nearest.isHeadbutting ||
          findAbilityByTag(nearest.abilityStates, 'mobility')?.active) &&
        nearestDist < FEEL.bots.defendRange * 1.6;
      let edgePressure = false;
      if (arena) {
        const rd = Math.sqrt(bot.x * bot.x + bot.z * bot.z);
        edgePressure =
          rd > arena.currentRadius - FEEL.bots.edgeMargin &&
          nearestDist < FEEL.bots.defendRange;
      }
      if (chargeIncoming || edgePressure) {
        activateAbility(defensive, bot);
      }
    }
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
    if (matchRng() < 0.02 * aggroMul) {
      activateAbility(mobilityAbility, bot);
    }
  }

  // --- AoE push ability: two firing conditions by SHAPE of the def
  // (2026-08-24 balance v2 — cañón de Sebastian, cola de BALANCE.md):
  //   · Radial (sin coneAngleDeg): "estoy rodeado" — nearbyCount >= 2.
  //   · Direccional (coneAngleDeg): es un cañón frontal, UNA víctima
  //     delante dentro del radio basta. Con la condición radial, la
  //     Claw Wave de Sebastian (force 76, su mejor arma) solo salía
  //     cuando ya estaba rodeado y perdido — el audit lo midió en 0/6.
  const aoeAbility = findAbilityByTag(bot.abilityStates, 'aoe_push');
  if (aoeAbility && canActivateAbility(aoeAbility)) {
    const isCone = typeof aoeAbility.def.coneAngleDeg === 'number';
    const fires = isCone
      ? nearestDist < (aoeAbility.def.radius ?? 3.5) * 0.9
      : nearbyCount >= 2;
    if (fires && matchRng() < (isCone ? 0.03 : 0.015) * aggroMul) {
      activateAbility(aoeAbility, bot);
    }
  }

  // --- Ranged ability (Kowalski Snowball): fire frontally when an
  //     enemy is in the projectile's effective lane. The snowball
  //     travels ~21.6 u (1.2 s × 18 u/s) so a 4..14 u target band
  //     covers the realistic hit window. The bot doesn't lead the
  //     target — server clamp is short enough that a moving target
  //     can dodge anyway.
  const rangedAbility = findAbilityByTag(bot.abilityStates, 'ranged');
  if (rangedAbility && canActivateAbility(rangedAbility) && nearestDist > 4 && nearestDist < 14) {
    // Cone gate: only fire if the target is roughly in front of us
    // (within ±35° of our movement vector). nx,nz already point at
    // the target, so we just need to face it before firing.
    if (matchRng() < 0.022 * aggroMul) {
      activateAbility(rangedAbility, bot);
    }
  }

  // --- Buff ability (e.g. Frenzy): activate when close to an enemy
  const buffAbility = findAbilityByTag(bot.abilityStates, 'buff');
  if (buffAbility && canActivateAbility(buffAbility) && nearestDist < 3.5) {
    if (matchRng() < 0.008 * aggroMul) {
      activateAbility(buffAbility, bot);
    }
  }
}
