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
// Reverted in 9731d64 — the framing stays locked here and the sky
// is not the camera's problem: it's the pack's equirect panorama
// bound as `scene.background` (`setSceneSkyboxTexture`,
// `src/scene-atmosphere.ts`), which never moves with the camera.
// (Este comentario decía "sky moved to a camera-attached backdrop";
// ese backdrop nunca existió — corregido 2026-09-06, docs/ARENA_V2.md
// §1.3 #16.)
export const GAMEPLAY_CAM_POSITION = new THREE.Vector3(0, 23, 25);
export const GAMEPLAY_CAM_LOOKAT = new THREE.Vector3(0, -3, 0);
/** Campo de visión vertical (°). El pasillo del canto del fondo v2 se
 *  calcula proyectando con esta pose, así que vive junto a ella. */
export const GAMEPLAY_CAM_FOV = 40;

/** Pose de cámara como datos (capturas, `setCameraPoseOverride`). */
export interface CameraPose {
  position: [number, number, number];
  lookAt: [number, number, number];
}

/**
 * Poses con las que se juzga el fondo (docs/DIORAMAS.md §«Fondo v2», §12).
 * `game` es la de juego exacta: forzarla quita el temblor de cámara.
 * Las de fin de partida REPLICAN las fórmulas de `src/game.ts`
 * (poseVictoryCloseUp / poseDefeatWide / poseWideArena) con el bicho en el
 * centro mirando a +Z; si allí cambian, aquí también. `low` es la cámara
 * de juego girada 0,52 rad en X: el encuadre de las hojas del cono
 * (.tmp/shots-cono*), hecho reproducible.
 */
export const CAPTURE_POSES: Record<'game' | 'victory' | 'defeat' | 'wide' | 'low', CameraPose> = {
  game: {
    position: [GAMEPLAY_CAM_POSITION.x, GAMEPLAY_CAM_POSITION.y, GAMEPLAY_CAM_POSITION.z],
    lookAt: [GAMEPLAY_CAM_LOOKAT.x, GAMEPLAY_CAM_LOOKAT.y, GAMEPLAY_CAM_LOOKAT.z],
  },
  victory: { position: [0, 2.5, 4.5], lookAt: [0, 1.2, 0] },
  defeat: { position: [0, 5, 7], lookAt: [0, 1, 0] },
  wide: { position: [8, 7, 12], lookAt: [0, 1, 0] },
  low: { position: [0, 7.54, 33.12], lookAt: [0, -2.6, -1.49] },
};

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
  // far 200 → 500: el mar del decorado (BACKDROP_LOOK.seaOuterR = 300,
  // src/arena-backdrop.ts) se recortaba a 200 y dejaba asomar la
  // panorámica justo en la banda que viene a tapar. near 0.1 → 0.5
  // recupera la precisión de profundidad que cuesta ese far: nada se
  // dibuja a menos de 0,5 u (el plano corto del selector está a 4,5).
  const cam = new THREE.PerspectiveCamera(GAMEPLAY_CAM_FOV, window.innerWidth / window.innerHeight, 0.5, 500);
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
