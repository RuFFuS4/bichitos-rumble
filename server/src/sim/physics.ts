// ---------------------------------------------------------------------------
// Server-side physics — replicated from client's src/physics.ts
// ---------------------------------------------------------------------------
//
// Same algorithm as the client but operates on PlayerSchema instances
// instead of Critter. No visual side-effects (no camera shake, no hit stop,
// no sounds) — those stay client-only and fire on state change.
// ---------------------------------------------------------------------------

import type { PlayerSchema } from '../state/PlayerSchema.js';
import { SIM, getCritterConfig } from './config.js';
import { getAbilityKit } from './abilities.js';

/**
 * Minimal shape for the per-player internal data used here.
 * Kept separate from PlayerSchema (anti-pattern to mix sync + non-sync).
 *
 * Last-attacker tracking: `lastAttackerSid` records who most recently
 * knocked this player with a headbutt collision so that — when that hit
 * eventually causes them to fall off and lose their last life — the
 * finisher can be credited with a kill (Online Belts Slayer). The
 * timestamp lets us ignore stale attackers (player wandered off, fell
 * on their own, …) via ATTACKER_STALE_MS.
 */
interface InternalLike {
  respawnTimer: number;
  lastAttackerSid?: string | null;
  lastAttackTimeMs?: number;
}

/** Headbutt-credit is ignored if the last hit was more than this long ago.
 *  Matches roughly the time it takes to get knocked off + fall animation. */
const ATTACKER_STALE_MS = 5000;

/**
 * Resolve pairwise collisions between all alive/non-falling players.
 * Applies knockback based on who is headbutting and mass ratios.
 *
 * `internal` is optional — callers that don't care about last-attacker
 * tracking (e.g. offline client) omit it. When provided, headbutt hits
 * are recorded on the defender so Slayer Belt credit can flow through
 * updateFalling when a life is lost.
 */
export function resolveCollisions(
  players: PlayerSchema[],
  internal?: Map<string, InternalLike>,
): void {
  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive || a.falling) continue;
    const aCfg = getCritterConfig(a.critterName);
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j];
      if (!b.alive || b.falling) continue;
      const bCfg = getCritterConfig(b.critterName);

      const eitherImmune = a.immunityTimer > 0 || b.immunityTimer > 0;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = aCfg.radius + bCfg.radius;

      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist;
        const nz = dz / dist;

        // Separate overlapping players
        const overlap = (minDist - dist) / 2;
        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;

        if (eitherImmune) continue;

        const massA = effectiveMass(a);
        const massB = effectiveMass(b);

        // Knockback force — headbutt multiplies. Use the attacker's config.
        let force = SIM.collision.normalPushForce;
        if (a.isHeadbutting) force = aCfg.headbuttForce * SIM.collision.headbuttMultiplier;
        else if (b.isHeadbutting) force = bCfg.headbuttForce * SIM.collision.headbuttMultiplier;

        const ratioA = massB / (massA + massB);
        const ratioB = massA / (massA + massB);

        if (a.isHeadbutting) {
          b.vx += nx * force * ratioB;
          b.vz += nz * force * ratioB;
          a.vx -= nx * force * SIM.headbutt.recoilFactor;
          a.vz -= nz * force * SIM.headbutt.recoilFactor;
          // Credit: A hit B. If B falls in the next ATTACKER_STALE_MS
          // window, A gets the kill.
          const bi = internal?.get(b.sessionId);
          if (bi) {
            bi.lastAttackerSid = a.sessionId;
            bi.lastAttackTimeMs = Date.now();
          }
        } else if (b.isHeadbutting) {
          a.vx -= nx * force * ratioA;
          a.vz -= nz * force * ratioA;
          b.vx += nx * force * SIM.headbutt.recoilFactor;
          b.vz += nz * force * SIM.headbutt.recoilFactor;
          const ai = internal?.get(a.sessionId);
          if (ai) {
            ai.lastAttackerSid = b.sessionId;
            ai.lastAttackTimeMs = Date.now();
          }
        } else {
          a.vx -= nx * force * ratioA;
          a.vz -= nz * force * ratioA;
          b.vx += nx * force * ratioB;
          b.vz += nz * force * ratioB;
        }
      }
    }
  }
}

/**
 * Falloff check using the authoritative ArenaSim fragment layout.
 * A player falls if they're NOT on any alive fragment (including immune center).
 */
export function checkFalloff(
  players: PlayerSchema[],
  internal: Map<string, InternalLike>,
  isOnArena: (x: number, z: number) => boolean,
): void {
  for (const p of players) {
    if (!p.alive || p.falling || p.immunityTimer > 0) continue;
    if (!isOnArena(p.x, p.z)) {
      p.falling = true;
      p.lives -= 1;
      const data = internal.get(p.sessionId);
      if (data) data.respawnTimer = SIM.lives.respawnDelay;
    }
  }
}

