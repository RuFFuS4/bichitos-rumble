// ---------------------------------------------------------------------------
// /tools.html — internal dev/balance tool entry point
// ---------------------------------------------------------------------------
//
// Reuses the whole game engine (scene, camera, renderer, Game, HUD, audio,
// input) and layers a fixed sidebar on top with:
//
//   - Matchup tuner (pick player + up to 3 bots, start / restart)
//   - Arena inspector (seed, pattern, batches, force seed, reset)
//   - Animation tuner (live sliders on animPersonality)
//   - Info panel (current critter stats)
//   - Pause / slow-mo / respawn / end-match quick actions
//
// Access: type /tools.html in the browser. Never linked from the game.
// Static files are served before the vercel.json SPA rewrite, so the
// route resolves correctly in production.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { createCamera, handleResize, syncSize } from '../camera';
import { Game } from '../game';
import { updateCameraShake } from '../gamefeel';
import { initPreview, tickPreview } from '../preview';
import { isLikelyMobile } from '../input';
import { initTouchInput } from '../input-touch';
import { loadMutedState } from '../audio';
import { mountLabSidebar } from './sidebar';
import { DevApi } from './dev-api';

// --- WebGL sanity check ----------------------------------------------------
const testCanvas = document.createElement('canvas');
const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
if (!gl) {
  document.body.innerHTML =
    '<div style="color:#fff;font:14px sans-serif;padding:20px">Lab requires WebGL.</div>';
  throw new Error('WebGL not available');
}

// --- Renderer --------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x0a0a18);
document.body.prepend(renderer.domElement);

// --- Scene + lights --------------------------------------------------------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0a18, 0.018);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const dir = new THREE.DirectionalLight(0xffeedd, 1.2);
dir.position.set(8, 25, 12);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.near = 5;
dir.shadow.camera.far = 60;
dir.shadow.camera.left = -18;
dir.shadow.camera.right = 18;
dir.shadow.camera.top = 18;
dir.shadow.camera.bottom = -18;
dir.shadow.bias = -0.002;
scene.add(dir);

// --- Camera ----------------------------------------------------------------
const camera = createCamera();
syncSize(camera, renderer);
handleResize(camera, renderer);
const baseCamX = camera.position.x;
const baseCamY = camera.position.y;
const baseCamZ = camera.position.z;

// --- Preview, touch, audio (same as the game) ------------------------------
const previewCanvas = document.getElementById('preview-canvas') as HTMLCanvasElement | null;
if (previewCanvas) initPreview(previewCanvas);
if (isLikelyMobile()) initTouchInput();
loadMutedState();

// --- Game instance ---------------------------------------------------------
const game = new Game(scene);

// DevApi centralises every lab-only capability. The sidebar only talks to
// this layer — no direct game.debug* calls from UI code anymore. Keeps Game
// from growing a pile of debug methods and lets us add inspection/mutation
// features without touching gameplay files.
const devApi = new DevApi(game, renderer);

// Skip the normal title → character-select flow. Drop the title overlay so
// the canvas + HUD are visible immediately; the sidebar will drive matches.
game.debugEndMatchImmediately();
// Kick off a default match so the tool is immediately useful.
devApi.startMatch('Sergei', ['Trunk', 'Kurama', 'Shelly']);

// --- Mount the sidebar ------------------------------------------------------
mountLabSidebar(devApi);

// --- Main loop (with debugSpeedScale for pause/slow-mo) --------------------
let lastTime = performance.now();
function loop(now: number) {
  const raw = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  const dt = raw * game.debugSpeedScale;

  if (renderer.domElement.width === 0) syncSize(camera, renderer);

  game.update(dt);
  updateCameraShake(camera, baseCamX, baseCamY, baseCamZ, dt);
  renderer.render(scene, camera);
  tickPreview(dt);
  // Poll DevApi AFTER render so renderer.info counts reflect this frame's
  // draw calls / triangles rather than the previous one.
  devApi.tick(raw);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Always expose escape hatches for manual console tweaking in the lab. Both
// the full Game instance and the DevApi layer are reachable — use DevApi
// for structured helpers, use __game only when you really need to poke
// engine internals.
(window as unknown as { __game: Game; __devApi: DevApi }).__game = game;
(window as unknown as { __game: Game; __devApi: DevApi }).__devApi = devApi;
