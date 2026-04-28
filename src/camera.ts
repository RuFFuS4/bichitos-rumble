import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Gameplay camera pose — single source of truth
// ---------------------------------------------------------------------------
//
// The arena, fog, sky backdrop and lighting were all tuned around
// THIS pose. Any code path that needs to "put the camera back where
// it normally lives" (countdown start, restart out of end-screen,
// title→match transition, online room re-enter, etc.) routes through
// `applyGameplayCameraPose` so we never end up with two values
// drifting apart in different files.
//
// 2026-04-27: tried raising `lookAt` to (0, 5, 0) to bring the
// skybox horizon into frame; ruined gameplay framing (ring no
// longer fully visible, critters pushed into bottom strip).
// Reverted in 9731d64 + sky moved to a camera-attached backdrop
// so the gameplay framing can stay locked here.
export const GAMEPLAY_CAM_POSITION = new THREE.Vector3(0, 23, 25);
export const GAMEPLAY_CAM_LOOKAT = new THREE.Vector3(0, -3, 0);

/**
 * Snap the camera to the canonical gameplay pose. Sets position,
 * resets the up-vector, and re-derives the rotation quaternion via
 * `lookAt`. Called from:
 *   · `createCamera()`       — first frame after boot.
 *   · `main.ts` loop         — the frame the phase exits 'ended'
 *                              (via an edge detector that catches
 *                              R-restart, back-to-title, online
 *                              reconnect — anywhere the end-screen
 *                              lerp pose would otherwise persist).
 *
 * Three.js stores rotation as an internal quaternion, and prior
 * `camera.lookAt(endPose)` calls leak across phase changes unless
 * actively overwritten. Setting position alone isn't enough — the
 * orientation has to be re-derived from the canonical lookAt or
 * the next frame opens with the camera staring at wherever the
 * end-screen was framed.
 */
export function applyGameplayCameraPose(cam: THREE.PerspectiveCamera): void {
  cam.position.copy(GAMEPLAY_CAM_POSITION);
  cam.up.set(0, 1, 0);
  cam.lookAt(GAMEPLAY_CAM_LOOKAT);
}

export function createCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
  applyGameplayCameraPose(cam);
  return cam;
}

export function syncSize(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void {
  const w = window.innerWidth || document.documentElement.clientWidth || 800;
  const h = window.innerHeight || document.documentElement.clientHeight || 600;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

export function handleResize(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void {
  window.addEventListener('resize', () => syncSize(camera, renderer));
}
