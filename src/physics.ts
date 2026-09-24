import { Critter } from './critter';
import { Arena } from './arena';
import type { AbilityState } from './abilities';
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

/** The critter's dash (J, charge_rush) while it is in its active window. */
function activeDash(c: Critter): AbilityState | undefined {
  return c.abilityStates.find((s) => s.active && s.windUpLeft <= 0 && s.def.type === 'charge_rush');
}

/** True while the critter's dash goes through others (Kurama's Fox Dash). */
function isPhasing(c: Critter): boolean {
  return activeDash(c)?.def.dashPhaseThrough === true;
}

/** Raw headbutt force of a critter, before the mass split. */
function headbuttForceOf(c: Critter): number {
  return c.config.headbuttForce * FEEL.collision.headbuttMultiplier * (c.config.headbuttBoost ?? 1.0);
}

/**
 * A dash's first contact with `victim` this activation, `victim` lying
 * along (dirX, dirZ) from the rusher: marks it in `AbilityState.rammed`
 * and returns the dash's `dashHitForce` (0 = the plain nudge). Null when
 * it doesn't count: no dash in its active window, the victim was already
 * hit, or it lies outside `dashHitArcDeg` of the rusher's facing (then it
 * isn't used up either). Server mirror: takeDashContact in
 * server/src/sim/abilities.ts.
 */
function takeDashContact(rusher: Critter, victim: Critter, dirX: number, dirZ: number): number | null {
  const s = activeDash(rusher);
  if (!s || s.rammed.has(victim)) return null;
  const arc = s.def.dashHitArcDeg;
  if (arc !== undefined) {
    const facing = rusher.mesh.rotation.y;
    if (dirX * Math.sin(facing) + dirZ * Math.cos(facing) < Math.cos((arc * Math.PI) / 180)) return null;
  }
  s.rammed.add(victim);
  return s.def.dashHitForce ?? 0;
}

/**
 * A dash (J) that runs into someone hits, once per victim per activation:
 * its `dashHitForce` on top of the nudge, × `share` (the victim's mass
 * share, stun vulnerability and knockbackScale, as for a headbutt), with
 * a short hit stop.
 * Every counted contact reads as a hit — the victim flashes and leans
 * away, the headbutt hit sounds and the camera shakes like a dash — even
 * for a dash with no force. Offline only: online the server resolves
 * collisions.
 */
function rushContact(rusher: Critter, victim: Critter, dirX: number, dirZ: number, share: number): void {
  const force = takeDashContact(rusher, victim, dirX, dirZ);
  if (force === null) return;
  if (force > 0) {
    victim.vx += dirX * force * share;
    victim.vz += dirZ * force * share;
    triggerHitStop(FEEL.hitStop.dashHit);
  }
  applyImpactFeedback(victim, dirX, dirZ);
  playSound('headbuttHit');
  triggerCameraShake(FEEL.shake.chargeRush);
}

/** The attacker takes `force` back along (dirX, dirZ), with a hit's feedback. */
function reflectOff(attacker: Critter, dirX: number, dirZ: number, force: number, hitStop: number, shake: number): void {
  attacker.vx += dirX * force;
  attacker.vz += dirZ * force;
  triggerHitStop(hitStop);
  triggerCameraShake(shake);
  applyImpactFeedback(attacker, dirX, dirZ);
  playSound('headbuttHit');
}

/**
 * `other` runs into an anchored critter (Shelly Steel Shell); (dirX,
 * dirZ) points from the anchored one to `other`, who takes everything.
 * 2026-08-24 balance v2 — shell reflect (mecánica de la cola de
 * BALANCE.md): headbuttear a un critter anclado te DEVUELVE tu propio
 * golpe escalado por shellReflectFactor. Pegarle al tanque enconchado
 * duele — la debilidad estructural (no puede escapar) se convierte en
 * amenaza. A dash's hit comes back the same way, once per activation.
 * 2026-04-29 K-refinement — anything else is a small bounce, so running
 * into her reads as "rebote" instead of "nada pasa".
 */
function hitAnchored(anchored: Critter, other: Critter, dirX: number, dirZ: number): void {
  // What comes back is a push `other` takes: × its knockbackScale.
  const taken = other.knockbackScale;
  const reflect = FEEL.collision.shellReflectFactor * taken;
  if (other.isHeadbutting) {
    reflectOff(other, dirX, dirZ, headbuttForceOf(other) * reflect, FEEL.hitStop.headbutt, FEEL.shake.headbutt);
    return;
  }
  const dashHit = takeDashContact(other, anchored, -dirX, -dirZ);
  if (dashHit) {
    reflectOff(other, dirX, dirZ, dashHit * reflect, FEEL.hitStop.dashHit, FEEL.shake.chargeRush);
    return;
  }
  const bounce = FEEL.collision.normalPushForce * FEEL.collision.anchoredBounceFactor * taken;
  other.vx += dirX * bounce;
  other.vz += dirZ * bounce;
}

