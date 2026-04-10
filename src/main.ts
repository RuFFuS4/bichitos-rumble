import * as THREE from 'three';
import { createCamera, handleResize, syncSize } from './camera';
import { Game } from './game';

// ---------------------------------------------------------------------------
// WebGL diagnostic + renderer creation
// ---------------------------------------------------------------------------

console.log('[bichitos] Checking WebGL support...');
const testCanvas = document.createElement('canvas');
const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
console.log('[bichitos] WebGL context:', gl ? `${gl.getParameter(gl.RENDERER)} (${gl.getParameter(gl.VERSION)})` : 'NONE');

if (!gl) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:sans-serif;text-align:center;padding:20px;">
      <div>
        <h1 style="font-size:24px;">⚠ WebGL not available</h1>
        <p style="margin-top:12px;opacity:0.8;">Bichitos Rumble needs WebGL to run.</p>
        <p style="margin-top:12px;opacity:0.6;line-height:1.6;">
          Check these:<br>
          1. Enable <b>Hardware Acceleration</b> in browser settings<br>
          2. Update your GPU drivers<br>
          3. Try a different browser (Chrome, Firefox, Edge)
        </p>
      </div>
    </div>`;
  throw new Error('WebGL not available');
}

console.log('[bichitos] Creating Three.js renderer...');
const renderer = new THREE.WebGLRenderer({ antialias: true });
console.log('[bichitos] Renderer created OK');
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x0a0a18);
document.body.prepend(renderer.domElement);

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a18, 0.018); // exponential fog for depth falloff

// Lighting — stronger contrast for depth readability
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(8, 25, 12);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.camera.left = -18;
dirLight.shadow.camera.right = 18;
dirLight.shadow.camera.top = 18;
dirLight.shadow.camera.bottom = -18;
dirLight.shadow.bias = -0.002;
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
