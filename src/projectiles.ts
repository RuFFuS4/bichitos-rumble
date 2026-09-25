// ---------------------------------------------------------------------------
// Projectiles — client-side entity system (Kowalski Snowball, 2026-04-29)
// ---------------------------------------------------------------------------
//
// Two roles:
//   1. Offline matches: spawn from `fireProjectile` in abilities.ts,
//      tick() integrates position + sweeps collision + applies hit
//      effects directly on the local Critter array.
//   2. Online matches: server broadcasts `projectileSpawned` →
//      `pushNetworkProjectile` registers it locally for visual-only
//      tracking. Collision is server-authoritative; tick() still
//      runs to advance the visual mesh, but the `onHit` callback is
//      replaced with a no-op (the server's `projectileHit` event
//      removes it via `removeProjectile(id)`).
//
// Each projectile owns its own mesh (shared sphere geometry, per-instance
// emissive material so the colour can vary per-critter later). The mesh
// is parented to the gameplay scene at spawn and disposed on despawn.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { Critter } from './critter';
import { triggerCameraShake, triggerHitStop, applyImpactFeedback, createFrozenFrameGate, FEEL } from './gamefeel';
import { play as playSound } from './audio';
import { getCritterVfxPalette } from './abilities';
import { spawnShockwaveRing } from './abilities-vfx';

/** Radius (u) of the ring where a projectile hits someone, and of the
 *  smaller one where it melts at the end of its range. */
const HIT_RING_RADIUS = 1.2;
const EXPIRE_RING_RADIUS = 0.7;
/** Height the ball flies at (visual). */
const SNOWBALL_Y = 0.7;

interface ActiveProjectile {
  id: number | null; // null for offline (no server id), number for online
  ownerCritterName: string;
  ownerSid: string | null; // null offline; sessionId online (so we skip owner in collision)
  x: number;
  z: number;
  vx: number;
  vz: number;
  ttl: number;
  /** x / z / ttl before the newest sim step (snapshotProjectiles): the
   *  mesh is drawn between the two (presentProjectiles). */
  prevX: number;
  prevZ: number;
  prevTtl: number;
  /** ttl at birth: the flight time, ttl0 − ttl, drives the tumble. */
  ttl0: number;
  radius: number;
  impulse: number;
  slowDuration: number;
  mesh: THREE.Mesh;
  /** Online-only flag — true while a server-authoritative projectile
   *  is in flight. The local sweep is skipped for these (server
   *  decides hits); the mesh just integrates so motion looks right
   *  during the round-trip latency. */
  serverAuthoritative: boolean;
}

const activeProjectiles: ActiveProjectile[] = [];
let offlineCounter = 0;

// Shared geometry — cheap to instance, expensive to dispose; we keep it
// alive for the whole session.
const SNOWBALL_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);

function makeSnowballMesh(radius: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xeaf6ff,
    emissive: 0x88c1ff,
    emissiveIntensity: 0.45,
    roughness: 0.6,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(SNOWBALL_GEOMETRY, mat);
  mesh.scale.setScalar(radius);
  return mesh;
}

/** Spawn an offline (locally simulated) projectile. Returns the id so
 *  callers can cross-reference if they want to. */
export function spawnLocalProjectile(
  scene: THREE.Scene,
  args: {
    ownerCritterName: string;
    x: number;
    z: number;
    vx: number;
    vz: number;
    ttl: number;
    radius: number;
    impulse: number;
    slowDuration: number;
  },
): number {
  offlineCounter++;
  const id = -offlineCounter; // negative id space → no clash with server ids
  const mesh = makeSnowballMesh(args.radius);
  mesh.position.set(args.x, SNOWBALL_Y, args.z);
  scene.add(mesh);
  activeProjectiles.push({
    id, ownerCritterName: args.ownerCritterName, ownerSid: null,
    x: args.x, z: args.z, vx: args.vx, vz: args.vz,
    ttl: args.ttl, prevX: args.x, prevZ: args.z, prevTtl: args.ttl, ttl0: args.ttl,
    radius: args.radius,
    impulse: args.impulse, slowDuration: args.slowDuration,
    mesh, serverAuthoritative: false,
  });
  playSound('abilityFire');
  return id;
}

/** Register a server-broadcast projectile for visual mirroring. Server
 *  is authoritative for collision — client integration is purely
 *  cosmetic so the snowball moves smoothly between state patches.
 *  Caller passes synthetic visuals (knockback / slow) only via the
 *  `projectileHit` event, which calls `removeProjectile(id, true)`. */
export function pushNetworkProjectile(
  scene: THREE.Scene,
  args: {
    id: number;
    ownerSid: string;
    ownerCritterName: string;
    x: number;
    z: number;
    vx: number;
    vz: number;
    ttl: number;
    radius: number;
  },
): void {
  const mesh = makeSnowballMesh(args.radius);
  mesh.position.set(args.x, SNOWBALL_Y, args.z);
  scene.add(mesh);
  activeProjectiles.push({
    id: args.id, ownerCritterName: args.ownerCritterName, ownerSid: args.ownerSid,
    x: args.x, z: args.z, vx: args.vx, vz: args.vz,
    ttl: args.ttl, prevX: args.x, prevZ: args.z, prevTtl: args.ttl, ttl0: args.ttl,
    radius: args.radius,
    impulse: 0, slowDuration: 0,
    mesh, serverAuthoritative: true,
  });
  playSound('abilityFire');
}

/**
 * Where a projectile hits someone (`hit`) or melts at the end of its
 * range: a ring in its thrower's projectile palette, Kowalski's snow
 * (2026-09-24; it used to leave beige ground dust, and a ball thrown
 * from under 2 u never showed). A hit also shakes and thuds. Shared by
 * the offline sweep and the online `projectileHit` handler.
 */