/** Check and resolve collisions between all critters. */
export function resolveCollisions(critters: Critter[]): void {
  for (let i = 0; i < critters.length; i++) {
    const a = critters[i];
    if (!a.alive || a.falling) continue;
    for (let j = i + 1; j < critters.length; j++) {
      const b = critters[j];
      if (!b.alive || b.falling) continue;
      // A dash that phases (Kurama's feint) goes straight through: no
      // separation, no push, no hit either way.
      if (isPhasing(a) || isPhasing(b)) continue;

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

        // 2026-04-29 K-refinement — Steel Shell. If exactly one critter
        // is anchored (Shelly during Steel Shell), the OTHER bounces off
        // or takes its own hit back (hitAnchored).
        const aAnchored = isAnchoredCritter(a);
        const bAnchored = isAnchoredCritter(b);
        if (aAnchored && !bAnchored) { hitAnchored(a, b, nx, nz); continue; }
        if (bAnchored && !aAnchored) { hitAnchored(b, a, -nx, -nz); continue; }

        // No knockback during immunity — only separation
        if (eitherImmune) continue;

        // Knockback force — reads from centralized FEEL config.
        // v0.11: per-critter `headbuttBoost` multiplies BOTH the
        // raw force (more knockback on the target) and the camera
        // shake amplitude (more punch on the screen). Default 1.0 →
        // unchanged for the critters Rafa marked as OK; >1 for
        // Sergei / Kowalski / Cheeto / Sebastian.
        let force: number = FEEL.collision.normalPushForce;
        let boost = 1.0;
        if (a.isHeadbutting) {
          boost = a.config.headbuttBoost ?? 1.0;
          force = headbuttForceOf(a);
        } else if (b.isHeadbutting) {
          boost = b.config.headbuttBoost ?? 1.0;
          force = headbuttForceOf(b);
        }

        const massRatioA = b.effectiveMass / (a.effectiveMass + b.effectiveMass);
        const massRatioB = a.effectiveMass / (a.effectiveMass + b.effectiveMass);

        // 2026-05-01 final — Trunk Grip / Slam vulnerability boost on
        // the stunned side (value in FEEL.collision.stunnedVulnerability;
        // was ×2 in earlier passes). Trunk's L now leaves a target
        // stunned for 5 s and a follow-up headbutt should send them
        // flying, so we crank the modifier. Currently only Trunk
        // (Slam K + Grip L) writes `stunTimer > 0`; safe to bump
        // globally without affecting other critters' tunings.
        // × each side's knockbackScale (Sergei's Frenzy), recoil included.
        const aVuln = (a.stunTimer > 0 ? FEEL.collision.stunnedVulnerability : 1) * a.knockbackScale;
        const bVuln = (b.stunTimer > 0 ? FEEL.collision.stunnedVulnerability : 1) * b.knockbackScale;
        if (a.isHeadbutting) {
          b.vx += nx * force * massRatioB * bVuln;
          b.vz += nz * force * massRatioB * bVuln;
          a.vx -= nx * force * FEEL.headbutt.recoilFactor * aVuln;
          a.vz -= nz * force * FEEL.headbutt.recoilFactor * aVuln;
          triggerHitStop(FEEL.hitStop.headbutt);
          triggerCameraShake(FEEL.shake.headbutt * boost);
          applyImpactFeedback(b, nx, nz);
          playSound('headbuttHit');
          // Badge aggregation: count the hit on the receiver. Used by
          // Untouchable / Pain Tolerance evaluation via recordWin().
          b.matchStats.hitsReceived++;
          // 2026-04-30 final-L — Copycat last-hit tracking offline.
          if (a.config.name === 'Kurama') a.lastHitTargetCritter = b.config.name;
        } else if (b.isHeadbutting) {
          a.vx -= nx * force * massRatioA * aVuln;
          a.vz -= nz * force * massRatioA * aVuln;
          b.vx += nx * force * FEEL.headbutt.recoilFactor * bVuln;
          b.vz += nz * force * FEEL.headbutt.recoilFactor * bVuln;
          triggerHitStop(FEEL.hitStop.headbutt);
          triggerCameraShake(FEEL.shake.headbutt * boost);
          applyImpactFeedback(a, -nx, -nz);
          playSound('headbuttHit');
          a.matchStats.hitsReceived++;
          if (b.config.name === 'Kurama') b.lastHitTargetCritter = a.config.name;
        } else {
          // Normal collision — gentle nudge
          a.vx -= nx * force * massRatioA * aVuln;
          a.vz -= nz * force * massRatioA * aVuln;
          b.vx += nx * force * massRatioB * bVuln;
          b.vz += nz * force * massRatioB * bVuln;
          // A dash that runs into someone hits (once per victim).
          rushContact(a, b, nx, nz, massRatioB * bVuln);
          rushContact(b, a, -nx, -nz, massRatioA * aVuln);
        }
      }
    }
  }
}

/** True while a self-buff K (Steel Shell, Mirror Trick) is past its
 *  wind-up: the immunity it writes shields from pushes, not from the
 *  floor vanishing under the critter. */
function hasSelfBuffActive(c: Critter): boolean {
  return c.abilityStates.some((s) => s.active && s.windUpLeft <= 0 && s.def.selfBuffOnly === true);
}

/** Check if critters have fallen off the arena. Starts falling state.
 *  Immunity keeps a critter over the void only as the respawn grace:
 *  under a self-buff it falls like anyone (Rafa 2026-09-24: Shelly «se
 *  cae si la baldosa desaparece»). A buff cast during the grace takes
 *  over from it. Server mirror: checkFalloff in server/src/sim/physics.ts. */
export function checkFalloff(critters: Critter[], arena: Arena): void {
  for (const c of critters) {
    if (!c.alive || c.falling) continue;
    if (c.isImmune && !hasSelfBuffActive(c)) continue;
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
