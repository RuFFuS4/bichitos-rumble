import * as THREE from 'three';
import { Critter, type CritterConfig } from './critter';

// ---------------------------------------------------------------------------
// PreviewScene — isolated WebGL renderer for menu 3D previews
// ---------------------------------------------------------------------------
//
// General-purpose mini 3D viewport. Currently used by the character select
// to show the selected critter rotating on a pedestal.
//
// Also reusable for future menus: winner posing screen, achievements, etc.
// Keep this module free of gameplay logic.
// ---------------------------------------------------------------------------

// Pedestal dimensions — beefed up from the first pass so the trophy
// silhouette reads clearly at every viewport size. The critter sits
// slightly above the rim to avoid feet clipping into the stone.
const PEDESTAL_HEIGHT = 0.55;
const PEDESTAL_RADIUS_TOP = 1.55;
const PEDESTAL_RADIUS_BOT = 1.85;
const CRITTER_LIFT = PEDESTAL_HEIGHT + 0.06;

// Auto-fit target — every critter is uniformly scaled so the max
// dimension of its idle-pose silhouette (height OR width OR depth)
// lands on this value. Preserves per-critter proportions (Trunk tall
// and slim, Sebastian wide and short, Sihans long and low) while
// keeping the roster visually coherent at the same "size on pedestal".
const TARGET_SILHOUETTE_MAX = 1.9;

// Manual rotation smoothing (drag → target, render → eased)
const ROTATION_SMOOTH_SPEED = 12;

let canvas: HTMLCanvasElement | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let holder: THREE.Group | null = null;
/** Inner group that owns the per-critter uniform scale. Kept separate
 *  from `holder` so drag rotation stays at identity for the fit math. */
let fitWrapper: THREE.Group | null = null;
let critter: Critter | null = null;
let visible = false;

// Auto-fit state — a short polling pass runs after each swap. It
// accumulates the MAX silhouette envelope across ~1 second of idle
// loop (some clips move enough that a single-frame measurement would
// undersize the critter for parts of its cycle). Once the sample
// window closes, applies the uniform scale and releases the interval.
let fitIntervalId: number | null = null;
let fitStartedAt = 0;
let fitMaxDim = 0;
const FIT_SAMPLE_MS = 900;
const TMP_BOX = new THREE.Box3();
const TMP_VEC = new THREE.Vector3();

// Rotation state
let targetRotationY = 0;
let currentRotationY = 0;

// Drag state
let isDragging = false;
let lastPointerX = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Initialize the preview once (after the canvas element exists in the DOM). */
export function initPreview(canvasEl: HTMLCanvasElement): void {
  if (renderer) return; // idempotent
  canvas = canvasEl;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // transparent — the HTML backdrop shows through

  scene = new THREE.Scene();

  // Framing: the critter is uniformly scaled to ~1.9u silhouette, so
  // the camera is tuned around that target. FOV 30° + distance 5.2u
  // yields ~2.8u visible height → ~68% coverage with headroom for
  // idle-loop wiggle. 3/4 hero angle (camera y=2.0, lookAt y=1.05).
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 2.0, 5.2);
  camera.lookAt(0, 1.05, 0);

  // Lighting — three-point rig. Key from front-right for shape, fill
  // from behind-left (cool) for silhouette, ambient keeps shadows lifted.
  const ambient = new THREE.AmbientLight(0xffffff, 0.52);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff2e0, 1.35);
  key.position.set(3, 6, 4);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x9cb8ff, 0.55);
  rim.position.set(-4, 4, -3);
  scene.add(rim);

  // Fill light from below — gives the underside of the head/belly some
  // lift. Otherwise the pedestal's shadow eats the chin.
  const fill = new THREE.DirectionalLight(0xffd89c, 0.25);
  fill.position.set(0, -2, 3);
  scene.add(fill);

  // Pedestal — standard cylinder, will vary per critter later
  buildPedestal();

  // Holder group that gets rotated by drag. The inner fitWrapper owns
  // the per-critter uniform scale so rotation never interferes with
  // the auto-fit transform.
  holder = new THREE.Group();
  holder.position.y = CRITTER_LIFT;
  fitWrapper = new THREE.Group();
  holder.add(fitWrapper);
  scene.add(holder);

  // Pointer handlers for drag rotation (desktop + mobile via pointer events)
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  // Size
  resize();
  window.addEventListener('resize', resize);
}

