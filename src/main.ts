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
import { tickAbilityZones, isInsideZoneOfKind } from './abilities';
import { tickProjectiles } from './projectiles';
import {
  setCritterStatus,
  updateAllStatusPositions,
  type CritterStatus,
} from './hud/status-icons';
import { initStatusLegend } from './hud/status-legend';
import type { Critter } from './critter';
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

// ---------------------------------------------------------------------------
// Sky / pack background
// ---------------------------------------------------------------------------
//
// Final approach (post 4-iteration debug): use Three.js's built-in
// `scene.background = equirectTexture` skybox path. Three.js renders
// `scene.background` in a dedicated pre-pass before any geometry, with
// a built-in shader that maps the equirect onto a virtual cube around
// the camera. That pre-pass:
//   · ALWAYS fills 100 % of the framebuffer (no edge leaks, no
//     grazing-angle seams)
//   · Has no depth/transparency interactions with scene meshes
//   · Doesn't need a sphere mesh, doesn't need a screen-space quad,
//     doesn't need lighting
//
// We tried both before:
//   1. Camera-parented skydome sphere → equirect read as "south-pole
//      band only" because camera offset.
//   2. World-anchored sphere + MeshStandardMaterial + emissiveMap →
//      vertical seams at frame edges where the backdrop quad's
//      gradient bled through the BackSide sphere at grazing angles.
// Both are now retired.
//
// What stays from the old setup:
//   · DEFAULT_FOG_COLOR / DEFAULT_CLEAR_COLOR for the renderer clear
//     colour and FogExp2 colour. Without a textured pack the menu
//     keeps the original cartoon-blue sky read.
//   · setSceneFogColor / setSceneSkyboxTexture stay as the public API
//     so arena.ts doesn't need to change.

const DEFAULT_FOG_COLOR = 0xb6d1e8;
const DEFAULT_CLEAR_COLOR = 0x87b0d8;

/**
 * Bind the pack's equirect panorama as the scene background, or pass
 * `null` to drop it (menu / no-pack state). Three.js renders this in
 * its built-in skybox pass — guaranteed full-screen coverage, no
 * mesh / depth / transparency stack to worry about.
 *
 * Caller is responsible for ensuring `tex.mapping ===
 * THREE.EquirectangularReflectionMapping` (set in
 * `loadPackSkyboxTexture` so we never have to think about it here).
 */
