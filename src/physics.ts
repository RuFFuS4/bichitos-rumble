import { Critter } from './critter';
import { Arena } from './arena';
import { triggerHitStop, applyImpactFeedback, triggerCameraShake, FEEL } from './gamefeel';
import { play as playSound } from './audio';

/**
 * True if the critter has an active K with `selfBuffOnly` AND
 * `selfAnchorWhileBuffed` set (Shelly Steel Shell only, right now).
 * Used by `resolveCollisions` to bounce the attacker instead of
 * skipping the knockback like the immunity path does.
 */
function isAnchoredCritter(c: Critter): boolean {
  for (const s of c.abilityStates) {
    if (!s.active || s.windUpLeft > 0) continue;
    if (s.def.selfBuffOnly && s.def.selfAnchorWhileBuffed) return true;
  }
  return false;
}

/** Check and resolve collisions between all critters. */
export function resolveCollisions(critters: Critter[]): void {
  for (let i = 0; i < critters.length; i++) {
    const a = critters[i];
    if (!a.alive || a.falling) continue;
    for (let j = i + 1; j < critters.length; j++) {
      const b = critters[j];
      if (!b.alive || b.falling) continue;

      // Skip knockback if either critter is immune (still separate overlap though)
      const eitherImmune = a.isImmune || b.isImmune;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const minDist = a.radius + b.radius;

      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist;
        const nz = dz / dist;

        // 2026-04-29 K-refinement — mass-aware separation so that a
        // Shelly under Steel Shell (anchor → effectiveMass × 9999)
        // doesn't budge while the attacker takes the full overlap.
        const massA = a.effectiveMass;
        const massB = b.effectiveMass;
        const totalMass = massA + massB;
        const aShare = massB / totalMass;
        const bShare = massA / totalMass;
        const totalOverlap = minDist - dist;
        a.x -= nx * totalOverlap * aShare;
        a.z -= nz * totalOverlap * aShare;
        b.x += nx * totalOverlap * bShare;
        b.z += nz * totalOverlap * bShare;

        // 2026-04-29 K-refinement — Steel Shell bounce. If exactly
        // one critter is anchored (Shelly during Steel Shell), the
        // OTHER receives a small velocity bounce so running into
        // her reads as "rebote" instead of "nada pasa".
        const aAnchored = isAnchoredCritter(a);
        const bAnchored = isAnchoredCritter(b);
        const BOUNCE = FEEL.collision.normalPushForce * 1.4;
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

        // No knockback during immunity — only separation
        if (eitherImmune) continue;

        // Knockback force — reads from centralized FEEL config.
        // v0.11: per-critter `headbuttBoost` multiplies BOTH the
        // raw force (more knockback on the target) and the camera
        // shake amplitude (more punch on the screen). Default 1.0 →
        // unchanged for the critters Rafa marked as OK; >1 for
        // Sergei / Kowalski / Cheeto / Sebastian.
        let force = FEEL.collision.normalPushForce;
        let boost = 1.0;
        if (a.isHeadbutting) {
          boost = a.config.headbuttBoost ?? 1.0;
          force = a.config.headbuttForce * FEEL.collision.headbuttMultiplier * boost;
        } else if (b.isHeadbutting) {
          boost = b.config.headbuttBoost ?? 1.0;
          force = b.config.headbuttForce * FEEL.collision.headbuttMultiplier * boost;
        }

        const massRatioA = b.effectiveMass / (a.effectiveMass + b.effectiveMass);
        const massRatioB = a.effectiveMass / (a.effectiveMass + b.effectiveMass);

        // 2026-04-29 — Trunk Grip vulnerability ×2 knockback on the stunned side.
        const aVuln = a.stunTimer > 0 ? 2 : 1;
        const bVuln = b.stunTimer > 0 ? 2 : 1;
        if (a.isHeadbutting) {
          b.vx += nx * force * massRatioB * bVuln;
          b.vz += nz * force * massRatioB * bVuln;
          a.vx -= nx * force * FEEL.headbutt.recoilFactor * aVuln;
          a.vz -= nz * force * FEEL.headbutt.recoilFactor * aVuln;
          triggerHitStop(FEEL.hitStop.headbutt);
          triggerCameraShake(FEEL.shake.headbutt * boost);
          applyImpactFeedback(b);
          playSound('headbuttHit');
          // Badge aggregation: count the hit on the receiver. Used by
          // Untouchable / Pain Tolerance evaluation via recordWin().
          b.matchStats.hitsReceived++;
        } else if (b.isHeadbutting) {
          a.vx -= nx * force * massRatioA * aVuln;
          a.vz -= nz * force * massRatioA * aVuln;
          b.vx += nx * force * FEEL.headbutt.recoilFactor * bVuln;
          b.vz += nz * force * FEEL.headbutt.recoilFactor * bVuln;
          triggerHitStop(FEEL.hitStop.headbutt);
          triggerCameraShake(FEEL.shake.headbutt * boost);
          applyImpactFeedback(a);
          playSound('headbuttHit');
          a.matchStats.hitsReceived++;
        } else {
          // Normal collision — gentle nudge
          a.vx -= nx * force * massRatioA * aVuln;
          a.vz -= nz * force * massRatioA * aVuln;
          b.vx += nx * force * massRatioB * bVuln;
          b.vz += nz * force * massRatioB * bVuln;
        }
      }
    }
  }
}

/** Check if critters have fallen off the arena. Starts falling state. */
export function checkFalloff(critters: Critter[], arena: Arena): void {
  for (const c of critters) {
    if (!c.alive || c.falling || c.isImmune) continue;
    if (!arena.isOnArena(c.x, c.z)) {
      c.startFalling();
    }
  }
}

/** Update falling critters — returns list of critters ready to respawn. */
export function updateFalling(critters: Critter[], dt: number): Critter[] {
  const readyToRespawn: Critter[] = [];
  for (const c of critters) {
    if (c.updateFalling(dt)) {
      readyToRespawn.push(c);
    }
  }
  return readyToRespawn;
}
