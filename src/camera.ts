import * as THREE from 'three';

export function createCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
  cam.position.set(0, 23, 25);
  // 2026-04-27 reverted: tried raising lookAt to (0, 5, 0) to bring
  // the skybox horizon into frame, but the resulting framing made
  // the arena read worse (ring no longer fully visible, critters
  // pushed into the bottom strip). The right axis to fight is the
  // skybox itself, not the camera tilt — see the fog density tweak
  // in main.ts and the wider warm horizon ribbon in the sky shader.
  cam.lookAt(0, -3, 0);
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
