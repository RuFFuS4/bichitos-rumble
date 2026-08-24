// ---------------------------------------------------------------------------
// abilities-vfx.ts — VFX (visual-only) layer of the abilities system.
// 2026-08-24 ROADMAP H4 split: "Split de abilities.ts (config/runtime/vfx)".
//
// THREE-only spawners: frenzy entry burst, Sebastian All-in trajectory
// preview, Kurama decoy clone, persistent zone rings and the shockwave
// ring. Every function here is fire-and-forget (self-animating via
// requestAnimationFrame, self-disposing) and writes NO gameplay state.
//
// Import rule (no cycles): may import types/palettes from ./abilities
// (config) only. Importing from ./abilities-runtime is FORBIDDEN.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { Critter } from './critter';
import type { ZoneVfxKind } from './abilities';

// ---------------------------------------------------------------------------
// VFX: frenzy activation burst
// ---------------------------------------------------------------------------

/**
 * Optional palette overrides for `spawnFrenzyBurst`. Both colours fall
 * back to the original gold-red battle-cry palette when omitted, so
 * existing call sites keep working without changes.
 */
export interface FrenzyBurstOpts {
  /** Outer ring colour. Default `0xffaa22` (warm gold). */
  color?: number;
  /** Inner flash colour. Default `0xff2200` (red pop). */
  secondary?: number;
}

/**
 * One-shot "battle cry" ring spawned at the moment Frenzy activates.
 * Smaller and more contained than a Shockwave ring — it's a self-centred
 * buff indicator, not an AoE hit. Two concentric tori (outer expanding
 * + inner fast flash) that scale ~2.5 m over 600 ms and fade. Runs in
 * addition to the pulsing emissive glow already handled in critter.ts.
 *
 * Optional `opts` lets the caller override the palette so each critter's
 * Frenzy reads as its own colour (Cheeto orange, Kowalski ice, Kurama
 * violet, etc.). Omitting `opts` keeps the legacy gold-red look.
 */
export function spawnFrenzyBurst(scene: THREE.Scene, x: number, z: number, opts?: FrenzyBurstOpts): void {
  const duration = 600; // ms
  const startTime = performance.now();
  const maxRadius = 2.5;
  const outerColor = opts?.color ?? 0xffaa22;
  const innerColor = opts?.secondary ?? 0xff2200;

  // Outer ring: critter palette colour, the "battle cry"
  const ringGeo = new THREE.TorusGeometry(0.2, 0.18, 10, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true,
    opacity: 0.9,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.6, z);
  scene.add(ring);

  // Inner flash: critter palette accent — quick pop at the origin
  const flashGeo = new THREE.TorusGeometry(0.2, 0.12, 10, 32);
  const flashMat = new THREE.MeshBasicMaterial({
    color: innerColor,
    transparent: true,
    opacity: 1.0,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);
  flash.rotation.x = Math.PI / 2;
  flash.position.set(x, 0.75, z);
  scene.add(flash);

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Outer: cubic ease-out to maxRadius
    const outerEase = 1 - Math.pow(1 - t, 3);
    const outerScale = 0.2 + outerEase * (maxRadius / 0.2);
    ring.scale.set(outerScale, outerScale, 1);
    ringMat.opacity = 0.9 * (1 - t);

    // Inner: peaks fast, fades in ~40% of total duration
    const innerT = Math.min(t * 2.5, 1);
    const innerScale = 0.2 + innerT * (maxRadius * 0.55 / 0.2);
    flash.scale.set(innerScale, innerScale, 1);
    flashMat.opacity = 1.0 * (1 - innerT);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(ring);
      scene.remove(flash);
      ringGeo.dispose();
      ringMat.dispose();
      flashGeo.dispose();
      flashMat.dispose();
    }
  }
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// VFX: Sebastian All-in trajectory preview
// ---------------------------------------------------------------------------

