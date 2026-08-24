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
import { getAbilityKit } from './abilities.js';

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
 *   - Fire ability1 (mobility / charge rush) at mid-range (3..6 units).
 *   - Fire ability2 (AoE / ground pound) when ≥2 enemies are within 4u.
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
// Edge awareness (balance v2, 2026-08-21) — keep in sync with the
// client's FEEL.bots (src/gamefeel.ts). Mirrored inline: the server sim
// carries no gamefeel module and these three are the only knobs.
const EDGE_MARGIN = 1.4;
const EDGE_STEER = 1.6;
const LOOK_AHEAD = 1.1;

export function computeBotInput(
  bot: PlayerSchema,
  allPlayers: PlayerSchema[],
  arena?: { currentRadius: number; isOnArena(x: number, z: number): boolean },
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
    if (d < 4.0) nearbyCount++;
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
        const danger = rd - (arena.currentRadius - EDGE_MARGIN);
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

  // --- Headbutt at contact range ---
  const headbutt = nearestDist < 2.0;

  // --- Abilities (probabilistic, per-tick at 30 Hz) ---
  // Same constants as the offline bot in src/bot.ts so online feels similar.
  // 0.02 per frame ≈ ~40% chance/sec to actually fire while in the window.
  const ability1 =
    nearestDist > 3.0 && nearestDist < 6.0 && Math.random() < 0.02;
  // 2026-08-24 paridad con src/bot.ts (hallazgo del review adversarial:
  // el cañón de Sebastian era solo-cliente y online nunca salía en
  // 1v1). El slot 2 dispara según la FORMA del def, resuelta del kit
  // — def-driven, sin special-cases por nombre:
  //   · projectile (Kowalski Snowball): banda 4..14 u frontal.
  //   · cono direccional (coneAngleDeg — Claw Wave de Sebastian): UNA
  //     víctima delante dentro del radio ×0.9, doble de probabilidad.
  //   · radial: "estoy rodeado" — nearbyCount >= 2, como siempre.
  const def2 = getAbilityKit(bot.critterName)[1];
  let ability2: boolean;
  if (def2?.selfBuffOnly && (def2.selfImmunityDuration ?? 0) > 0 && !def2.decoyEscapeDistance) {
    // Defensiva pura (Steel Shell): reflejo DETERMINISTA como en el
    // cliente (it3) — anticipa la carga entrante o la presión en el
    // borde. Sin dados: un tanque que a veces olvida el escudo no es
    // un tanque. (Mirror Trick de Kurama queda fuera: su
    // decoyEscapeDistance lo marca como escape, no como muro.)
    const chargeIncoming = !!nearest.isHeadbutting && nearestDist < 2.8 * 1.6;
    let edgePressure = false;
    if (arena) {
      const rd = Math.sqrt(bot.x * bot.x + bot.z * bot.z);
      edgePressure = rd > arena.currentRadius - EDGE_MARGIN && nearestDist < 2.8;
    }
    ability2 = chargeIncoming || edgePressure;
  } else if (def2?.type === 'projectile') {
    ability2 = nearestDist > 4.0 && nearestDist < 14.0 && Math.random() < 0.022;
  } else if (typeof def2?.coneAngleDeg === 'number') {
    ability2 = nearestDist < (def2.radius ?? 3.5) * 0.9 && Math.random() < 0.03;
  } else {
    ability2 = nearbyCount >= 2 && Math.random() < 0.015;
  }
  const ultimate = false; // conservative: let bots not spam ultimates online

  return { moveX, moveZ, headbutt, ability1, ability2, ultimate };
}