export function setSceneSkyboxTexture(tex: THREE.Texture | null): void {
  if (tex) {
    if (tex.mapping !== THREE.EquirectangularReflectionMapping) {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.needsUpdate = true;
    }
    scene.background = tex;
  } else {
    scene.background = null;
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
  // Also tint the clear colour so the 1-frame gap before the skybox
  // paints isn't jarring (the old default was a fixed sky blue).
  renderer.setClearColor(color ?? DEFAULT_CLEAR_COLOR);
}

// ---------------------------------------------------------------------------
// Kermit Poison Cloud — local screen-space overlay
// ---------------------------------------------------------------------------
//
// 2026-04-29 K-session — Rafa: "desde dentro, el jugador afectado debe
// ver peor: overlay/fog/máscara screen-space, sensación de visión
// limitada".
//
// Implementation: a CSS overlay <div> stacked above the canvas at
// zIndex 15. The radial gradient fades from a transparent centre to a
// dense toxic-green outer ring, exactly the "I can see right in front
// of me but the edges of my vision are clouded" feeling Rafa asked
// for. Opacity fades in/out over 200 ms via a CSS transition so
// stepping in/out of the cloud reads smoothly. Driven by
// `setPoisonOverlayIntensity(0..1)` — game.ts checks the local
// critter against `isInsideZoneOfKind('poison')` each frame.
//
// Why CSS instead of a Three.js shader quad: the skybox debacle
// already showed that screen-space transparent meshes interact in
// unpleasant ways with depth/transparency at frame edges. CSS
// composites at the browser level — no Three.js render order, no
// depth, no transparency stacking. Free.
// 2026-04-29 K-refinement — Rafa: "se sigue viendo fuera del círculo,
// debe oscurecerse / apagarse mucho más todo lo que está fuera". Two
// stacked layers do the trick:
//   1. `poisonInner` — soft green tint for the centre (subtle hint
//      of poisoned air).
//   2. `poisonOuter` — much denser radial vignette darkening the
//      OUTSIDE of the visible centre. Multiply blend so the
//      arena/critters underneath are crushed to near-black at the
//      frame edges. Only a small "clear" port stays visible at the
//      centre — exactly the "I can see right in front but not
//      around me" reading Rafa asked for.
const poisonInner = document.createElement('div');
poisonInner.id = 'poison-overlay-inner';
Object.assign(poisonInner.style, {
  position: 'fixed', inset: '0',
  pointerEvents: 'none',
  background: 'radial-gradient(ellipse at center, rgba(70,200,90,0.18) 0%, rgba(70,200,90,0) 38%)',
  opacity: '0',
  transition: 'opacity 0.20s ease-in-out',
  zIndex: '15',
  mixBlendMode: 'screen',
} as CSSStyleDeclaration);
document.body.appendChild(poisonInner);

const poisonOuter = document.createElement('div');
poisonOuter.id = 'poison-overlay-outer';
Object.assign(poisonOuter.style, {
  position: 'fixed', inset: '0',
  pointerEvents: 'none',
  // Crystal-clear at the very centre, dense toxic dark from 35 % out
  // to the edges. Multiply blend so the underlying frame is crushed.
  background: 'radial-gradient(ellipse at center, rgba(255,255,255,1) 0%, rgba(255,255,255,1) 18%, rgba(78,200,70,0.5) 40%, rgba(20,50,15,0.92) 75%, rgba(8,20,5,0.98) 100%)',
  opacity: '0',
  transition: 'opacity 0.20s ease-in-out',
  zIndex: '16',
  mixBlendMode: 'multiply',
} as CSSStyleDeclaration);
document.body.appendChild(poisonOuter);

/** Set the Kermit Poison Cloud overlay opacity (0 hidden, 1 full
 *  toxic blackout). Game.ts feeds either 0 or 1 each frame depending
 *  on whether the local critter is standing inside a poison zone;
 *  the CSS transition smooths the cut. Both inner tint and outer
 *  vignette layers are driven from the same value so the read is
 *  cohesive. */
export function setPoisonOverlayIntensity(t: number): void {
  const v = Math.max(0, Math.min(1, t));
  poisonInner.style.opacity = String(v);
  poisonOuter.style.opacity = String(v);
}

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

// Add the camera to the scene graph. With the skybox now rendered via
// `scene.background = equirectTexture` (Three.js built-in pre-pass)
// there's no camera-attached backdrop to wire up — the camera just
// needs to live in the scene so transforms apply.
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
// Status effects legend — "?" button injected into #hud-settings + a
// togglable popup with the icon catalogue. Idempotent, lives outside
// pause flow so it works in online matches too.
initStatusLegend();
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

/**
 * Build the status-set for a critter from its instantaneous state.
 * Pure: takes a Critter, returns a fresh Set<CritterStatus>. The
 * HUD layer diffs the result against its previous render so the DOM
 * only mutates when a glyph actually changes.
 *
 * Mapping rules (2026-04-29 final-K):
 *   · stunTimer > 0           → 'stunned' + 'vulnerable'
 *   · slowTimer > 0           → 'frozen' (Snowball is the only
 *                                 setter — frost cyan tint already
 *                                 paired with the icon)
 *   · selfTintTimer > 0 with Shelly's metallic tint → 'steel-shell'
 *   · invisibilityTimer > 0 + Kurama → 'decoy-ghost'
 *   · ability frenzy slot active and out of windup → 'frenzy'
 *   · standing in a 'poison' zone (and not Kermit himself)
 *                             → 'poisoned'
 *   · standing in a 'sand' zone (and not Sihans herself)
 *                             → 'slowed'
 */
const EMPTY_STATUS_SET: ReadonlySet<CritterStatus> = new Set();
function computeCritterStatuses(c: Critter): Set<CritterStatus> {
  const out = new Set<CritterStatus>();
  if (c.stunTimer > 0) {
    out.add('stunned');
    out.add('vulnerable');
  }
  if (c.slowTimer > 0) out.add('frozen');
  if (c.config.name === 'Shelly' && c.selfTintTimer > 0) out.add('steel-shell');
  if (c.config.name === 'Kurama' && c.invisibilityTimer > 0) out.add('decoy-ghost');
  // Frenzy slot is ability index 2 in our kits.
  const frenzy = c.abilityStates[2];
  if (frenzy?.active && frenzy.windUpLeft <= 0) out.add('frenzy');
  // Zones — only count enemy zones (caster is exempt by name).
  if (c.config.name !== 'Kermit' && isInsideZoneOfKind(c.x, c.z, 'poison')) out.add('poisoned');
  if (c.config.name !== 'Sihans' && isInsideZoneOfKind(c.x, c.z, 'sand')) out.add('slowed');
  return out;
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
    // Ability zones (Kermit Poison Cloud, Sihans Quicksand, Kowalski
    // legacy Arctic Burst). Same gating as dust puffs — pause should
    // freeze the slow-zone timer too so a zone doesn't quietly expire
    // while the menu is up.
    tickAbilityZones(dt);
    // 2026-04-29 K-session — Kowalski Snowball projectile tick.
    // Integrates position + sweeps collision (offline) or just
    // advances the visual mesh (online; collision is server-driven).
    // Same pause gating as zones: pause freezes the bullets.
    tickProjectiles(dt, game.getActiveCritters());
    // 2026-04-29 K-session — Kermit Poison Cloud screen-space overlay.
    // The local critter inside any 'poison'-kind zone gets a CSS
    // toxic-green vignette overlay. CSS handles the fade in/out via
    // a 200 ms transition; we just feed it a 0/1 each frame.
    //
    // 2026-04-29 final-K (Rafa: "estar dentro debe dar sensación
    // real de cegado por veneno") — when the local critter is
    // inside, every OTHER critter that's outside the cloud gets
    // its `fadeAlpha` driven down to 0.10 so the viewer can barely
    // see them. Critters inside the same cloud stay visible.
    const localPos = game.getLocalPlayerPos();
    const insidePoison = !!localPos && localPos.alive
      && isInsideZoneOfKind(localPos.x, localPos.z, 'poison');
    setPoisonOverlayIntensity(insidePoison ? 1 : 0);
    const allCritters = game.getActiveCritters();
    if (insidePoison) {
      for (const c of allCritters) {
        if (!c.alive) { c.fadeAlpha = null; continue; }
        // Skip self — never fade the local viewer.
        if (localPos && c.x === localPos.x && c.z === localPos.z && c.config.name === localPos.critterName) {
          c.fadeAlpha = null;
          continue;
        }
        c.fadeAlpha = isInsideZoneOfKind(c.x, c.z, 'poison') ? null : 0.10;
      }
    } else {
      for (const c of allCritters) c.fadeAlpha = null;
    }
    // 2026-04-29 final-K — status icons. Recalculate the active
    // status set per critter each frame and let the HUD layer
    // diff/render the emoji glyphs above each head.
    for (const c of allCritters) {
      if (!c.alive) {
        setCritterStatus(c, EMPTY_STATUS_SET);
        continue;
      }
      setCritterStatus(c, computeCritterStatuses(c));
    }
    updateAllStatusPositions(camera, {
      width: renderer.domElement.clientWidth,
      height: renderer.domElement.clientHeight,
    });
  } else {
    // Paused: drop the overlay so the pause menu reads cleanly.
    setPoisonOverlayIntensity(0);
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