function spawnProjectileBurst(pr: ActiveProjectile, hit: boolean): void {
  const scene = pr.mesh.parent as THREE.Scene | null;
  if (!scene) return;
  const palette = getCritterVfxPalette(pr.ownerCritterName)?.projectile;
  spawnShockwaveRing(scene, pr.x, pr.z, hit ? HIT_RING_RADIUS : EXPIRE_RING_RADIUS, palette);
  if (hit) {
    triggerCameraShake(FEEL.shake.headbutt * 0.45);
    playSound('headbuttHit');
  }
}

/** Remove a tracked projectile by id. `withImpact` = true spawns the
 *  impact VFX (spawnProjectileBurst) at the projectile's last position;
 *  called from the online `projectileHit` handler so the victim's
 *  reaction reads the same as offline. */
export function removeProjectile(id: number, withImpact = false): void {
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const pr = activeProjectiles[i];
    if (pr.id !== id) continue;
    if (withImpact) spawnProjectileBurst(pr, true);
    pr.mesh.parent?.remove(pr.mesh);
    (pr.mesh.material as THREE.Material).dispose();
    activeProjectiles.splice(i, 1);
    return;
  }
}

/** Clear all in-flight projectiles. Used on phase transitions
 *  (match restart, return to title) so a stray spawn doesn't survive
 *  into the next match. */
export function clearProjectiles(): void {
  for (const pr of activeProjectiles) {
    pr.mesh.parent?.remove(pr.mesh);
    (pr.mesh.material as THREE.Material).dispose();
  }
  activeProjectiles.length = 0;
}

/** Before every sim step (paused and frozen ones too, so a still ball
 *  draws still): where each ball stands, for presentProjectiles. */
export function snapshotProjectiles(): void {
  for (const pr of activeProjectiles) {
    pr.prevX = pr.x;
    pr.prevZ = pr.z;
    pr.prevTtl = pr.ttl;
  }
}

/** Once per rendered frame: each ball drawn between its last two sim
 *  positions (`alpha`, as the critters), tumbling by its flight time — it
 *  stops with the flight on hit stop and pause. Online and the lab pass 1. */
export function presentProjectiles(alpha: number): void {
  for (const pr of activeProjectiles) {
    pr.mesh.position.set(pr.prevX + (pr.x - pr.prevX) * alpha, SNOWBALL_Y, pr.prevZ + (pr.z - pr.prevZ) * alpha);
    const flight = pr.ttl0 - (pr.prevTtl + (pr.ttl - pr.prevTtl) * alpha);
    pr.mesh.rotation.x = flight * FEEL.snowball.tumbleX;
    pr.mesh.rotation.z = flight * FEEL.snowball.tumbleZ;
  }
}

/**
 * Per sim step (tickSharedSimulation):
 *   · integrate position
 *   · advance ttl
 *   · OFFLINE only: sweep against each alive non-owner critter, apply
 *     knockback + critter.slowTimer on hit, despawn with impact VFX
 *   · expire on ttl ≤ 0 with a soft puff
 * The mesh is presentProjectiles'. Skipped on hit-stop steps: a snowball
 * doesn't fly on while the world is frozen.
 */
const projectilesFrozen = createFrozenFrameGate();
export function tickProjectiles(
  dt: number,
  allCritters: Critter[],
): void {
  if (projectilesFrozen()) return;
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const pr = activeProjectiles[i];
    pr.x += pr.vx * dt;
    pr.z += pr.vz * dt;
    pr.ttl -= dt;

    // Server-authoritative: skip local hit detection, server drives
    // removal via removeProjectile(id) on `projectileHit`.
    if (pr.serverAuthoritative) {
      // TTL is still advanced so a network-dropped despawn doesn't
      // leave the mesh dangling forever. With a small buffer past
      // the server ttl, the local mesh expires gracefully.
      if (pr.ttl <= -0.5) {
        pr.mesh.parent?.remove(pr.mesh);
        (pr.mesh.material as THREE.Material).dispose();
        activeProjectiles.splice(i, 1);
      }
      continue;
    }

    // Offline path: sweep + apply on hit.
    let hit: Critter | null = null;
    for (const c of allCritters) {
      if (!c.alive || c.falling || c.isImmune) continue;
      if (c.config.name === pr.ownerCritterName) continue; // skip owner
      const dx = c.x - pr.x;
      const dz = c.z - pr.z;
      const reach = pr.radius + c.radius;
      if (dx * dx + dz * dz <= reach * reach) {
        hit = c;
        break;
      }
    }
    if (hit) {
      const speedMag = Math.sqrt(pr.vx * pr.vx + pr.vz * pr.vz) || 1;
      const impulse = pr.impulse * hit.knockbackScale;
      hit.vx += (pr.vx / speedMag) * impulse;
      hit.vz += (pr.vz / speedMag) * impulse;
      hit.slowTimer = Math.max(hit.slowTimer, pr.slowDuration);
      applyImpactFeedback(hit, pr.vx, pr.vz);
      spawnProjectileBurst(pr, true);
      // The ability hit stop, offline only: online nothing freezes.
      triggerHitStop(FEEL.hitStop.ability);
      pr.mesh.parent?.remove(pr.mesh);
      (pr.mesh.material as THREE.Material).dispose();
      activeProjectiles.splice(i, 1);
      continue;
    }
    if (pr.ttl <= 0) {
      // Soft expire — a small ring so it doesn't just vanish
      spawnProjectileBurst(pr, false);
      pr.mesh.parent?.remove(pr.mesh);
      (pr.mesh.material as THREE.Material).dispose();
      activeProjectiles.splice(i, 1);
    }
  }
}