/** Show the preview and swap in the specified critter. */
export function showPreview(config: CritterConfig): void {
  if (!scene || !holder) return;
  visible = true;
  swapCritter(config);
  // Reset rotation so the critter always faces the camera on first show
  targetRotationY = 0;
  currentRotationY = 0;
  holder.rotation.y = 0;
  resize();
}

/** Hide the preview (stops rendering). */
export function hidePreview(): void {
  visible = false;
}

/** Swap the critter mesh without resetting rotation (useful when navigating with arrow keys). */
export function swapPreviewCritter(config: CritterConfig): void {
  swapCritter(config);
}

// Debug-only read hook for MCP / devtools during the character-select
// polish pass. Returns the current preview critter + scene refs.
// Removed before ship.
if (typeof window !== 'undefined') {
  (window as unknown as { __previewSnap?: () => unknown }).__previewSnap = () => ({
    scene, holder, critter, camera,
  });
}

/** Call every frame from main loop. Renders if visible. */
export function tickPreview(dt: number): void {
  if (!visible || !renderer || !scene || !camera || !holder || !critter) return;

  // Ease current rotation toward target
  const f = Math.min(dt * ROTATION_SMOOTH_SPEED, 1);
  currentRotationY += (targetRotationY - currentRotationY) * f;
  holder.rotation.y = currentRotationY;

  // Critter idle animation (bob, emissive, etc.) — safe to call with no gameplay
  critter.update(dt);

  renderer.render(scene, camera);
}

/**
 * Samples the live bone silhouette. Tracks the max(h, w, d) so the
 * scale fits the WIDEST-reaching pose across the idle loop — avoids
 * undersizing for critters whose idle has wide arm swings.
 *
 * Runs every frame while the sample window is open; once it closes,
 * applies the uniform scale and clears itself.
 */
function sampleAndMaybeApplyFit(): void {
  if (!critter || !fitWrapper) return;
  const root = critter.mesh;
  root.updateMatrixWorld(true);
  TMP_BOX.makeEmpty();
  root.traverse((n) => {
    if ((n as THREE.Bone).isBone) {
      (n as THREE.Bone).getWorldPosition(TMP_VEC);
      TMP_BOX.expandByPoint(TMP_VEC);
    } else if ((n as THREE.Mesh).isMesh && !(n as THREE.SkinnedMesh).isSkinnedMesh) {
      const m = n as THREE.Mesh;
      if (!m.visible) return;
      TMP_BOX.expandByObject(m);
    }
  });
  if (!TMP_BOX.isEmpty()) {
    const h = TMP_BOX.max.y - TMP_BOX.min.y;
    const w = TMP_BOX.max.x - TMP_BOX.min.x;
    const d = TMP_BOX.max.z - TMP_BOX.min.z;
    const m = Math.max(h, w, d);
    if (m > fitMaxDim) fitMaxDim = m;
  }
  if (performance.now() - fitStartedAt >= FIT_SAMPLE_MS) {
    if (fitMaxDim > 0.2) {
      fitWrapper.scale.setScalar(TARGET_SILHOUETTE_MAX / fitMaxDim);
    }
    if (fitIntervalId !== null) {
      clearInterval(fitIntervalId);
      fitIntervalId = null;
    }
  }
}

