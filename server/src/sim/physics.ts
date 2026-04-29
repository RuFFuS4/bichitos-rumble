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

        // 2026-04-29 K-refinement — mass-aware separation. With
        // Shelly Steel Shell setting effectiveMass to ~base*9999,
        // the anchored critter receives ~0 of the displacement and
        // the attacker takes the full overlap → "Shelly clavada,
        // los demás rebotan al chocarla" exactly as Rafa asked.
        // Equal masses fall back to legacy 50/50 split.
        const massAforSep = effectiveMass(a);
        const massBforSep = effectiveMass(b);
        const totalMass = massAforSep + massBforSep;
        const aShare = massBforSep / totalMass;
        const bShare = massAforSep / totalMass;
        const totalOverlap = minDist - dist;
        a.x -= nx * totalOverlap * aShare;
        a.z -= nz * totalOverlap * aShare;
        b.x += nx * totalOverlap * bShare;
        b.z += nz * totalOverlap * bShare;

        // 2026-04-29 K-refinement — Steel Shell bounce. If exactly
        // one side is `selfAnchorWhileBuffed`-active (Shelly only),
        // the OTHER side receives a small velocity bounce away even
        // though the anchored side is immune. Stops the legacy
        // "running into Shelly does nothing" behaviour Rafa flagged.
        const aAnchored = isAnchored(a);
        const bAnchored = isAnchored(b);
        const BOUNCE = SIM.collision.normalPushForce * 1.4;
        if (aAnchored && !bAnchored) {
          b.vx += nx * BOUNCE;
          b.vz += nz * BOUNCE;
          continue;
        }
        if (bAnchored && !aAnchored) {
          a.vx -= nx * BOUNCE;
          a.vz -= nz * BOUNCE;
          continue;
        }

        if (eitherImmune) continue;

        const massA = massAforSep;
        const massB = massBforSep;

        // Knockback force — headbutt multiplies, plus per-critter
        // headbuttBoost (v0.11) for the characters Rafa marked
        // "needs more punch": Sergei 1.15, Kowalski 1.20, Cheeto
        // 1.30, Sebastian 1.45. Defaults 1.0 (other critters
        // unchanged).
        let force = SIM.collision.normalPushForce;
        if (a.isHeadbutting) {
          const boost = aCfg.headbuttBoost ?? 1.0;
          force = aCfg.headbuttForce * SIM.collision.headbuttMultiplier * boost;
        } else if (b.isHeadbutting) {
          const boost = bCfg.headbuttBoost ?? 1.0;
          force = bCfg.headbuttForce * SIM.collision.headbuttMultiplier * boost;
        }

        const ratioA = massB / (massA + massB);
        const ratioB = massA / (massA + massB);

        // 2026-04-29 — Trunk Grip vulnerability ×2 knockback
        // multiplier on whichever side is currently stunned.
        const aVulnMul = a.stunTimer > 0 ? 2 : 1;
        const bVulnMul = b.stunTimer > 0 ? 2 : 1;
        if (a.isHeadbutting) {
          b.vx += nx * force * ratioB * bVulnMul;
          b.vz += nz * force * ratioB * bVulnMul;
          a.vx -= nx * force * SIM.headbutt.recoilFactor * aVulnMul;
          a.vz -= nz * force * SIM.headbutt.recoilFactor * aVulnMul;
          // Credit: A hit B. If B falls in the next ATTACKER_STALE_MS
          // window, A gets the kill.
          const bi = internal?.get(b.sessionId);
          if (bi) {
            bi.lastAttackerSid = a.sessionId;
            bi.lastAttackTimeMs = Date.now();
          }
        } else if (b.isHeadbutting) {
          a.vx -= nx * force * ratioA * aVulnMul;
          a.vz -= nz * force * ratioA * aVulnMul;
          b.vx += nx * force * SIM.headbutt.recoilFactor * bVulnMul;
          b.vz += nz * force * SIM.headbutt.recoilFactor * bVulnMul;
          const ai = internal?.get(a.sessionId);
          if (ai) {
            ai.lastAttackerSid = b.sessionId;
            ai.lastAttackTimeMs = Date.now();
          }
        } else {
          a.vx -= nx * force * ratioA * aVulnMul;
          a.vz -= nz * force * ratioA * aVulnMul;
          b.vx += nx * force * ratioB * bVulnMul;
          b.vz += nz * force * ratioB * bVulnMul;
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

/**
 * True if the player is currently anchored by an active K with
 * `selfAnchorWhileBuffed: true` (Shelly Steel Shell). Used by
 * `resolveCollisions` to decide whether running into them should
 * bounce the attacker away.
 */
export function isAnchored(p: PlayerSchema): boolean {
  const kit = getAbilityKit(p.critterName);
  for (let i = 0; i < p.abilities.length; i++) {
    const a = p.abilities[i];
    const def = kit[i];
    if (!def || !a.active || a.windUpLeft > 0) continue;
    if (def.selfBuffOnly && def.selfAnchorWhileBuffed) return true;
  }
  return false;
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
    // 2026-04-29 K-refinement — Shelly Steel Shell physical anchor.
    // Massive mass multiplier so collision knockback shoves the
    // other critter and Shelly stays put.
    if (def.selfBuffOnly && def.selfAnchorWhileBuffed) {
      m *= 9999;
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
  /** Session id of the player who spawned the zone. Used so the
   *  caster doesn't get slowed by their own zone (Kermit walking
   *  through his own Poison Cloud, etc.). Optional — caller can
   *  omit for tests or generic snapshots. */
  ownerSid?: string;
}

export function effectiveSpeed(p: PlayerSchema, activeZones: readonly ActiveZoneSnapshot[] = []): number {
  // 2026-04-29 — Trunk Grip stun overrides everything: rooted.
  if (p.stunTimer > 0) return 0;
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
  // Skip zones owned by the player themselves so casters don't get
  // slowed by their own ground hazards (Kermit Poison Cloud etc.).
  for (const zone of activeZones) {
    if (zone.ownerSid !== undefined && zone.ownerSid === p.sessionId) continue;
    const dx = p.x - zone.x;
    const dz = p.z - zone.z;
    if (dx * dx + dz * dz <= zone.radius * zone.radius) {
      s *= zone.slowMultiplier;
    }
  }
  // 2026-04-29 — Hit-driven slow status (Kowalski Snowball impact).
  // Decremented in BrawlRoom each tick. While > 0 the player moves at
  // 50 % normal speed.
  if (p.slowTimer > 0) s *= 0.5;
  return s;
}
