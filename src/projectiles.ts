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
import { spawnDustPuff } from './dust-puff';
import { triggerCameraShake, applyImpactFeedback, FEEL } from './gamefeel';
import { play as playSound } from './audio';

interface ActiveProjectile {
  id: number | null; // null for offline (no server id), number for online
  ownerCritterName: string;
  ownerSid: string | null; // null offline; sessionId online (so we skip owner in collision)
  x: number;
  z: number;
  vx: number;
  vz: number;
  ttl: number;
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
  mesh.position.set(args.x, 0.7, args.z);
  scene.add(mesh);
  activeProjectiles.push({
    id, ownerCritterName: args.ownerCritterName, ownerSid: null,
    x: args.x, z: args.z, vx: args.vx, vz: args.vz,
    ttl: args.ttl, radius: args.radius,
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
  mesh.position.set(args.x, 0.7, args.z);
  scene.add(mesh);
  activeProjectiles.push({
    id: args.id, ownerCritterName: args.ownerCritterName, ownerSid: args.ownerSid,
    x: args.x, z: args.z, vx: args.vx, vz: args.vz,
    ttl: args.ttl, radius: args.radius,
    impulse: 0, slowDuration: 0,
    mesh, serverAuthoritative: true,
  });
  playSound('abilityFire');
}

/** Remove a tracked projectile by id. `withImpact` = true spawns the
 *  impact VFX (dust burst + small shake) at the projectile's last
 *  position; called from the online `projectileHit` handler so the
 *  victim's reaction reads the same as offline. */
export function removeProjectile(id: number, withImpact = false): void {
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const pr = activeProjectiles[i];
    if (pr.id !== id) continue;
    if (withImpact) {
      // Mini snow burst at last position
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        spawnDustPuff(pr.mesh.parent as THREE.Scene, pr.x + Math.cos(a) * 0.4, 0, pr.z + Math.sin(a) * 0.4);
      }
      triggerCameraShake(FEEL.shake.headbutt * 0.45);
      playSound('headbuttHit');
    }
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

/**
 * Per-frame tick:
 *   · integrate position
 *   · advance ttl
 *   · OFFLINE only: sweep against each alive non-owner critter, apply
 *     knockback + critter.slowTimer on hit, despawn with impact VFX
 *   · expire on ttl ≤ 0 with a soft puff
 * Called from main.ts after physics.
 */
export function tickProjectiles(
  dt: number,
  allCritters: Critter[],
): void {
  for (let i = activeProjectiles.length - 1; i >= 0; i--) {
    const pr = activeProjectiles[i];
    pr.x += pr.vx * dt;
    pr.z += pr.vz * dt;
    pr.ttl -= dt;
    pr.mesh.position.set(pr.x, 0.7, pr.z);
    pr.mesh.rotation.x += dt * 8; // tumble for snowball read
    pr.mesh.rotation.z += dt * 6;

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
      hit.vx += (pr.vx / speedMag) * pr.impulse;
      hit.vz += (pr.vz / speedMag) * pr.impulse;
      hit.slowTimer = Math.max(hit.slowTimer, pr.slowDuration);
      applyImpactFeedback(hit);
      // Mini snow burst at impact
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        spawnDustPuff(pr.mesh.parent as THREE.Scene, pr.x + Math.cos(a) * 0.4, 0, pr.z + Math.sin(a) * 0.4);
      }
      triggerCameraShake(FEEL.shake.headbutt * 0.45);
      playSound('headbuttHit');
      pr.mesh.parent?.remove(pr.mesh);
      (pr.mesh.material as THREE.Material).dispose();
      activeProjectiles.splice(i, 1);
      continue;
    }
    if (pr.ttl <= 0) {
      // Soft expire — small puff so it doesn't just vanish
      spawnDustPuff(pr.mesh.parent as THREE.Scene, pr.x, 0, pr.z);
      pr.mesh.parent?.remove(pr.mesh);
      (pr.mesh.material as THREE.Material).dispose();
      activeProjectiles.splice(i, 1);
    }
  }
}