function startAutoFitPoll(): void {
  if (fitIntervalId !== null) {
    clearInterval(fitIntervalId);
    fitIntervalId = null;
  }
  fitStartedAt = performance.now();
  fitMaxDim = 0;
  fitIntervalId = window.setInterval(() => {
    sampleAndMaybeApplyFit();
    // Hard stop guard — should be redundant with the time check
    // inside, but keeps us safe if the critter dismounts mid-sample.
    if (performance.now() - fitStartedAt > FIT_SAMPLE_MS + 2000 && fitIntervalId !== null) {
      clearInterval(fitIntervalId);
      fitIntervalId = null;
    }
  }, 60);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPedestal(): void {
  if (!scene) return;

  // Main stone body — a touch darker than the base so it reads as solid
  // stage material instead of competing with the critter.
  const geo = new THREE.CylinderGeometry(
    PEDESTAL_RADIUS_TOP,
    PEDESTAL_RADIUS_BOT,
    PEDESTAL_HEIGHT,
    32,
  );
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1f2331,
    metalness: 0.35,
    roughness: 0.58,
  });
  const pedestal = new THREE.Mesh(geo, mat);
  pedestal.position.y = PEDESTAL_HEIGHT / 2;
  scene.add(pedestal);

  // Thin top plate to break up the slab and give the rim something to
  // sit on. Subtle lift so it reads as trim, not a full step.
  const plateGeo = new THREE.CylinderGeometry(
    PEDESTAL_RADIUS_TOP + 0.02,
    PEDESTAL_RADIUS_TOP + 0.02,
    0.04,
    32,
  );
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x2d3446,
    metalness: 0.45,
    roughness: 0.45,
  });
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.y = PEDESTAL_HEIGHT + 0.02;
  scene.add(plate);

  // Gold rim around the top — trophy energy, matches the title's accent
  // palette (#ffdc5c) without screaming.
  const rimGeo = new THREE.TorusGeometry(PEDESTAL_RADIUS_TOP + 0.02, 0.05, 8, 48);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xffdc5c,
    emissive: 0xffb830,
    emissiveIntensity: 0.45,
    metalness: 0.7,
    roughness: 0.35,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = PEDESTAL_HEIGHT + 0.05;
  scene.add(rim);

  // Faint floor glow disc behind the pedestal — catches stray light and
  // keeps the composition centered. Low opacity additive so it doesn't
  // clash with the HTML backdrop's own gradient.
  const glowGeo = new THREE.CircleGeometry(PEDESTAL_RADIUS_BOT + 1.0, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffdc5c,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.001;
  scene.add(glow);
}

function swapCritter(config: CritterConfig): void {
  if (!holder || !scene || !fitWrapper) return;

  // Remove previous critter and dispose all its GPU resources.
  // Each Critter has 8 meshes (body, head, 2 eyes, 2 pupils), each with its
  // own geometry + material. Without explicit dispose, Three.js will NOT
  // release them and rapid arrow-key navigation would leak VRAM.
  if (critter) {
    fitWrapper.remove(critter.mesh);
    disposeMeshTree(critter.mesh);
    critter = null;
  }

  // Create a new Critter. The constructor adds its mesh to the scene,
  // so we move it into the fitWrapper immediately.
  critter = new Critter(config, scene);
  scene.remove(critter.mesh);
  fitWrapper.add(critter.mesh);

  // Reset uniform scale and start a fresh sample window. Samples the
  // live idle silhouette for ~1s, then applies the max-dim fit.
  fitWrapper.scale.setScalar(1);
  startAutoFitPoll();
}

/** Recursively dispose all geometries and materials in a mesh tree. */
function disposeMeshTree(root: THREE.Object3D): void {
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else if (mat) {
        mat.dispose();
      }
    }
  });
}

function resize(): void {
  if (!canvas || !renderer || !camera) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Drag rotation handlers
// ---------------------------------------------------------------------------

function onPointerDown(e: PointerEvent): void {
  if (!visible) return;
  isDragging = true;
  lastPointerX = e.clientX;
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e: PointerEvent): void {
  if (!isDragging) return;
  const dx = e.clientX - lastPointerX;
  lastPointerX = e.clientX;
  // 0.01 rad per pixel — smooth but responsive
  targetRotationY += dx * 0.01;
  e.preventDefault();
}

function onPointerUp(e: PointerEvent): void {
  if (!isDragging) return;
  isDragging = false;
  (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
}
