// ---------------------------------------------------------------------------
// Server-side bot AI
// ---------------------------------------------------------------------------
//
// Mirrors the offline client's `src/bot.ts` intent: chase the nearest alive
// enemy, headbutt when close, fire abilities occasionally. Kept intentionally
// simple — this is fill-in content for empty slots + takeovers, not a
// challenging opponent.
//
// The bot never runs physics or mutates PlayerSchema directly. It only
// produces an input vector (same shape the network receives from humans),
// and the normal tick pipeline in BrawlRoom handles everything else. This
// keeps bots and humans gameplay-identical — same physics, same abilities,
// same respawn path. The only difference is who provides the input.
// ---------------------------------------------------------------------------

import type { PlayerSchema } from '../state/PlayerSchema.js';
import { dashGlideFactor, findGripTarget, getAbilityKit, type AbilityDef } from './abilities.js';
import { SIM } from './config.js';

export interface BotInput {
  moveX: number;
  moveZ: number;
  headbutt: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
}

const ZERO: BotInput = {
  moveX: 0, moveZ: 0,
  headbutt: false, ability1: false, ability2: false, ultimate: false,
};

/**
 * Compute the bot's synthetic input for this tick.
 *
 * Decisions:
 *   - Chase the nearest ALIVE non-self critter (human or bot).
 *   - Headbutt when within 2.0 units of the target.
 *   - Fire ability1 (mobility / charge rush) at mid-range (3..6 units),
 *     unless the dash along the facing runs off the arena.
 *   - Fire ability2 by the SHAPE of its def (see the branches below).
 *   - Fire the L by the shape of its def too (`lFires`), except
 *     Sebastian's All-in.
 *   - Small per-tick probability so it doesn't spam — scales with tickRate.
 *
 * Kurama Mirror Trick (v0.11 authorial K, 2026-04-29): while a critter
 * has `immunityTimer > 0` AND its critterName === 'Kurama' AND the
 * timer was just bumped by a self-buff K (selfImmunityDuration) we can't
 * tell from the bot's view, BUT we approximate: bots simply skip the
 * Kurama target if it's currently in an immunity window — the immunity
 * timer is the same flag that Mirror Trick writes to. That makes bots
 * "lose track" of Kurama for the 1.6 s of the trick because every other
 * source of immunity is shorter (post-respawn 1.5 s) and overlaps the
 * same drop-target behaviour anyway. If the only enemy alive is Kurama
 * during their immunity window, the bot falls back to standing still.
 */
// Edge awareness (balance v2, 2026-08-21) — SIM.bots, mirror of the
// client's FEEL.bots (src/gamefeel.ts). Were inline literals here until
// 2026-09-21; tests/sim/feel-sim-parity.test.ts now pins the pairs.
const EDGE_MARGIN = SIM.bots.edgeMargin;
const EDGE_STEER = SIM.bots.edgeSteer;
const LOOK_AHEAD = SIM.bots.lookAhead;

// Tasas de decisión POR SEGUNDO (review 2026-08-24) — espejo de
// FEEL.bots.fireRatesPerSec del cliente. Antes las probabilidades
// por-frame de 60 Hz estaban copiadas literales aquí (30 Hz): los bots
// online casteaban la MITAD que offline. rollAt convierte por tick.
const FIRE_RATES = SIM.bots.fireRatesPerSec;
const TICK_DT = 1 / 30;
const rollAt = (ratePerSec: number): boolean =>
  Math.random() < 1 - Math.pow(1 - ratePerSec, TICK_DT);

interface BotArenaView {
  currentRadius: number;
  /** Radio vivo en UNA dirección (fase 0.5) — ver ArenaSim.radiusAt. */
  radiusAt(angle: number): number;
  isOnArena(x: number, z: number): boolean;
}

/** A J leaves along the facing: its near and far probe points must both
 *  be live floor, and so must the far one pushed out by the dash's glide
 *  (dashGlideFactor: Ice Slide carries 2.16× as far). No arena view, no
 *  probe. Mirror of src/bot.ts. */
function dashStaysOnArena(bot: PlayerSchema, def: AbilityDef | undefined, arena?: BotArenaView): boolean {
  if (!arena) return true;
  const fx = Math.sin(bot.rotationY);
  const fz = Math.cos(bot.rotationY);
  const near = SIM.bots.dashProbeNear;
  const far = SIM.bots.dashProbeFar;
  const glide = def ? far * dashGlideFactor(def) : far;
  return arena.isOnArena(bot.x + fx * near, bot.z + fz * near) &&
    arena.isOnArena(bot.x + fx * far, bot.z + fz * far) &&
    arena.isOnArena(bot.x + fx * glide, bot.z + fz * glide);
}

