import * as THREE from 'three';
import { createCamera, handleResize, syncSize, applyGameplayCameraPose } from './camera';
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
import { initOnlineBeltToast } from './online-belt-toast';
import { updateDustPuffs } from './dust-puff';
import { tickAbilityZones } from './abilities';
import { getPreviewPackId } from './arena-decor-layouts';

// ---------------------------------------------------------------------------
// Sprite sheet preload — enables `.sprite-hud-*` / `.sprite-ability-*` CSS
// classes only if their backing images actually load. If either sheet 404s
// (asset not shipped yet), the body class never gets added and the emoji
// fallbacks stay visible. See the SPRITE ICON SYSTEMS section of index.html.
// ---------------------------------------------------------------------------
function enableSpriteClassOnLoad(src: string, bodyClass: string): void {
  const img = new Image();
  img.onload = () => document.body.classList.add(bodyClass);
  img.onerror = () => {
    // Silent: the body class stays off, emoji fallbacks take over. Log
    // once in debug so we know when polish isn't visible because the
    // image hasn't been committed yet.
    console.debug('[sprites] sheet not available, using emoji fallback:', src);
  };
  img.src = src;
}
enableSpriteClassOnLoad('./images/hud-icons.png', 'has-hud-sprites');
enableSpriteClassOnLoad('./images/ability-icons.png', 'has-ability-sprites');

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
// distant geometry instead of clipping to a hard edge. Density 0.008
// (was 0.012 until 2026-04-27): keeps the void feeling moody while
// letting the horizon colour bleed into the far frustum.
scene.fog = new THREE.FogExp2(0xb6d1e8, 0.008);

// Cartoon backdrop — sky colours used by both the camera-attached
// screen-space backdrop (default menu/play state) and the legacy
// skydome shader (still in the scene as a fallback for arena packs
// that haven't been wired through yet). Keeping the palette in one
// place means a designer-driven colour tweak only edits this block.
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