/**
 * 2026-05-01 last-minute — Sebastian All-in trajectory preview. A
 * crimson ground line drawn from Sebastian's origin to the chosen
 * lateral edge endpoint, used during the 1 s rooted windup so the
 * player can SEE which way the slash will commit before pressing
 * any input. Fades in fast (~120 ms), holds for the bulk of the
 * windup, fades out at resolution.
 *
 * Pure visual — pulled into `fireFrenzy` when `def.allInL` is true.
 * Cleans up after `ttl` seconds; no per-frame state hung off
 * Critter.
 */
export function spawnAllInTrajectoryPreview(
  scene: THREE.Scene,
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  range: number,
  ttl: number,
): void {
  // Plane sized to the dash. Width is ~0.7 u so it reads as a
  // committed strip, not a hairline. Depth (range) is the literal
  // dash length so the player can read distance.
  const width = 0.75;
  const length = range;
  const geo = new THREE.PlaneGeometry(width, length);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xcc3333,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // lay on the ground
  // The plane's local +Y direction (after the -π/2 X-rotation) lines
  // up with WORLD +Z. We need it pointing along (dirX, dirZ), so
  // rotate around Z by the angle between (0, 1) and (dirX, dirZ).
  const angleZ = Math.atan2(dirX, dirZ);
  mesh.rotation.z = angleZ;
  mesh.position.set(
    originX + dirX * length * 0.5,
    0.02, // a hair above the ground to avoid z-fight
    originZ + dirZ * length * 0.5,
  );
  scene.add(mesh);

  // Inner accent — narrower bright stripe down the middle so the line
  // reads even against busy decor.
  const innerGeo = new THREE.PlaneGeometry(width * 0.35, length);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffe066,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.rotation.x = -Math.PI / 2;
  innerMesh.rotation.z = angleZ;
  innerMesh.position.set(
    originX + dirX * length * 0.5,
    0.025,
    originZ + dirZ * length * 0.5,
  );
  scene.add(innerMesh);

  const startTime = performance.now();
  const totalMs = ttl * 1000;
  const fadeInMs = 120;
  const fadeOutMs = 200;
  function animate(): void {
    const elapsed = performance.now() - startTime;
    if (elapsed >= totalMs) {
      scene.remove(mesh);
      scene.remove(innerMesh);
      geo.dispose();
      mat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      return;
    }
    let alpha = 1.0;
    if (elapsed < fadeInMs) alpha = elapsed / fadeInMs;
    else if (elapsed > totalMs - fadeOutMs) alpha = (totalMs - elapsed) / fadeOutMs;
    mat.opacity = 0.55 * alpha;
    innerMat.opacity = 0.85 * alpha;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// VFX: shockwave ring
// ---------------------------------------------------------------------------

/**
 * Optional palette + lifetime overrides for `spawnShockwaveRing`. Every
 * field falls back to the original red/white shockwave look so existing
 * callers (dash entry burst, anything that doesn't pass `opts`) keep
 * working without changes.
 */
export interface ShockwaveRingOpts {
  /** Outer ring colour. Default `0xff3322` (red slam). */
  color?: number;
  /** Inner flash colour. Default `0xffffff` (white pop). */
  secondary?: number;
  /** Total visible lifetime in milliseconds. Default `450`. Larger
   *  values keep the ring on screen longer — used for Kermit's Poison
   *  Cloud (800 ms) so the wide AoE reads as a hanging toxic puff. */
  holdMs?: number;
}

/**
 * v0.11 — Static decoy clone of a critter at the current position.
 * Used by Kurama Mirror Trick: the visual ghost stays where she
 * was while she's semi-invisible elsewhere. Fire-and-forget clone
 * of her GLB scene graph (skeleton-cloned so it doesn't keep
 * tracking the live skeleton), tinted to alpha 0.4 + violet
 * emissive. No physics, no collision, no AI redirect — purely
 * visual.
 *
 * Lifecycle: ttl seconds, then dispose. Fade-out in the last 30 %.
 */
export function spawnDecoyAt(
  scene: THREE.Scene,
  critter: Critter,
  ttl: number,
  overrideX?: number,
  overrideZ?: number,
  overrideRotY?: number,
): void {
  if (!critter.glbMesh) return; // procedural-only critters: skip
  // 2026-04-30 final-polish — snapshot the GLB world transform NOW,
  // before the SkeletonUtils dynamic import resolves. Fire path:
  // the K dispatcher calls spawnDecoyAt and IMMEDIATELY moves
  // Kurama by `decoyEscapeDistance`. Without this snapshot the
  // async clone reads the post-move position and the decoy ends
  // up next to her instead of where she activated the K.
  // 2026-05-01 microfix — accept (x, z, rotY) override so the
  // online path can spawn the decoy at the broadcast position
  // (where Kurama WAS at cast time per server) instead of her
  // current local position (which has already been state-synced
  // to the escape spot).
  const snapPos = overrideX !== undefined && overrideZ !== undefined
    ? new THREE.Vector3(overrideX, critter.glbMesh.position.y, overrideZ)
    : critter.glbMesh.getWorldPosition(new THREE.Vector3());
  const snapRot = overrideRotY !== undefined
    ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), overrideRotY)
    : critter.glbMesh.getWorldQuaternion(new THREE.Quaternion());
  const snapScl = critter.glbMesh.getWorldScale(new THREE.Vector3());
  // SkeletonUtils.clone gives an independent skeleton so the clone
  // doesn't keep retargeting Kurama's live bones. Imported lazily
  // to avoid a top-level cycle.
  void (async () => {
    const SkeletonUtils = await import('three/examples/jsm/utils/SkeletonUtils.js');
    const decoy = SkeletonUtils.clone(critter.glbMesh!);
    decoy.position.copy(snapPos);
    decoy.quaternion.copy(snapRot);
    decoy.scale.copy(snapScl);
    const decoyMats: THREE.MeshStandardMaterial[] = [];
    decoy.traverse((node) => {
      const m = node as THREE.Mesh;
      if (!m.isMesh || !m.material) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const clonedList: THREE.Material[] = [];
      for (const raw of mats) {
        const std = raw as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) {
          clonedList.push(raw as THREE.Material);
          continue;
        }
        const cloned = std.clone();
        cloned.transparent = true;
        cloned.opacity = 0.4;
        cloned.depthWrite = false;
        cloned.emissive.setHex(0xc83cff);
        cloned.emissiveIntensity = 0.6;
        decoyMats.push(cloned);
        clonedList.push(cloned);
      }
      m.material = Array.isArray(m.material) ? clonedList as THREE.Material[] : clonedList[0];
    });
    scene.add(decoy);
    const startTime = performance.now();
    const total = ttl * 1000;
    const fadeStart = total * 0.7;
    const tick = () => {
      const elapsed = performance.now() - startTime;
      if (elapsed >= total) {
        scene.remove(decoy);
        decoy.traverse((n) => {
          const m = n as THREE.Mesh;
          if (m.isMesh) m.geometry?.dispose();
        });
        for (const mat of decoyMats) mat.dispose();
        return;
      }
      if (elapsed > fadeStart) {
        const t = (elapsed - fadeStart) / (total - fadeStart);
        for (const mat of decoyMats) mat.opacity = 0.4 * (1 - t);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })();
}

/**
 * Persistent slow-zone disc — a flat translucent disc + a faint slow-
 * pulsing torus on top, both alive for the zone's full lifetime. Used
 * for Kermit's Poison Cloud and Kowalski's Arctic Burst. Differs from
 * `spawnShockwaveRing` in three ways:
 *
 *   1. It STAYS visible for the whole `durationSec`, not 450 ms.
 *   2. It draws a filled disc on the ground (the actual debuff zone)
 *      AND a torus boundary (so the player can read its edge).
 *   3. The pulse animation is gentle (sine-driven) so it reads as
 *      "this is a hazard that's still here", not "this just happened".
 *
 * Cleanup is automatic via the same `requestAnimationFrame` self-loop
 * used elsewhere — when t reaches 1 we remove + dispose. The mesh has
 * `depthWrite: false` so it never z-fights with the arena floor or
 * the critters standing inside it.
 */
export function spawnZoneRing(
  scene: THREE.Scene,
  x: number, z: number,
  radius: number,
  durationSec: number,
  color: number = 0x66ff44,
  secondary: number = 0xffffff,
  vfxKind?: ZoneVfxKind,
): void {
  const duration = durationSec * 1000;
  const startTime = performance.now();
  // Filled disc — the actual hazard surface
  const discGeo = new THREE.CircleGeometry(radius, 36);
  const discMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, 0.03, z);
  scene.add(disc);
  // Boundary torus — secondary colour, pulses gently
  const ringGeo = new THREE.TorusGeometry(radius, 0.18, 8, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: secondary, transparent: true, opacity: 0.65,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);

  // 2026-04-29 K-refinement — Kermit Poison Cloud body. Spawn
  // ~14 transparent green spheres at random positions inside the
  // disc, slowly bobbing. They live for the full zone duration
  // and read as a thick volumetric cloud from outside. Cheap:
  // shared geometry (small icosphere), per-instance material so
  // each can fade independently.
  const poisonPuffs: Array<{
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    geo: THREE.BufferGeometry; baseY: number; bobPhase: number;
    bobSpeed: number; baseOpacity: number;
  }> = [];
  if (vfxKind === 'poison') {
    const PUFF_COUNT = 14;
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < PUFF_COUNT; i++) {
      // Random position inside the disc, slightly raised.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (radius * 0.85);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const py = 0.6 + Math.random() * 1.6; // 0.6 .. 2.2 above ground
      const scale = 0.7 + Math.random() * 0.9;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? secondary : color,
        transparent: true,
        opacity: 0.0, // ramps up via fadeIn below
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(puffGeo, mat);
      mesh.scale.setScalar(scale);
      mesh.position.set(px, py, pz);
      scene.add(mesh);
      poisonPuffs.push({
        mesh, mat, geo: puffGeo, baseY: py,
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.6 + Math.random() * 0.5,
        baseOpacity: 0.45 + Math.random() * 0.18,
      });
    }
  }
  // 2026-04-29 K-refinement — Sihans Quicksand swirl. When the zone
  // is `vfxKind: 'sand'` we layer two additional inner discs that
  // rotate around Y at different speeds, producing a remolino /
  // whirlpool read instead of "another flat circle on the floor".
  // Polar UV would be nicer but a simple textured disc is overkill
  // for jam scope — the rotation alone communicates "the floor is
  // moving" against the static ring.
  const sandSwirls: Array<{
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial;
    geo: THREE.BufferGeometry; speed: number; baseOpacity: number;
  }> = [];
  if (vfxKind === 'sand') {
    // Three stacked rings rotating at very different speeds → reads
    // as a heavy whirlpool, not a flat circle. 2026-04-29 final-K
    // (Rafa: "enfatizar más el vórtice/remolino").
    // Outer wide ring — slow, big arc
    {
      const geo = new THREE.RingGeometry(radius * 0.50, radius * 0.95, 36, 1);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.45,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.04, z);
      scene.add(m);
      sandSwirls.push({ mesh: m, mat, geo, speed: 1.5, baseOpacity: 0.45 });
    }
    // Mid ring — counter-rotation, crisp edges
    {
      const geo = new THREE.RingGeometry(radius * 0.25, radius * 0.65, 32, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: secondary, transparent: true, opacity: 0.55,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.05, z);
      scene.add(m);
      sandSwirls.push({ mesh: m, mat, geo, speed: -3.4, baseOpacity: 0.55 });
    }
    // Inner core — fast spin, small, dark sand "throat"
    {
      const geo = new THREE.RingGeometry(0.05, radius * 0.30, 24, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6b4a1f, transparent: true, opacity: 0.70,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.06, z);
      scene.add(m);
      sandSwirls.push({ mesh: m, mat, geo, speed: 5.5, baseOpacity: 0.70 });
    }
  }

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Gentle pulse on the torus, slow fade on both during the last 25 %
    const pulse = 0.85 + 0.15 * Math.sin(elapsed * 0.006);
    ring.scale.set(pulse, pulse, 1);
    const fadeIn = Math.min(elapsed / 200, 1);          // ramp in over 200 ms
    const fadeOut = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    discMat.opacity = 0.22 * fadeIn * fadeOut;
    ringMat.opacity = 0.65 * fadeIn * fadeOut;
    // Swirl rings rotate around their local Z axis (which after the
    // -PI/2 X rotation maps to world Y) at fixed angular velocities.
    for (const sw of sandSwirls) {
      sw.mesh.rotation.z = (elapsed / 1000) * sw.speed;
      sw.mat.opacity = sw.baseOpacity * fadeIn * fadeOut;
    }
    // Poison puffs bob gently and fade in/out with the same envelope.
    for (const p of poisonPuffs) {
      p.mesh.position.y = p.baseY + 0.18 * Math.sin((elapsed / 1000) * p.bobSpeed + p.bobPhase);
      p.mat.opacity = p.baseOpacity * fadeIn * fadeOut;
    }
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(disc); scene.remove(ring);
      discGeo.dispose(); discMat.dispose();
      ringGeo.dispose(); ringMat.dispose();
      for (const sw of sandSwirls) {
        scene.remove(sw.mesh);
        sw.geo.dispose();
        sw.mat.dispose();
      }
      // Puffs share the icosahedron geometry — dispose once after
      // the loop, not per-instance.
      let sharedPuffGeo: THREE.BufferGeometry | null = null;
      for (const p of poisonPuffs) {
        scene.remove(p.mesh);
        p.mat.dispose();
        sharedPuffGeo = p.geo;
      }
      sharedPuffGeo?.dispose();
    }
  }
  requestAnimationFrame(animate);
}

