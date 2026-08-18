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
import { initSceneAtmosphere } from '../scene-atmosphere';
import { tickSharedGameplay } from '../frame-ticks';
import { Game } from '../game';
import { updateCameraShake } from '../gamefeel';
import { initPreview, tickPreview } from '../preview';
import { isLikelyMobile } from '../input';
import { initTouchInput } from '../input-touch';
import { initGamepadInput } from '../input-gamepad';
import { loadMutedState } from '../audio';
import { mountLabSidebar, loadLabSetup, RANDOM_PACK } from './sidebar';
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
document.body.prepend(renderer.domElement);

// --- Scene + atmosphere (SAME rig as the game — H3 slice 7) ----------------
// The old lab-only fog/AmbientLight rendered a dark void: what you
// tuned here did not look like production. initSceneAtmosphere also
// binds the per-pack skybox/fog setters that arena.ts drives, so pack
// skyboxes now load in the lab too.
const scene = new THREE.Scene();
initSceneAtmosphere(scene, renderer);

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
initGamepadInput();
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
// Kick off a match so the tool is immediately useful. Lineup, seed and
// arena pack come from the persisted lab setup ('match-lab:setup' — the
// same storage the sidebar rehydrates from) so a reload, e.g. after an
// Apply-to-source, resumes the exact match being tuned. Reusing lastSeed
// is deliberate: pressing Start Match rolls a fresh seed and persists it,
// so reloads are deterministic but new matches are not. First visit falls
// back to the classic Sergei vs Trunk/Kurama/Shelly with a random arena.
const labSetup = loadLabSetup();
const startOpts: { seed?: number; packId?: string } = {};
if (labSetup.lastSeed !== null) startOpts.seed = labSetup.lastSeed;
if (labSetup.packPick !== RANDOM_PACK) startOpts.packId = labSetup.packPick;
devApi.startMatch(labSetup.playerPick, labSetup.botPicks.filter((n) => n !== ''), startOpts);

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
  // Same per-frame gameplay ticks as the real game loop (dust, zones,
  // offline-L, projectiles, status icons) — abilities with zones or
  // projectiles used to FREEZE in the lab because these were missing.
  tickSharedGameplay(dt, game, scene, camera, {
    width: renderer.domElement.clientWidth,
    height: renderer.domElement.clientHeight,
  });
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
