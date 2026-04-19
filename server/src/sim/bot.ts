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
 */
export function computeBotInput(bot: PlayerSchema, allPlayers: PlayerSchema[]): BotInput {
  if (!bot.alive || bot.falling) return ZERO;

  let nearest: PlayerSchema | null = null;
  let nearestDist = Infinity;
  let nearbyCount = 0;

  for (const p of allPlayers) {
    if (p === bot || !p.alive) continue;
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
  const moveX = dx / d;
  const moveZ = dz / d;

  // --- Headbutt at contact range ---
  const headbutt = nearestDist < 2.0;

  // --- Abilities (probabilistic, per-tick at 30 Hz) ---
  // Same constants as the offline bot in src/bot.ts so online feels similar.
  // 0.02 per frame ≈ ~40% chance/sec to actually fire while in the window.
  const ability1 =
    nearestDist > 3.0 && nearestDist < 6.0 && Math.random() < 0.02;
  const ability2 = nearbyCount >= 2 && Math.random() < 0.015;
  const ultimate = false; // conservative: let bots not spam ultimates online

  return { moveX, moveZ, headbutt, ability1, ability2, ultimate };
}