/** True while a dash or blink of the bot is active. Mirror of src/bot.ts. */
function movementActive(bot: PlayerSchema, kit: ReturnType<typeof getAbilityKit>): boolean {
  for (let i = 0; i < bot.abilities.length; i++) {
    const t = kit[i]?.type;
    if ((t === 'charge_rush' || t === 'blink') && bot.abilities[i].active) return true;
  }
  return false;
}

/** Enemies on the ground (alive, not falling) within `radius` of the bot;
 *  `pushableOnly` also skips the immune, whom no push moves. Mirror of
 *  src/bot.ts countEnemiesWithin. */
function countEnemiesWithin(bot: PlayerSchema, allPlayers: PlayerSchema[], radius: number, pushableOnly: boolean): number {
  let n = 0;
  for (const p of allPlayers) {
    if (p === bot || !p.alive || p.falling) continue;
    if (pushableOnly && p.immunityTimer > 0) continue;
    if (Math.hypot(p.x - bot.x, p.z - bot.z) < radius) n++;
  }
  return n;
}

/**
 * Whether the bot presses its L this tick, by the shape of the def. Mirror
 * of the L branches of src/bot.ts:
 *   · Trunk Grip (gripK): someone the grip would take right now, past
 *     targetedMinRange and within gripMaxRange.
 *   · Sebastian's All-in (holdToFireL): never. BrawlRoom's hold loop starts
 *     the charge on the press and fires it on the release, and gives a bot
 *     neither its charge time nor a way to drop the charge unspent. Held
 *     blind, the bot would fire whether or not anyone is left in the lane,
 *     and those blind releases were half of Sebastian's falls offline.
 *   · Any other L: `buffFires`.
 * `shellingUp`: this tick's K press raises a self-anchoring shell.
 */
function lFires(
  bot: PlayerSchema,
  kit: readonly AbilityDef[],
  allPlayers: PlayerSchema[],
  nearestDist: number,
  inFacingCone: (halfAngleDeg: number) => boolean,
  shellingUp: boolean,
): boolean {
  if (!SIM.bots.ultimateOnline) return false; // deploy gate, see SIM.bots
  const def = kit[2];
  const state = bot.abilities[2];
  if (!def || !state || state.active || state.cooldownLeft > 0) return false;
  if (def.gripK) {
    const grip = findGripTarget(def, bot, allPlayers);
    return !!grip && grip.dist > SIM.bots.targetedMinRange && grip.dist < SIM.bots.gripMaxRange &&
      rollAt(FIRE_RATES.grip);
  }
  if (def.holdToFireL) return false;
  return buffFires(def, bot, kit, allPlayers, nearestDist, inFacingCone, shellingUp) && rollAt(FIRE_RATES.buff);
}

/**
 * When a 'buff' L is worth casting. Never while anchored or charging the
 * anchor (Shelly shelled up: the saw would stand still), counting a shell
 * pressed this same tick: the room starts the K before the L. By shape:
 *   · Frozen Floor: min(2, enemies alive) within floorRadius ×
 *     floorCastRadiusFrac — it's a zone, not a duel buff.
 *   · Cone Pulse: the nearest enemy within buffRange and inside the pulse
 *     cone (Cheeto can't turn during the L).
 *   · Anything else: the nearest enemy within buffRange.
 * Mirror of src/bot.ts buffFires.
 */
function buffFires(
  def: AbilityDef,
  bot: PlayerSchema,
  kit: readonly AbilityDef[],
  allPlayers: PlayerSchema[],
  nearestDist: number,
  inFacingCone: (halfAngleDeg: number) => boolean,
  shellingUp: boolean,
): boolean {
  if (shellingUp) return false;
  for (let i = 0; i < bot.abilities.length; i++) {
    if (bot.abilities[i].active && kit[i]?.selfAnchorWhileBuffed) return false;
  }
  if (def.frozenFloorL) {
    let alive = 0;
    for (const p of allPlayers) if (p !== bot && p.alive) alive++;
    const r = (def.floorRadius ?? 6.0) * SIM.bots.floorCastRadiusFrac;
    return countEnemiesWithin(bot, allPlayers, r, false) >= Math.min(2, alive);
  }
  if (nearestDist >= SIM.bots.buffRange) return false;
  return def.conePulseL ? inFacingCone(def.pulseAngleDeg ?? 45) : true;
}

