import * as THREE from 'three';
import { Critter } from './critter';
import type { AbilityDef } from './abilities';
import {
  activateAbility, advanceAllInCharge, canActivateAbility, cancelSebastianAllInCharge, dashGlideFactor, findAbilityByTag,
  findAllInTarget, findGripTarget, getSlipperyZone, releaseSebastianAllInCharge, startSebastianAllInCharge,
} from './abilities-runtime';
import { FEEL } from './gamefeel';
import { matchRng } from './match-rng';

/** Minimal arena view for edge awareness (balance v2). */
interface BotArenaView {
  currentRadius: number;
  /** Radio vivo en UNA dirección (fase 0.5) — ver Arena.radiusAt. */
  radiusAt(angle: number): number;
  isOnArena(x: number, z: number): boolean;
}

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
  // Optional so headless/unit contexts without an arena keep working.
  arena?: BotArenaView,
): void {
  // Review 2026-08-24: guard de falling en paridad con el server (que
  // devuelve ZERO) — un bot cayendo seguía persiguiendo/casteando en
  // el aire y podía disparar cooldowns fantasma antes del respawn.
  if (!bot.alive || bot.falling) { bot.hasInput = false; return; }

  const mode = bot.debugBotBehaviour;

  // 'idle' = freeze in place. No input, no abilities, nothing.
  if (mode === 'idle') {
    bot.hasInput = false;
    return;
  }

  // Holding Sebastian's All-in: rooted like the player's charge, and the
  // bot does nothing else until it resolves or drops it.
  if (bot.lHoldCharging) {
    bot.hasInput = false;
    tickAllInCharge(bot, allCritters, dt);
    return;
  }

  // Find nearest alive enemy + count enemies within FEEL.bots.nearbyRadius.
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
    if (dist < FEEL.bots.nearbyRadius) nearbyCount++;
  }

  if (!nearest) {
    bot.hasInput = false;
    return;
  }

  bot.hasInput = true;
  bot.moveX = 0;
  bot.moveZ = 0;
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
        // Review 2026-08-24: la sonda usa la DIRECCIÓN normalizada, no
        // el vector ya escalado — durante una carga steerFactor deja
        // nx/nz en ~0.15 y la sonda encogía a 0.17 u (miraba a sus
        // propios pies justo cuando más rápido va hacia el vacío).
        const dl = Math.sqrt(nx * nx + nz * nz);
        const dirX = dl > 0.001 ? nx / dl : nx;
        const dirZ = dl > 0.001 ? nz / dl : nz;
        const aheadX = bot.x + dirX * FEEL.bots.lookAhead;
        const aheadZ = bot.z + dirZ * FEEL.bots.lookAhead;
        if (!arena.isOnArena(aheadX, aheadZ)) {
          nx = -bot.x / rd;
          nz = -bot.z / rd;
        } else {
          // 2026-09-06 (fase 0.5): radio de SU dirección, no el global. Con
          // `currentRadius` un bot plantado sobre el borde de la mitad ya
          // caída (patrón axis-split) no sentía peligro alguno mientras
          // sobreviviera un sector exterior en la otra punta del disco.
          const danger = rd - (arena.radiusAt(Math.atan2(bot.z, bot.x)) - FEEL.bots.edgeMargin);
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

    // Less grip on someone else's ice (Kowalski Frozen Floor), applied
    // before moveAccel like player.ts.
    const ice = getSlipperyZone(bot.x, bot.z, bot.config.name);
    const accel = bot.effectiveSpeed * FEEL.movement.accelerationScale * FEEL.bots.moveAccelFactor * (ice?.accelMult ?? 1);
    bot.moveX = nx;
    bot.moveZ = nz;
    bot.moveAccel = Math.hypot(nx, nz) * accel;
    bot.pace = FEEL.bots.moveAccelFactor;
    bot.vx += nx * accel * dt;
    bot.vz += nz * accel * dt;
  }

  // Early-out paths that disable offensive actions ------------------------
  if (mode === 'passive' || mode === 'chase') return;
  // Stunned: no action would start (startHeadbutt / activateAbility refuse
  // it), so no decision is rolled for one. Mirror: server/src/sim/bot.ts.
  if (bot.stunTimer > 0) return;

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
          rd > arena.radiusAt(Math.atan2(bot.z, bot.x)) - FEEL.bots.edgeMargin &&
          nearestDist < FEEL.bots.defendRange;
      }
      // With its own L running (Saw Shell), shelling up only for the rim:
      // anchored, the saw stands still (26 % of shelled saws landed,
      // 58 % of free ones).
      if ((chargeIncoming && !ownLRunning(bot)) || edgePressure) {
        activateAbility(defensive, bot);
      }
    }
  }

  // Ability fire rate multiplier (aggressive mode fires more often)
  const aggroMul = mode === 'aggressive' ? 3.0 : 1.0;
  // Review 2026-08-24: rolls frame-rate-independientes — la tasa vive
  // por SEGUNDO en FEEL.bots.fireRatesPerSec y se convierte con el dt
  // real del frame. A dt=1/60 reproduce EXACTAMENTE las probabilidades
  // históricas (golden intacto); a 144 Hz deja de castear 2.4× más y
  // el server (30 Hz) puede espejar la misma tasa.
  const roll = (ratePerSec: number): boolean =>
    matchRng() < (1 - Math.pow(1 - ratePerSec, dt)) * aggroMul;

  // --- Mobility ability: use at mid-range to close the gap, and only if
  // the dash doesn't run off the arena: it leaves along the FACING, which
  // the edge steering may not have turned yet.
  const mobilityAbility = findAbilityByTag(bot.abilityStates, 'mobility');
  if (
    mobilityAbility &&
    canActivateAbility(mobilityAbility) &&
    nearestDist > 3.0 &&
    nearestDist < 6.0 &&
    !movementActive(bot) &&
    dashStaysOnArena(bot, mobilityAbility.def, arena)
  ) {
    if (roll(FEEL.bots.fireRatesPerSec.mobility)) {
      activateAbility(mobilityAbility, bot);
    }
  }

  // --- AoE push ability: firing conditions by SHAPE of the def
  // (2026-08-24 balance v2 — cañón de Sebastian, cola de BALANCE.md):
  //   · Direccional (coneAngleDeg): es un cañón frontal, UNA víctima
  //     delante dentro del radio basta. Con la condición radial, la
  //     Claw Wave de Sebastian (force 76, su mejor arma) solo salía
  //     cuando ya estaba rodeado y perdido — el audit lo midió en 0/6.
  //     And ahead for real: inside the facing's cone.
  //   · Radial that pushes (radius and force, not a self-buff): two
  //     pushable enemies within min(radius, nearbyRadius), or a single
  //     pushable one within radialSoloFrac of it (no push moves the
  //     immune). Counting at 4 u for a 3.5 u Shockwave cast
  //     it with at most one enemy inside in 48 % of uses, and never in 1v1.
  //   · Anything else (Mirror Trick): "estoy rodeado" — nearbyCount >= 2.
  const aoeAbility = findAbilityByTag(bot.abilityStates, 'aoe_push');
  if (aoeAbility && canActivateAbility(aoeAbility)) {
    const def = aoeAbility.def;
    const isCone = typeof def.coneAngleDeg === 'number';
    let fires: boolean;
    if (isCone) {
      fires = nearestDist < (def.radius ?? 3.5) * 0.9 && inFacingCone(bot, dx, dz, dist, def.coneAngleDeg!);
    } else if (def.radius > 0 && def.force > 0 && !def.selfBuffOnly) {
      const r = Math.min(def.radius, FEEL.bots.nearbyRadius);
      fires = countEnemiesWithin(bot, allCritters, r, true) >= 2 ||
        (nearestDist < r * FEEL.bots.radialSoloFrac && !nearest.isImmune);
    } else {
      fires = nearbyCount >= 2;
    }
    if (fires && roll(isCone ? FEEL.bots.fireRatesPerSec.cone : FEEL.bots.fireRatesPerSec.radial)) {
      activateAbility(aoeAbility, bot);
    }
  }

  // --- Ranged ability (Kowalski Snowball): fire frontally when an
  //     enemy is in the projectile's effective lane. The snowball
  //     travels ~21.6 u (1.2 s × 18 u/s) so a 4..14 u target band
  //     covers the realistic hit window. The bot doesn't lead the
  //     target — server clamp is short enough that a moving target
  //     can dodge anyway. It flies along the facing, so the target
  //     must sit within ±rangedAimDeg of it.
  const rangedAbility = findAbilityByTag(bot.abilityStates, 'ranged');
  if (
    rangedAbility && canActivateAbility(rangedAbility) && nearestDist > 4 && nearestDist < 14 &&
    inFacingCone(bot, dx, dz, dist, FEEL.bots.rangedAimDeg)
  ) {
    if (roll(FEEL.bots.fireRatesPerSec.ranged)) {
      activateAbility(rangedAbility, bot);
    }
  }

  // --- Targeted ability, by shape of the def. Not on someone already
  // at headbutt range.
  //   · Trunk Grip (gripK): someone the grip would take right now, no
  //     farther than gripMaxRange.
  //   · Shadow Step (blinkSeekNearest): lands next to the nearest enemy
  //     and shoves it along caster → target, so only when that push
  //     points outward at the target (toward the rim). Not mid-dash: the
  //     checks read where the bot stands now.
  const targeted = findAbilityByTag(bot.abilityStates, 'targeted');
  if (targeted && canActivateAbility(targeted)) {
    const def = targeted.def;
    if (def.gripK) {
      const grip = findGripTarget(def, bot, allCritters);
      if (
        grip && grip.dist > FEEL.bots.targetedMinRange && grip.dist < FEEL.bots.gripMaxRange &&
        roll(FEEL.bots.fireRatesPerSec.grip)
      ) {
        activateAbility(targeted, bot);
      }
    } else if (def.blinkSeekNearest) {
      if (
        !movementActive(bot) &&
        !nearest.isImmune &&
        nearestDist > FEEL.bots.targetedMinRange && nearestDist < (def.blinkSeekRange ?? 9.0) &&
        dx * nearest.x + dz * nearest.z > 0 &&
        roll(FEEL.bots.fireRatesPerSec.blinkSeek)
      ) {
        activateAbility(targeted, bot);
      }
    }
  }

  // --- Utility ability (Sand Trap, zoneAtOrigin blink): burrow away while
  // the nearest enemy stands where the quicksand will be left, if the
  // landing along the facing is live floor. Not mid-dash, like Shadow Step.
  const utility = findAbilityByTag(bot.abilityStates, 'utility');
  if (
    utility && canActivateAbility(utility) && utility.def.zoneAtOrigin && utility.def.zone &&
    !movementActive(bot)
  ) {
    const reach = utility.def.blinkDistance ?? 4.0;
    const ry = bot.mesh.rotation.y;
    if (
      nearestDist < utility.def.zone.radius * FEEL.bots.trapRadiusFrac &&
      (!arena || arena.isOnArena(bot.x + Math.sin(ry) * reach, bot.z + Math.cos(ry) * reach)) &&
      roll(FEEL.bots.fireRatesPerSec.trap)
    ) {
      activateAbility(utility, bot);
    }
  }

  // --- Buff ability (e.g. Frenzy): activate when close to an enemy
  const buffAbility = findAbilityByTag(bot.abilityStates, 'buff');
  if (
    buffAbility && canActivateAbility(buffAbility) &&
    buffFires(buffAbility.def, bot, allCritters, dx, dz, dist) &&
    roll(FEEL.bots.fireRatesPerSec.buff)
  ) {
    activateAbility(buffAbility, bot);
  }

  // --- Risky ability (Sebastian's All-in): a miss falls into the void.
  // Same hold-and-release path as the player: charge only with someone
  // in the real hit lane (narrowed by allInLaneInset), and never on top of
  // another ability. tickAllInCharge re-checks on release. Offline only:
  // online the room gives a bot no way to drop a charge (sim/bot.ts).
  const risky = findAbilityByTag(bot.abilityStates, 'risky');
  if (
    risky?.def.allInL && risky.def.holdToFireL && canActivateAbility(risky) &&
    !bot.abilityStates.some((s) => s.active) &&
    findAllInTarget(risky.def, bot, allCritters, FEEL.bots.allInLaneInset) &&
    roll(FEEL.bots.fireRatesPerSec.risky)
  ) {
    const scene = sceneOf(bot);
    if (scene) startSebastianAllInCharge(bot, scene);
  }
}

