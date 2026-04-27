// ---------------------------------------------------------------------------
// Ground-level dust puff VFX
// ---------------------------------------------------------------------------
//
// Lightweight expanding ring used for "something just hit the ground"
// moments — currently the pre-match drop-from-sky landing but reusable
// for future stomp / ground-slam effects (no caller lock-in).
//
// Each puff is one ring mesh with transparent material. They live in a
// module-level pool, aged each frame, and disposed when they fade out.
// Creating ~9 at once (one per critter landing) is trivial overhead.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

const PUFF_DURATION = 0.6;        // seconds to full fade
const PUFF_START_R_INNER = 0.25;
const PUFF_START_R_OUTER = 0.55;
const PUFF_MAX_SCALE = 3.2;
const PUFF_COLOR = 0xbca078;      // warm tan

interface ActivePuff {
  mesh: THREE.Mesh;
  age: number;
  /** Per-puff drift velocity in world units / s. Zero for legacy
   *  landing puffs (no drift, just radial scale-up). The dash trail
   *  passes a non-zero vector pointing AWAY from the critter so the
   *  ring visibly slides backward as the critter sprints forward. */
  vx: number;
  vz: number;
}

const activePuffs: ActivePuff[] = [];

/** Spawn a dust puff centred at (x, groundY, z). Caller provides the
 *  scene so the VFX module stays oblivious to game state.
 *
 *  Optional `velocity` adds a per-frame drift in world units / s. The
 *  charge-rush dash trail uses this to push each puff backward
 *  relative to the critter's motion, turning the radial ring puff
 *  into a directional streak that reinforces "the bichito went that
 *  way". `undefined` keeps the original radial-only behaviour. */
export function spawnDustPuff(
  scene: THREE.Scene,
  x: number,
  groundY: number,
  z: number,
  velocity?: { x: number; z: number },
): void {
  const geo = new THREE.RingGeometry(PUFF_START_R_INNER, PUFF_START_R_OUTER, 20);
  const mat = new THREE.MeshBasicMaterial({
    color: PUFF_COLOR,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  // Slight lift so the ring reads cleanly above the fragment face.
  mesh.position.set(x, groundY + 0.04, z);
  scene.add(mesh);
  activePuffs.push({
    mesh,
    age: 0,
    vx: velocity?.x ?? 0,
    vz: velocity?.z ?? 0,
  });
}

/**
 * Advance every live puff one frame. Handles scale-up + fade-out + disposal.
 * Call once per frame from the main loop regardless of game phase — no-op
 * when the pool is empty.
 */
export function updateDustPuffs(dt: number): void {
  for (let i = activePuffs.length - 1; i >= 0; i--) {
    const p = activePuffs[i];
    p.age += dt;
    const t = p.age / PUFF_DURATION;
    if (t >= 1) {
      p.mesh.parent?.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
      activePuffs.splice(i, 1);
      continue;
    }
    // easeOutCubic — quick burst, slow fade
    const eased = 1 - Math.pow(1 - t, 3);
    p.mesh.scale.setScalar(1 + eased * (PUFF_MAX_SCALE - 1));
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
    // Directional drift — only puffs spawned with a velocity vector
    // (the charge-rush trail) move; landing puffs stay put. Drift
    // decays linearly with age so each puff streaks then settles
    // instead of flying off to infinity.
    if (p.vx !== 0 || p.vz !== 0) {
      const driftFactor = 1 - t;
      p.mesh.position.x += p.vx * dt * driftFactor;
      p.mesh.position.z += p.vz * dt * driftFactor;
    }
  }
}

/** Clear every active puff (used on match teardown). */
export function clearDustPuffs(): void {
  for (const p of activePuffs) {
    p.mesh.parent?.remove(p.mesh);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
  }
  activePuffs.length = 0;
}
