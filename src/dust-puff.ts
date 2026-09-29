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
  /** Duración (s), escala final y opacidad inicial: los del polvo son las
   *  constantes de arriba; el puf de desaparición trae los suyos. */
  duration: number;
  maxScale: number;
  opacity: number;
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
    duration: PUFF_DURATION,
    maxScale: PUFF_MAX_SCALE,
    opacity: 0.75,
    vx: velocity?.x ?? 0,
    vz: velocity?.z ?? 0,
  });
}

/** Una sola geometría para todos los pufs de desaparición: una bola de
 *  320 tris con la panza horneada en el color de vértice (cima 1, panza
 *  0,72), como las nubes; sin eso, sin luz, se leía como un disco plano. */
let vanishGeo: THREE.IcosahedronGeometry | null = null;
function getVanishGeometry(): THREE.IcosahedronGeometry {
  if (vanishGeo) return vanishGeo;
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.72 + 0.28 * (pos.getY(i) + 1) / 2;
    colors[i * 3] = k; colors[i * 3 + 1] = k; colors[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  vanishGeo = geo;
  return geo;
}

/**
 * Fondo v2, F4 (docs/DIORAMAS.md §7): el puf donde un bicho que cae
 * desaparece. «El cielo se lo traga»: una bola de nube del color del
 * bioma, en el punto exacto, que crece y se apaga. Mismo ciclo de vida
 * que el polvo (se avanza en `updateDustPuffs`).
 */
export function spawnVanishPuff(
  scene: THREE.Scene,
  x: number, y: number, z: number,
  color: number,
  opts: { radius: number; opacity: number; duration: number },
): void {
  const mat = new THREE.MeshBasicMaterial({
    color, vertexColors: true, transparent: true, opacity: opts.opacity, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(getVanishGeometry(), mat);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(0.35 * opts.radius);
  scene.add(mesh);
  activePuffs.push({
    mesh, age: 0, duration: opts.duration, maxScale: 1 / 0.35, opacity: opts.opacity, vx: 0, vz: 0,
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
    const t = p.age / p.duration;
    if (t >= 1) {
      disposePuff(p);
      activePuffs.splice(i, 1);
      continue;
    }
    // easeOutCubic — quick burst, slow fade. La escala se aplica sobre la
    // de nacimiento (el puf de desaparición nace ya a su tamaño base).
    const eased = 1 - Math.pow(1 - t, 3);
    const base = p.mesh.userData.baseScale ??= p.mesh.scale.x;
    p.mesh.scale.setScalar(base * (1 + eased * (p.maxScale - 1)));
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.opacity * (1 - t);
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
  for (const p of activePuffs) disposePuff(p);
  activePuffs.length = 0;
}

/** Suelta un puf. La geometría del de desaparición es compartida: no se
 *  libera. */
function disposePuff(p: ActivePuff): void {
  p.mesh.parent?.remove(p.mesh);
  if (p.mesh.geometry !== vanishGeo) p.mesh.geometry.dispose();
  (p.mesh.material as THREE.Material).dispose();
}