/**
 * Result of one updateFalling tick. `toRespawn` is the list of
 * sessionIds the caller must respawn into the arena. `deaths` is the
 * list of "finished" players this tick (their last life fell), with
 * the sessionId of the last attacker tracked — the caller uses this
 * to credit the Online Belts Slayer Belt.
 */
export interface FallTickResult {
  toRespawn: string[];
  deaths: Array<{ victimSid: string; attackerSid: string | null }>;
}

/**
 * Advance falling animation + respawn countdown. Returns the sessionIds
 * that should respawn + the list of players that died this tick
 * (lives hit 0 after falling). Deaths carry `attackerSid` drawn from
 * lastAttackerSid if it's fresh (≤ ATTACKER_STALE_MS).
 */
export function updateFalling(
  players: PlayerSchema[],
  internal: Map<string, InternalLike>,
  dt: number,
): FallTickResult {
  const toRespawn: string[] = [];
  const deaths: FallTickResult['deaths'] = [];
  const now = Date.now();
  for (const p of players) {
    if (!p.falling) continue;
    p.fallY -= SIM.lives.fallSpeed * dt;
    const data = internal.get(p.sessionId);
    if (!data) continue;
    data.respawnTimer -= dt;
    if (data.respawnTimer <= 0) {
      if (p.lives > 0) {
        toRespawn.push(p.sessionId);
      } else {
        p.alive = false;
        p.falling = false;
        // Credit the last attacker iff the hit was recent — stale
        // attackers (dropped off before the last hit, friendly fire
        // long ago, …) don't count.
        let attackerSid: string | null = null;
        if (
          data.lastAttackerSid &&
          data.lastAttackTimeMs !== undefined &&
          now - data.lastAttackTimeMs <= ATTACKER_STALE_MS
        ) {
          attackerSid = data.lastAttackerSid;
        }
        deaths.push({ victimSid: p.sessionId, attackerSid });
      }
    }
  }
  return { toRespawn, deaths };
}

/** Effective mass = base mass × active buff multipliers (per-kit overrides). */
export function effectiveMass(p: PlayerSchema): number {
  let m = getCritterConfig(p.critterName).mass;
  const kit = getAbilityKit(p.critterName);
  for (let i = 0; i < p.abilities.length; i++) {
    const a = p.abilities[i];
    const def = kit[i];
    if (!def || !a.active || a.windUpLeft > 0) continue;
    if (a.abilityType === 'charge_rush') {
      m *= def.massMultiplier ?? SIM.chargeRush.massMultiplier;
    } else if (a.abilityType === 'frenzy') {
      m *= def.frenzyMassMult ?? SIM.frenzy.massMultiplier;
    }
  }
  return m;
}

/**
 * Effective speed = base speed × active ability multipliers × any
 * lingering slow zones the player is standing inside.
 *
 * Phase rules per ability slot:
 *   · windUp phase: multiplier = `def.slowDuringWindUp` (defaults to
 *     1.0 — only K/blink set this to 0 for the rooted feel).
 *   · active phase, charge_rush: `def.speedMultiplier` (the dash
 *     boost — unchanged behaviour).
 *   · active phase, frenzy: `def.frenzySpeedMult` (the buff —
 *     unchanged behaviour).
 *   · active phase, ground_pound / blink: `def.slowDuringActive`
 *     (defaults 1.0; K abilities set 0 to root through the slam).
 *
 * Zones (Kermit Poison Cloud, Kowalski Arctic Burst) live in
 * BrawlRoom and are passed in via `activeZones`. They stack
 * multiplicatively when overlapping.
 */
export interface ActiveZoneSnapshot {
  x: number;
  z: number;
  radius: number;
  slowMultiplier: number;
}

export function effectiveSpeed(p: PlayerSchema, activeZones: readonly ActiveZoneSnapshot[] = []): number {
  let s = getCritterConfig(p.critterName).speed;
  const kit = getAbilityKit(p.critterName);
  for (let i = 0; i < p.abilities.length; i++) {
    const a = p.abilities[i];
    const def = kit[i];
    if (!def || !a.active) continue;
    if (a.windUpLeft > 0) {
      // Wind-up phase: slowDuringWindUp (default 1.0 — no slow).
      if (def.slowDuringWindUp !== undefined) s *= def.slowDuringWindUp;
      continue;
    }
    // Active phase
    if (a.abilityType === 'charge_rush') {
      s *= def.speedMultiplier ?? SIM.chargeRush.speedMultiplier;
    } else if (a.abilityType === 'frenzy') {
      s *= def.frenzySpeedMult ?? SIM.frenzy.speedMultiplier;
    } else if (def.slowDuringActive !== undefined) {
      // ground_pound / blink — root or near-root during active window
      s *= def.slowDuringActive;
    }
  }
  // Lingering slow zones — apply once per zone the point is inside.
  for (const zone of activeZones) {
    const dx = p.x - zone.x;
    const dz = p.z - zone.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) {
      s *= zone.slowMultiplier;
    }
  }
  return s;
}
