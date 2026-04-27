import * as THREE from 'three';

export function createCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
  cam.position.set(0, 23, 25);
  // Tilt change 2026-04-27: lookAt raised from (0, -3, 0) to (0, 5, 0).
  // The previous target sat below ground (y=-3) and made the camera
  // pitch ~46° downward — the upper frame edge fell ~26° below
  // horizontal, which left the skybox horizon BAND completely out
  // of frame during normal play. Raising the target by 8 u brings
  // the camera pitch to ~36°, putting the horizon at upper-mid
  // frame so the gradient sky / pack equirect actually reads in
  // the playthrough instead of only on close-ups. Arena remains
  // clearly framed in the lower-mid (critters at y=0-1.7 sit
  // ~25-35 % below frame centre, plenty of read).
  cam.lookAt(0, 5, 0);
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
