import * as THREE from 'three';

export function createCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 200);
  cam.position.set(0, 34, 14);
  cam.lookAt(0, 0, -1);
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