export function computeBotInput(
  bot: PlayerSchema,
  allPlayers: PlayerSchema[],
  arena?: BotArenaView,
): BotInput {
  if (!bot.alive || bot.falling) return ZERO;

  let nearest: PlayerSchema | null = null;
  let nearestDist = Infinity;
  let nearbyCount = 0;

  for (const p of allPlayers) {
    if (p === bot || !p.alive) continue;
    // Balance v2: a falling target is bait — don't chase it off the rim.
    if (p.falling) continue;
    // v0.11 — Kurama Mirror Trick bot confuse: bots stop targeting a
    // Kurama who is in an immunity window. Other critters with
    // immunity (post-respawn) are still considered targets — only
    // Kurama gets the "lost the scent" treatment because the trick
    // ghost is hers alone.
    if (p.critterName === 'Kurama' && p.immunityTimer > 0) continue;
    const dx = p.x - bot.x;
    const dz = p.z - bot.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
    if (d < SIM.bots.nearbyRadius) nearbyCount++;
  }

  if (!nearest) return ZERO;

  // --- Movement: normalized vector toward target ---
  const dx = nearest.x - bot.x;
  const dz = nearest.z - bot.z;
  const d = Math.max(0.01, Math.sqrt(dx * dx + dz * dz));
  let moveX = dx / d;
  let moveZ = dz / d;

  // --- Edge awareness (balance v2) — mirror of src/bot.ts: void probe
  // ahead (collapse-pattern aware) + radial danger-band inward blend.
  if (arena) {
    const rd = Math.sqrt(bot.x * bot.x + bot.z * bot.z);
    if (rd > 0.01) {
      if (!arena.isOnArena(bot.x + moveX * LOOK_AHEAD, bot.z + moveZ * LOOK_AHEAD)) {
        moveX = -bot.x / rd;
        moveZ = -bot.z / rd;
      } else {
        // 2026-09-06 (fase 0.5): radio de SU dirección, no el global —
        // ver la nota en ArenaSim.radiusAt.
        const danger = rd - (arena.radiusAt(Math.atan2(bot.z, bot.x)) - EDGE_MARGIN);
        if (danger > 0) {
          const w = Math.min(1, danger / EDGE_MARGIN) * EDGE_STEER;
          moveX -= (bot.x / rd) * w;
          moveZ -= (bot.z / rd) * w;
          const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
          if (len > 0.01) { moveX /= len; moveZ /= len; }
        }
      }
    }
  }

  // Bot pace: the move vector's length IS the acceleration fraction
  // (BrawlRoom only renormalises when it exceeds 1), so scaling it here
  // runs online bots at the same moveAccelFactor as offline ones. Applied
  // on the way out, AFTER the LOOK_AHEAD edge probe used the unit
  // direction — scaling earlier would shrink the probe.
  const pace = SIM.bots.moveAccelFactor;

  // Stunned (Trunk Grip / Slam): no action would start, so none is
  // pressed or rolled for. Mirror of src/bot.ts.
  if (bot.stunTimer > 0) return { ...ZERO, moveX: moveX * pace, moveZ: moveZ * pace };

  // --- Headbutt at contact range ---
  const headbutt = nearestDist < 2.0;

  // --- Abilities (probabilistic, per-tick at 30 Hz) ---
  // Same constants as the offline bot in src/bot.ts so online feels similar.
  // 0.02 per frame ≈ ~40% chance/sec to actually fire while in the window.
  // The J leaves along the FACING: skip it if that runs off the arena.
  // Dashes and blinks never overlap: the second would fire from wherever
  // the first leaves the bot, not from where these checks looked.
  const kit = getAbilityKit(bot.critterName);
  const moving = movementActive(bot, kit);
  const ability1 =
    nearestDist > 3.0 && nearestDist < 6.0 && !moving && dashStaysOnArena(bot, kit[0], arena) && rollAt(FIRE_RATES.mobility);
  // 2026-08-24 paridad con src/bot.ts (hallazgo del review adversarial:
  // el cañón de Sebastian era solo-cliente y online nunca salía en
  // 1v1). El slot 2 dispara según la FORMA del def, resuelta del kit
  // — def-driven, sin special-cases por nombre:
  //   · projectile (Kowalski Snowball): banda 4..14 u, within
  //     ±rangedAimDeg of the facing (it flies along it).
  //   · cono direccional (coneAngleDeg — Claw Wave de Sebastian): UNA
  //     víctima delante dentro del radio ×0.9 y dentro del cono.
  //   · blink that seeks (Shadow Step): nearest enemy past headbutt
  //     range, in seek range, not immune, and the landing push
  //     (caster → target) pointing outward at the target.
  //   · blink that leaves a zone behind (Sand Trap): nearest enemy
  //     inside zone.radius × trapRadiusFrac, landing on live floor.
  //   · radial that pushes: two pushable (non-immune) enemies within
  //     min(radius, nearbyRadius), or one within radialSoloFrac of it.
  //   · anything else (Mirror Trick): "estoy rodeado" — nearbyCount >= 2.
  const def2 = kit[1];
  const facingX = Math.sin(bot.rotationY);
  const facingZ = Math.cos(bot.rotationY);
  const inFacingCone = (halfAngleDeg: number): boolean =>
    dx * facingX + dz * facingZ >= d * Math.cos((halfAngleDeg * Math.PI) / 180);
  let ability2: boolean;
  if (def2?.selfBuffOnly && (def2.selfImmunityDuration ?? 0) > 0 && !def2.decoyEscapeDistance) {
    // Defensiva pura (Steel Shell): reflejo DETERMINISTA como en el
    // cliente (it3) — anticipa la carga entrante o la presión en el
    // borde. Sin dados: un tanque que a veces olvida el escudo no es
    // un tanque. (Mirror Trick de Kurama queda fuera: su
    // decoyEscapeDistance lo marca como escape, no como muro.)
    // Review 2026-08-24: el cliente tambien anticipa cargas de
    // MOVILIDAD activas (charge_rush/blink), no solo headbutts — sin
    // esto, un Trunk cargando lanzaba a la Shelly online sin que
    // levantara el escudo. Mismo patron kit+indice que isAnchored().
    const nearestKit = getAbilityKit(nearest.critterName);
    let mobilityActive = false;
    for (let i = 0; i < nearest.abilities.length; i++) {
      const d = nearestKit[i];
      if (d && (d.type === 'charge_rush' || d.type === 'blink') && nearest.abilities[i].active) {
        mobilityActive = true;
        break;
      }
    }
    const chargeIncoming =
      (!!nearest.isHeadbutting || mobilityActive) && nearestDist < SIM.bots.defendRange * 1.6;
    let edgePressure = false;
    if (arena) {
      const rd = Math.sqrt(bot.x * bot.x + bot.z * bot.z);
      edgePressure = rd > arena.radiusAt(Math.atan2(bot.z, bot.x)) - EDGE_MARGIN && nearestDist < SIM.bots.defendRange;
    }
    // With its own L active (Saw Shell, wind-up included), shelling up only
    // for the rim: anchored, the saw stands still. Mirror of src/bot.ts.
    const ownLRunning = kit[2]?.type === 'frenzy' && !!bot.abilities[2]?.active;
    ability2 = (chargeIncoming && !ownLRunning) || edgePressure;
  } else if (def2?.type === 'projectile') {
    ability2 = nearestDist > 4.0 && nearestDist < 14.0 && inFacingCone(SIM.bots.rangedAimDeg) &&
      rollAt(FIRE_RATES.ranged);
  } else if (typeof def2?.coneAngleDeg === 'number') {
    ability2 = nearestDist < (def2.radius ?? 3.5) * 0.9 && inFacingCone(def2.coneAngleDeg) && rollAt(FIRE_RATES.cone);
  } else if (def2?.type === 'blink' && def2.blinkSeekNearest) {
    ability2 = !ability1 && !moving && nearest.immunityTimer <= 0 &&
      nearestDist > SIM.bots.targetedMinRange && nearestDist < (def2.blinkSeekRange ?? 9.0) &&
      dx * nearest.x + dz * nearest.z > 0 &&
      rollAt(FIRE_RATES.blinkSeek);
  } else if (def2?.type === 'blink' && def2.zoneAtOrigin && def2.zone) {
    const reach = def2.blinkDistance ?? 4.0;
    ability2 = !ability1 && !moving && nearestDist < def2.zone.radius * SIM.bots.trapRadiusFrac &&
      (!arena || arena.isOnArena(bot.x + facingX * reach, bot.z + facingZ * reach)) &&
      rollAt(FIRE_RATES.trap);
  } else {
    const r = Math.min(def2?.radius ?? SIM.groundPound.radius, SIM.bots.nearbyRadius);
    const pushes = r > 0 && (def2?.force ?? SIM.groundPound.force) > 0 && !def2?.selfBuffOnly;
    const fires = pushes
      ? countEnemiesWithin(bot, allPlayers, r, true) >= 2 ||
        (nearestDist < r * SIM.bots.radialSoloFrac && nearest.immunityTimer <= 0)
      : nearbyCount >= 2;
    ability2 = fires && rollAt(FIRE_RATES.radial);
  }
  // --- The L (2026-09-24, Rafa: online bots cast it too), by the shape of
  // its def. Until then this was a flat `false`. `shellingUp`: this tick's
  // K press starts a self-anchoring shell, which it only does with the K
  // ready.
  const kState = bot.abilities[1];
  const shellingUp = ability2 && !!def2?.selfAnchorWhileBuffed &&
    !!kState && !kState.active && kState.cooldownLeft <= 0;
  const ultimate = lFires(bot, kit, allPlayers, nearestDist, inFacingCone, shellingUp);

  return { moveX: moveX * pace, moveZ: moveZ * pace, headbutt, ability1, ability2, ultimate };
}