/**
 * The bot's side of the All-in hold: after allInReactionSec it releases if
 * the full hit lane still holds someone, and otherwise drops the charge
 * without spending the cooldown (the old blind release was half of
 * Sebastian's falls). The release waits for the def's holdToFireMinMs like
 * the player's. With no move input the bot keeps the aim it started with.
 */
function tickAllInCharge(bot: Critter, allCritters: Critter[], dt: number): void {
  advanceAllInCharge(bot, dt);
  if (bot.lHoldChargeTime < FEEL.bots.allInReactionSec) return;
  const risky = findAbilityByTag(bot.abilityStates, 'risky');
  const scene = sceneOf(bot);
  if (risky && scene && findAllInTarget(risky.def, bot, allCritters)) {
    releaseSebastianAllInCharge(bot, allCritters, scene);
  } else {
    cancelSebastianAllInCharge(bot);
  }
}

/** The scene the bot's mesh was added to (Critter's constructor adds it
 *  to the game scene); the All-in helpers need it for their VFX. */
function sceneOf(bot: Critter): THREE.Scene | null {
  const parent = bot.mesh.parent;
  return parent instanceof THREE.Scene ? parent : null;
}

/** (dx, dz) → the target, `dist` its length: inside ±halfAngleDeg of the
 *  bot's gameplay facing (mesh.rotation.y; the turn lag lives on a child
 *  pivot). */