// ---------------------------------------------------------------------------
// Camera-attached screen-space backdrop
// ---------------------------------------------------------------------------
//
// Replaces the previous physical skydome gradient. The skydome was
// rendered at radius 150 around world origin, but the gameplay camera
// (FOV 40°, position (0, 23, 25), looking down at (0, -3, 0)) only
// ever saw the dome's lower hemisphere through a narrow ~50° vertical
// slice — so the warm horizon band and the bright upper sky never
// made it into the gameplay frame. Lifting `lookAt` to expose more
// dome ruined the gameplay framing (b8c1a7e); densifying the fog
// muddied the foreground.
//
// This backdrop sidesteps the geometry entirely by drawing a
// fullscreen quad whose vertical UV maps to a hand-tuned bottom →
// horizon → middle → top gradient. Because the quad is parented to
// the camera and uses fixed clip-space coordinates in its vertex
// shader, the gradient ALWAYS fills the screen exactly the same way
// regardless of camera position, lookAt, FOV or aspect. The gameplay
// frame can stay locked to its proven framing while the backdrop
// gives a real cartoon-sky reading.
//
// Render details:
//   · `frustumCulled = false` because the quad sits at clip-space z
//     ≈ 0.999 — three.js's CPU culling sees a degenerate world AABB
//     and would skip the draw on some camera angles otherwise.
//   · `depthTest: false` + `depthWrite: false` lets the backdrop
//     paint first and then every subsequent draw (skydome, props,
//     critters) composites on top.
//   · `renderOrder: -2` keeps it behind the skydome (renderOrder -1)
//     in case an arena pack swaps `skyDome`'s material to a textured
//     equirect — the backdrop is a no-op when it sits behind a fully
//     opaque sphere, so we don't even bother to hide it on pack
//     swaps.
const backdropMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  depthWrite: false,
  depthTest: false,
  fog: false,
  side: THREE.DoubleSide,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      // Place the quad at clip-space z = 0.999 (just inside the far
      // plane) so depth-aware sort doesn't push it forward of any
      // gameplay geometry on cards that ignore depthTest=false.
      gl_Position = vec4(position.xy, 0.999, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform vec3 topColor;
    uniform vec3 middleColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    void main() {
      // vUv.y: 0 at the bottom of the screen → 1 at the top.
      // Gradient bands chosen so the warm horizon dominates the
      // middle of the frame (where the gameplay camera looks),
      // the bright upper sky reads at the top edge, and the deep
      // blue grounds the bottom edge — matching the cartoon
      // skybox the artists are after.
      float h = vUv.y;
      vec3 color;
      if (h > 0.62) {
        // Upper sky: middle → top.
        color = mix(middleColor, topColor, (h - 0.62) / 0.38);
      } else if (h > 0.38) {
        // Mid: horizon → middle. Wider horizon band than the
        // legacy skydome so warm tones span more of the frame.
        color = mix(horizonColor, middleColor, (h - 0.38) / 0.24);
      } else {
        // Lower: bottom → horizon, sqrt-curve so horizon warmth
        // creeps up into the frame instead of dropping abruptly
        // into the deep blue void.
        float t = clamp(h / 0.38, 0.0, 1.0);
        t = sqrt(t);
        color = mix(bottomColor, horizonColor, t);
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMat);
backdrop.frustumCulled = false;
backdrop.renderOrder = -2;

// Legacy skydome — kept ONLY so arena packs that ship a textured
// equirect (`setSceneSkyboxTexture`) still have a sphere mesh to
// paint that texture onto. The default gradient shader is still
// here in case any future code path needs it, but in normal play
// the backdrop above completely covers it before this dome ever
// renders. Once every arena pack uses the camera-attached backdrop
// for its sky, this block can go.
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
      float h = clamp(vWorldPos.y / 100.0, -1.0, 1.0);
      vec3 color;
      if (h > 0.2)        color = mix(middleColor, topColor, (h - 0.2) / 0.8);
      else if (h > -0.05) color = mix(horizonColor, middleColor, (h + 0.05) / 0.25);
      else {
        float t = clamp((h + 1.0) / 0.95, 0.0, 1.0);
        t = sqrt(t);
        color = mix(bottomColor, horizonColor, t);
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
// Explicit generic so later reassignments to MeshBasicMaterial (pack
// skybox swap) don't fight TS's narrow ShaderMaterial inference.
//
// Radius 100: tightens the dome around the playable area so the
// equirectangular pack texture reads punchy instead of haze-faded by
// the FogExp2 (density 0.008 → ~55% transmittance at 100 u). All
// gameplay objects stay safely inside: arena radius ≤ 12 u, props
// ≤ 12.5 u, void at y = −30, cloudsBelow now 80×80 (corner ≤ 57 u
// from arena centre). The skydome is parented to the camera below
// (`camera.add(skyDome)`) so the viewer always sits at the dome's
// centre — without that, a fixed-origin dome leaves the camera
// offset by ~25 u and the panoramic equirect's horizon line reads
// off-frame, leaving only the texture's south-pole band visible
// (which looks like a flat coloured haze instead of a skyline).
const SKYDOME_RADIUS = 100;
const skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.Material> =
  new THREE.Mesh(new THREE.SphereGeometry(SKYDOME_RADIUS, 24, 18), skyMat);
skyDome.renderOrder = -1;
// Tilt the dome so the equirect's silhouette band lands in the visible
// strip of the frame above the arena disc.
//
// The arena disc occupies the lower ~half of the frame (cam pitch
// −46°, lookAt at y=−3 ± 12u arena radius). The narrow band of frame
// pixels NOT covered by the arena spans world pitch ≈ [−24°, −31°].
// That's the only place a horizon silhouette can read.
//
// In the empirical Rafa-generated panos the silhouettes (palms, ice
// peaks, dunes, coral cliffs, pagodas) sit around image y ≈ 50–60 %
// from the top — i.e. texture v ≈ 0.40–0.50 (with flipY=true mapping
// image-top to v=1).
//
// To pull v=0.45 into world pitch −28° (the middle of the visible
// strip above the arena), rotate the dome:
//   target latitude = −28°,  source latitude = (0.45 − 0.5) × 180° = −9°
//   rotation.x = target − source = −19°
// In practice the camera + arena geometry call for slightly more tilt
// (so the silhouette base sits at the arena rim instead of floating
// halfway up the strip) — `−60°` empirically lines up the low sky
// with the frame's top edge, the silhouettes just above the arena
// rim, and pushes the haze band below the arena where it can't be
// seen anyway. Tunable.
skyDome.rotation.x = THREE.MathUtils.degToRad(-22);
// Note: scene.add(skyDome) replaced by camera.add(skyDome) further
// down (after the camera is created) so the dome travels with the
// viewer and the equirect stays centred on the camera.

// --- Pack-aware skybox / fog setters ------------------------------------
//
// Exported so arena-decorations.ts can swap the shader sky for a textured
// equirect sky when an arena pack is active, and revert when leaving the
// match (back to menu). Fog colour follows the same path — scene.fog is
// FogExp2, so we just retune its .color in-place.

const DEFAULT_FOG_COLOR = 0xb6d1e8;
const DEFAULT_CLEAR_COLOR = 0x87b0d8;

/**
 * Swap the sky dome to a textured equirect sphere for an arena pack, or
 * pass `null` to restore the procedural shader gradient used in menus.
 * Safe to call repeatedly — the skydome mesh is reused, only its material
 * and clear-color change.
 *
 * Also hides the screen-space backdrop while a pack texture is active.
 * Rationale: the backdrop and the skydome both target renderOrder ≤ −1
 * with depthWrite:false, and on some GPUs the backdrop ends up painting
 * on top of the skydome — wiping out the panoramic equirect. The
 * backdrop only exists as a fallback for the menu / no-pack state, so
 * hiding it during a textured pack is both correct and a no-op for the
 * default look.
 */
export function setSceneSkyboxTexture(tex: THREE.Texture | null): void {
  if (tex) {
    // MeshBasicMaterial inside-out renders the equirect as a skybox.
    // The mapping flag set in loadPackSkyboxTexture makes this "just work".
    const texMat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const prev = skyDome.material;
    skyDome.material = texMat;
    // The shader material is authored and reused between packs — don't
    // dispose it, just dispose prior textured materials to avoid a leak
    // on repeated swaps.
    if (prev !== skyMat && prev instanceof THREE.Material) prev.dispose();
    backdrop.visible = false;
  } else {
    const prev = skyDome.material;
    skyDome.material = skyMat;
    if (prev !== skyMat && prev instanceof THREE.Material) prev.dispose();
    backdrop.visible = true;
  }
}

/**
 * Retune the global fog colour. FogExp2 uses a Color, so we mutate it in
 * place (no Scene re-assignment needed). Pass `null` to restore the
 * default menu-time horizon colour.
 */
export function setSceneFogColor(color: number | null): void {
  const target = color ?? DEFAULT_FOG_COLOR;
  if (scene.fog && 'color' in scene.fog) {
    (scene.fog as THREE.FogExp2).color.setHex(target);
  }
  // Also tint the clear colour so the 1-frame gap before the skydome
  // paints isn't jarring (the old default was a fixed sky blue).
  renderer.setClearColor(color ?? DEFAULT_CLEAR_COLOR);
}

// Distant cloud band — a flat disc at altitude + below the arena, hinting
// that the platform is floating very high above terrain. Single plane,
// tinted additive for that "soft painted fog" look. Sized 80×80 (corner
// at ~57 u from origin) so it stays well inside the camera-parented
// skydome (radius 100) regardless of where the gameplay camera sits.
const cloudsGeo = new THREE.PlaneGeometry(80, 80);
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

// Parent the screen-space backdrop to the camera and add the camera
// to the scene so the backdrop participates in the standard render
// pass. The backdrop's vertex shader uses fixed clip-space coordinates,
// so no actual transform is read from the camera; we only need it in
// the scene graph for three.js to traverse + draw it.
camera.add(backdrop);
// Parent the skydome to the camera so the viewer always sits at the
// sphere's centre. With a fixed-origin dome the offset between camera
// and origin (≥25 u) put the camera near the dome's far wall, so the
// panoramic equirect's horizon line landed off-frame and only the
// texture's south-pole band painted into the gameplay frame — that's
// what made packs read as a flat coloured haze instead of a skyline.
camera.add(skyDome);
scene.add(camera);

// Snapshot the base camera position for shake offset calculations.
// `applyGameplayCameraPose` is the single source of truth — these
// constants just cache it in the form `updateCameraShake` expects
// (it writes absolute positions, not deltas).
const baseCamX = camera.position.x;
const baseCamY = camera.position.y;
const baseCamZ = camera.position.z;

// Edge-detector flag — true while a `getEndScreenCameraPose()` is
// driving the camera. Goes back to false the frame the phase exits
// 'ended' (caused by restart / title / next match). The transition
// itself triggers `applyGameplayCameraPose(camera)` so the next
// gameplay frame opens with both the correct position AND the
// correct rotation quaternion (Three.js's quaternion is persistent
// across phase changes — clearing it requires an explicit re-lookAt).
let wasEndPhase = false;

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

// Online Belt toast — same pre-create pattern. Fired when the BrawlRoom
// broadcasts a `beltChanged` message (online match ended with a change
// of holder). Listener is wired per-room inside Game.enterOnline.
initOnlineBeltToast();

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

// Decor preview banner — only shown when /decor-editor.html opened
// the game with `?arenaPack=<id>&decorPreview=1`. Acts as both a
// reminder ("you're not in normal play, you're previewing local
// edits") and a 1-click way back to the editor. Production builds
// without the query string skip this entirely (getPreviewPackId
// returns null) so normal players never see it.
{
  const previewPack = getPreviewPackId();
  if (previewPack) {
    const banner = document.createElement('div');
    banner.id = 'decor-preview-banner';
    banner.innerHTML = `
      <span style="opacity: 0.7">🎨 Preview:</span>
      <strong>${previewPack}</strong>
      <a href="/decor-editor.html" style="color: #ffdc5c; margin-left: 10px; text-decoration: none">← back to editor</a>
    `;
    Object.assign(banner.style, {
      position: 'fixed',
      top: '8px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(10, 12, 22, 0.92)',
      color: '#e0e4ee',
      border: '1px solid #ffdc5c',
      borderRadius: '6px',
      padding: '6px 14px',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontSize: '12px',
      letterSpacing: '0.04em',
      zIndex: '999',
      pointerEvents: 'auto',
      backdropFilter: 'blur(4px)',
    } as CSSStyleDeclaration);
    document.body.appendChild(banner);
  }
}

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
  // EXCEPT when the offline pause menu is up: if we keep advancing
  // puff lifetimes, an in-flight ring would keep expanding behind the
  // menu and look like gameplay never actually froze.
  if (!game.isPaused()) {
    updateDustPuffs(dt);
    // Ability zones (Kermit Poison Cloud, Kowalski Arctic Burst).
    // Same gating as dust puffs — pause should freeze the slow-zone
    // timer too so a zone doesn't quietly expire while the menu is up.
    tickAbilityZones(dt);
  }
  // Camera ownership per phase:
  //   · paused          → freeze (no shake, no lerp).
  //   · ended           → game.getEndScreenCameraPose() returns a
  //                       win/lose/draw-specific pose (close-up,
  //                       wide-on-survivor, or wide-on-arena). Shake
  //                       silenced — celebratory framing wants a
  //                       steady camera, not a wobble.
  //   · everything else → base position + camera shake stack (the
  //                       normal gameplay pipeline).
  //
  // Restart reset: when the phase leaves 'ended' (e.g. user hits R
  // to restart), we have to actively reset the camera's `lookAt`
  // back to the gameplay base. Three.js stores rotation internally;
  // a previous `camera.lookAt(endPose.lookAt)` persists across phase
  // changes if not explicitly overwritten. Without this, post-restart
  // matches play with the camera staring at wherever the end-screen
  // was focused (the player's last position, or arena origin for
  // wide poses) — looks like the camera is broken. The
  // `wasEndPhase` edge detector calls `lookAt(BASE_CAM_LOOKAT)` ONCE
  // on the transition out, not every frame.
  const endPose = game.getEndScreenCameraPose();
  if (game.isPaused()) {
    // No-op — camera frozen at whatever it was last frame.
  } else if (endPose) {
    camera.position.lerp(endPose.position, Math.min(dt * 2.5, 1));
    camera.lookAt(endPose.lookAt);
    wasEndPhase = true;
  } else {
    if (wasEndPhase) {
      // Explicit full pose reset on the transition out of 'ended':
      // position, lookAt and the up-vector all snap back to the
      // canonical gameplay framing in one call. updateCameraShake
      // below writes absolute position values relative to the
      // cached base, so the snap is locked in even if a residual
      // shake was still decaying when the match ended.
      applyGameplayCameraPose(camera);
      wasEndPhase = false;
    }
    updateCameraShake(camera, baseCamX, baseCamY, baseCamZ, dt);
  }
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
