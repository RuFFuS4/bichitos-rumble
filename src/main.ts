import * as THREE from 'three';
import { createCamera, handleResize, syncSize } from './camera';
import { Game } from './game';
import { updateCameraShake } from './gamefeel';
import { initPreview, tickPreview } from './preview';
import { isLikelyMobile } from './input';
import { initTouchInput } from './input-touch';
import {
  loadMutedState,
  toggleSfxMuted, isSfxMuted,
  toggleMusicMuted, isMusicMuted,
} from './audio';

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

// Snapshot the base camera position for shake offset calculations
const baseCamX = camera.position.x;
const baseCamY = camera.position.y;
const baseCamZ = camera.position.z;

// Preview (second renderer for menu 3D — character select, future winner pose)
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement | null;
if (previewCanvas) {
  initPreview(previewCanvas);
}

// Touch controls — activate only if the device reports touch capability
// and a narrow viewport. Keyboard backend is always on regardless.
if (isLikelyMobile()) {
  initTouchInput();
}

// Audio settings: load persisted mute states + wire the top-right buttons.
// Two independent channels:
//  - SFX  (all gameplay sounds)      → #btn-sfx
//  - Music (placeholder, no audio yet) → #btn-music
loadMutedState();

const btnSfx = document.getElementById('btn-sfx') as HTMLButtonElement | null;
if (btnSfx) {
  const refresh = () => {
    const m = isSfxMuted();
    btnSfx.textContent = m ? '🔇' : '🔊';
    btnSfx.classList.toggle('muted', m);
    btnSfx.title = m ? 'Enable sound effects' : 'Disable sound effects';
    btnSfx.setAttribute('aria-pressed', m ? 'true' : 'false');
  };
  refresh();
  btnSfx.addEventListener('click', () => { toggleSfxMuted(); refresh(); });
}

const btnMusic = document.getElementById('btn-music') as HTMLButtonElement | null;
if (btnMusic) {
  const refresh = () => {
    const m = isMusicMuted();
    btnMusic.textContent = m ? '🎵' : '🎶';
    btnMusic.classList.toggle('muted', m);
    btnMusic.title = m ? 'Enable music (not yet available)' : 'Disable music';
    btnMusic.setAttribute('aria-pressed', m ? 'true' : 'false');
  };
  refresh();
  btnMusic.addEventListener('click', () => { toggleMusicMuted(); refresh(); });
}

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
  // Apply camera shake on top of the base position (no accumulation drift)
  updateCameraShake(camera, baseCamX, baseCamY, baseCamZ, dt);
  renderer.render(scene, camera);
  // Preview renders only when visible; cheap no-op otherwise
  tickPreview(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