function inFacingCone(bot: Critter, dx: number, dz: number, dist: number, halfAngleDeg: number): boolean {
  const ry = bot.mesh.rotation.y;
  return dx * Math.sin(ry) + dz * Math.cos(ry) >= dist * Math.cos((halfAngleDeg * Math.PI) / 180);
}

/** A J leaves along the facing: its near and far probe points must both
 *  be live floor, and so must the far one pushed out by the dash's glide
 *  (dashGlideFactor: Ice Slide carries 2.16× as far; probing at 3 u, 5 of
 *  43 of her slides ended in a fall within 1 s). No arena view, no probe. */
function dashStaysOnArena(bot: Critter, def: AbilityDef, arena?: BotArenaView): boolean {
  if (!arena) return true;
  const fx = Math.sin(bot.mesh.rotation.y);
  const fz = Math.cos(bot.mesh.rotation.y);
  const near = FEEL.bots.dashProbeNear;
  const far = FEEL.bots.dashProbeFar;
  const glide = far * dashGlideFactor(def);
  return arena.isOnArena(bot.x + fx * near, bot.z + fz * near) &&
    arena.isOnArena(bot.x + fx * far, bot.z + fz * far) &&
    arena.isOnArena(bot.x + fx * glide, bot.z + fz * glide);
}