/**
 * Spawn a dramatic shockwave at (x, z). Two concentric rings:
 *  - inner flash that expands fast and fades quickly
 *  - outer torus that expands to maxRadius with a thicker tube
 *
 * Optional `opts` lets each critter tint the ring to its element + extend
 * the lifetime for visually heavier abilities. Omit `opts` for the
 * legacy red/white slam (still used by the dash entry burst).
 */
export function spawnShockwaveRing(
  scene: THREE.Scene,
  x: number,
  z: number,
  maxRadius: number,
  opts?: ShockwaveRingOpts,
): void {
  const duration = opts?.holdMs ?? 450; // ms
  const startTime = performance.now();
  const outerColor = opts?.color ?? 0xff3322;
  const innerColor = opts?.secondary ?? 0xffffff;

  // Outer torus (the "slam" ring) — tinted per critter when provided
  const outerGeo = new THREE.TorusGeometry(0.3, 0.28, 10, 40);
  const outerMat = new THREE.MeshBasicMaterial({
    color: outerColor,
    transparent: true,
    opacity: 0.9,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = Math.PI / 2;
  outer.position.set(x, 0.35, z);
  scene.add(outer);

  // Inner flash (fades faster than the outer ring)
  const innerGeo = new THREE.TorusGeometry(0.3, 0.18, 10, 40);
  const innerMat = new THREE.MeshBasicMaterial({
    color: innerColor,
    transparent: true,
    opacity: 1.0,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = Math.PI / 2;
  inner.position.set(x, 0.5, z);
  scene.add(inner);

  function animate() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);

    // Outer: grows to maxRadius + 10% overshoot, eased out
    const outerEase = 1 - Math.pow(1 - t, 2);
    const outerScale = (0.3 + outerEase * (maxRadius * 1.1 / 0.3));
    outer.scale.set(outerScale, outerScale, 1);
    outerMat.opacity = 0.9 * (1 - t);

    // Inner: grows faster, fades in half the time
    const innerT = Math.min(t * 2, 1);
    const innerScale = (0.3 + innerT * (maxRadius * 0.7 / 0.3));
    inner.scale.set(innerScale, innerScale, 1);
    innerMat.opacity = 1.0 * (1 - innerT);

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      scene.remove(outer);
      scene.remove(inner);
      outerGeo.dispose();
      outerMat.dispose();
      innerGeo.dispose();
      innerMat.dispose();
    }
  }
  requestAnimationFrame(animate);
}
