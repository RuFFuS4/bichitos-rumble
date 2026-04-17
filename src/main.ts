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
//
// IMPORTANT: HTML <button> elements activate on Space and Enter when they
// have focus. Without the mousedown preventDefault below, clicking the
// button would give it focus, and every subsequent Space press (to
// headbutt) would re-trigger the button click — silently toggling the
// sound mid-combat. We prevent focus on pointerdown for BOTH buttons.
loadMutedState();

/** Wire a settings button so it never takes keyboard focus. */
function wireSettingsButton(btn: HTMLButtonElement, onClick: () => void): void {
  // Prevent focus on mouse/touch press — the click still fires, but the
  // button never becomes `document.activeElement`, so Space/Enter can't
  // re-trigger it while playing.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  btn.addEventListener('click', (e) => {
    onClick();
    // Defensive: if focus slipped through anyway, drop it back to body.
    btn.blur();
    e.preventDefault();
  });
  // Also swallow keyboard activation on the button itself — belt + suspenders.
  btn.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

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
  wireSettingsButton(btnSfx, () => { toggleSfxMuted(); refresh(); });
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
  wireSettingsButton(btnMusic, () => { toggleMusicMuted(); refresh(); });
}

// Game
const game = new Game(scene);

// Online mode entry — "Play Online" button on title screen
//
// FEATURE GATE: the button is only shown when an online server URL is
// available. In dev: always shown (defaults to ws://localhost:2567).
// In prod: requires VITE_SERVER_URL to be set at build time, otherwise
// the button is removed from the DOM so users never see a broken path.
// The online mode button is feature-gated: only visible if a server URL
// is configured. In dev we always show it (defaults to ws://localhost:2567).
// Click handling for both title buttons lives in hud.ts via setTitleModeHandlers.
const btnOnline = document.getElementById('btn-online');
const hasServerUrl = !!(import.meta.env.VITE_SERVER_URL) || !!import.meta.env.DEV;
if (btnOnline && !hasServerUrl) {
  btnOnline.remove();
  console.info('[Main] online mode disabled (no VITE_SERVER_URL)');
}

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

// ---------------------------------------------------------------------------
// DEBUG ONLY: GLB transform tuning tool
// ---------------------------------------------------------------------------
// Available only in dev mode (npm run dev). Stripped from production builds
// by Vite's dead-code elimination on import.meta.env.DEV.
//
// Usage in browser console:
//   __tune({ scale: 2.0 })           — adjust scale
//   __tune({ rotation: -1.57 })      — adjust Y rotation (radians)
//   __tune({ pivotY: 0.98 })         — adjust vertical offset
//   __tune({ offsetX: 0, offsetZ: 0 }) — adjust horizontal offset
//   __tune()                          — print current values
//   __game                            — access Game instance
// ---------------------------------------------------------------------------
// Expose __game for diagnostics whenever online mode is available
// (dev OR prod with VITE_SERVER_URL). Online multiplayer bugs are hard
// to reproduce without being able to inspect the Game + Room from the
// console. __tune stays DEV-only since it's a content-authoring tool.
if (import.meta.env.DEV || import.meta.env.VITE_SERVER_URL) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__game = game;
  // Direct helpers for the arena collapse diagnostics — no need to chain
  // through __game.arena. Easy to reactivate if the render vs physics
  // mismatch ever reappears. Console usage:
  //   __arena.dump()                  — list fragments grouped by band
  //   __arena.check(x, z)             — physics/visual agreement at point
  //   __arena.compass()               — toggle N/S/E/W world-axis markers
  //   __arena.logCollapses()          — toggle collapse/warning event log
  w.__arena = {
    dump:       () => game.arena.dumpFragments(),
    check:      (x: number, z: number) => game.arena.checkPoint(x, z),
    compass:    () => game.arena.toggleDebugCompass(),
    logCollapses: () => game.arena.toggleCollapseLog(),
  };
  console.info('[main] diagnostics: window.__game, window.__arena');
}

if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__tune = (opts?: {
    scale?: number; rotation?: number; pivotY?: number;
    offsetX?: number; offsetZ?: number;
  }) => {
    const all = game.critters.filter((c: any) => c.glbMesh) as any[];
    if (!opts) {
      for (const c of all) {
        const g = c.glbMesh as THREE.Group;
        console.log(`[tune] ${c.config.name}: scale=${g.scale.x.toFixed(3)} rot=${g.rotation.y.toFixed(3)} pivotY=${g.position.y.toFixed(3)} pos=(${g.position.x.toFixed(3)}, ${g.position.z.toFixed(3)})`);
      }
      if (all.length === 0) console.log('[tune] no GLB critters loaded yet.');
      return;
    }
    for (const c of all) {
      const g = c.glbMesh as THREE.Group;
      if (opts.scale !== undefined) g.scale.setScalar(opts.scale);
      if (opts.rotation !== undefined) g.rotation.y = opts.rotation;
      if (opts.pivotY !== undefined) g.position.y = opts.pivotY;
      if (opts.offsetX !== undefined) g.position.x = opts.offsetX;
      if (opts.offsetZ !== undefined) g.position.z = opts.offsetZ;
    }
    console.log('[tune] applied:', JSON.stringify(opts));
  };
}