/** Enemies on the ground (alive, not falling) within `radius` of the bot;
 *  `pushableOnly` also skips the immune, whom no push moves. */
function countEnemiesWithin(bot: Critter, allCritters: Critter[], radius: number, pushableOnly: boolean): number {
  let n = 0;
  for (const other of allCritters) {
    if (other === bot || !other.alive || other.falling) continue;
    if (pushableOnly && other.isImmune) continue;
    if (Math.hypot(other.x - bot.x, other.z - bot.z) < radius) n++;
  }
  return n;
}

/** True while a frenzy-type ability (the L) of the bot is active, wind-up
 *  included: the cast is already committed. */
function ownLRunning(bot: Critter): boolean {
  return bot.abilityStates.some((s) => s.def.type === 'frenzy' && s.active);
}

/** True while a dash or blink of the bot is active: another one started now
 *  would fire from wherever the first leaves it, not from where the bot's
 *  checks looked. */
function movementActive(bot: Critter): boolean {
  return bot.abilityStates.some((s) => s.active && (s.def.type === 'charge_rush' || s.def.type === 'blink'));
}

/**
 * When a 'buff' L is worth casting. Never while anchored or charging the
 * anchor (Shelly shelled up: the saw would stand still). By shape:
 *   · Frozen Floor: min(2, enemies alive) within floorRadius ×
 *     floorCastRadiusFrac — it's a zone, not a duel buff.
 *   · Cone Pulse: the nearest enemy within buffRange and inside the pulse
 *     cone (Cheeto can't turn during the L).
 *   · Anything else: the nearest enemy within buffRange.
 * Mirror: server/src/sim/bot.ts buffFires.
 */
function buffFires(def: AbilityDef, bot: Critter, allCritters: Critter[], dx: number, dz: number, dist: number): boolean {
  if (bot.abilityStates.some((s) => s.active && s.def.selfAnchorWhileBuffed)) return false;
  if (def.frozenFloorL) {
    let alive = 0;
    for (const other of allCritters) if (other !== bot && other.alive) alive++;
    const r = (def.floorRadius ?? 6.0) * FEEL.bots.floorCastRadiusFrac;
    return countEnemiesWithin(bot, allCritters, r, false) >= Math.min(2, alive);
  }
  if (dist >= FEEL.bots.buffRange) return false;
  return def.conePulseL ? inFacingCone(bot, dx, dz, dist, def.pulseAngleDeg ?? 45) : true;
}
