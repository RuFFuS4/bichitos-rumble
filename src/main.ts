import * as THREE from 'three';
import { createCamera, handleResize, syncSize } from './camera';
import { Game } from './game';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x1a1a2e);
document.body.prepend(renderer.domElement);

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1a1a2e, 30, 60);

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
scene.add(dirLight);

// Camera — syncSize sets the correct canvas dimensions and aspect ratio
const camera = createCamera();
syncSize(camera, renderer);
handleResize(camera, renderer);

// Game
const game = new Game(scene);

// Game loop
let lastTime = performance.now();
function loop(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.05); // cap dt
  lastTime = now;

  // Ensure canvas matches viewport (guards against late-layout edge cases)
  if (renderer.domElement.width === 0) {
    syncSize(camera, renderer);
  }

  game.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
