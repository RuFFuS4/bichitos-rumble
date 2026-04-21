import * as THREE from 'three';
import { createCamera, handleResize, syncSize } from './camera';
import { Game } from './game';
import { updateCameraShake } from './gamefeel';
import { initPreview, tickPreview } from './preview';
import { isLikelyMobile } from './input';
import { initTouchInput } from './input-touch';
import { initGamepadInput } from './input-gamepad';
import {
  loadMutedState,
  toggleSfxMuted, isSfxMuted,
  toggleMusicMuted, isMusicMuted,
} from './audio';
import { initBadgeToast } from './badge-toast';
import { initHallOfBelts, openHallOfBelts } from './hall-of-belts';
import { updateDustPuffs } from './dust-puff';

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
renderer.setClearColor(0x87b0d8); // sky blue — fallback before skydome paints
document.body.prepend(renderer.domElement);

// Scene
const scene = new THREE.Scene();
// Fog keyed to the horizon colour so the skydome blends smoothly with
// distant geometry instead of clipping to a hard edge. Lower density so
// the sky stays visible past the combat radius.
scene.fog = new THREE.FogExp2(0xb6d1e8, 0.012);

// Skydome — vertical gradient sphere painted from the inside. Sits
// behind every game object, creating the "floating platform in the sky"
// look the game design is after. Pure shader, no texture assets.
const SKY_COLORS = {
  top:     new THREE.Color(0x5c9fd9), // brighter blue high up
  middle:  new THREE.Color(0x8ac1e8), // mid sky (matches clear color)
  horizon: new THREE.Color(0xf5c792), // warm horizon band
  bottom:  new THREE.Color(0x2a3b52), // deeper blue toward the void
};
const skyUniforms = {
  topColor:     { value: SKY_COLORS.top },
  middleColor:  { value: SKY_COLORS.middle },
  horizonColor: { value: SKY_COLORS.horizon },
  bottomColor:  { value: SKY_COLORS.bottom },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 middleColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    varying vec3 vWorldPos;
    void main() {
      // h in [-1..+1] over the skydome's vertical extent (radius 200).
      float h = clamp(vWorldPos.y / 200.0, -1.0, 1.0);
      vec3 color;
      if (h > 0.2) {
        // Upper sky: middle → top
        color = mix(middleColor, topColor, (h - 0.2) / 0.8);
      } else if (h > -0.05) {
        // Horizon band: warm transition
        color = mix(horizonColor, middleColor, (h + 0.05) / 0.25);
      } else {
        // Below horizon: horizon → bottom (void reference)
        color = mix(bottomColor, horizonColor, (h + 1.0) / 0.95);
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 18), skyMat);
skyDome.renderOrder = -1;
scene.add(skyDome);

// Distant cloud band — a flat disc at altitude + below the arena, hinting
// that the platform is floating very high above terrain. Single plane,
// tinted additive for that "soft painted fog" look.
const cloudsGeo = new THREE.PlaneGeometry(140, 140);
const cloudsMat = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
});
const cloudsBelow = new THREE.Mesh(cloudsGeo, cloudsMat);
cloudsBelow.rotation.x = -Math.PI / 2;
cloudsBelow.position.y = -18;
cloudsBelow.renderOrder = -1;
scene.add(cloudsBelow);

// Lighting — three-point rig + hemisphere ambient.
// Sky/ground hemisphere replaces the flat AmbientLight: the top of every
// critter picks up the cyan sky; the underside catches the warm ground
// glow — cheap way to sell "outdoors on a floating platform".
const hemi = new THREE.HemisphereLight(0x9cc7ea, 0x4a3a26, 0.55);
scene.add(hemi);

// Key: warm sun-angle light. Intensity bumped 1.2 → 1.35 and tinted
// slightly warmer for the "high-altitude golden hour" reading.
const dirLight = new THREE.DirectionalLight(0xfff1d4, 1.35);
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

// Rim from behind — cool blue backlight so silhouettes separate from the
// warm sky. No shadow casting (cost we don't need here).
const rimLight = new THREE.DirectionalLight(0x9fb4e8, 0.55);
rimLight.position.set(-10, 14, -14);
scene.add(rimLight);

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

// Badge toast — creates the DOM node so the first match-end is ready to
// surface an unlock. Cheap (one div), idempotent, no runtime cost until
// Game calls maybeShowBadgeToast().
initBadgeToast();

// Hall of Belts modal — also pre-created so the first B-press / button
// click from character-select opens instantly. The grid is rebuilt each
// open against the current stats blob.
initHallOfBelts();
// Wire the on-screen "🏆 Belts" button (character-select overlay).
document.getElementById('btn-open-belts')?.addEventListener('click', () => {
  openHallOfBelts();
});

// Gamepad — always on. initGamepadInput is idempotent and cheap: it only
// attaches the `gamepadconnected`/`gamepaddisconnected` listeners and
// starts polling once a controller is actually plugged in. No cost if
// the player never connects one.
initGamepadInput();

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
  // Dust puff pool tick — no-op when empty. Lives outside game.update so
  // puffs keep animating even through edge phase transitions.
  updateDustPuffs(dt);
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
  //   __arena.checkPlayer()           — physics/visual agreement AT the local player
  //   __arena.check(x, z)             — same at an arbitrary point
  //   __arena.dump()                  — list fragments grouped by band
  //   __arena.compass()               — toggle N/S/E/W world-axis markers
  //   __arena.logCollapses()          — toggle collapse/warning event log
  w.__arena = {
    checkPlayer: () => {
      const p = game.getLocalPlayerPos();
      if (!p) { console.log('[Arena] no local player (not in a match)'); return; }
      console.log(`[Arena] local ${p.critterName} alive=${p.alive} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
      game.arena.checkPoint(p.x, p.z);
    },
    check:        (x: number, z: number) => game.arena.checkPoint(x, z),
    dump:         () => game.arena.dumpFragments(),
    compass:      () => game.arena.toggleDebugCompass(),
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
