import * as THREE from 'three';
import { Critter, type CritterConfig } from './critter';
import { forEachPosedVertex } from './posed-bounds';

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

// Auto-fit target — every critter is uniformly scaled so its
// VISIBLE silhouette HEIGHT lands on this value. Measured on the
// POSED vertices (skinned through the live bones, see
// `posed-bounds.ts`). The previous build unioned each mesh's
// bind-pose box with the bone positions: Kermit read 3.28 u for a
// 1.70 u frog and landed at half the size of the rest, the others
// drifted up to 10 %, and the same inflated box fed the camera sphere.
const TARGET_HEIGHT = 1.9;

// Posed-vertex budgets of the two fit measures, spread across the
// critter's visible meshes (see `measureFit`). A sample is one
// skinned vertex (~0.25 µs on a desktop), so the budget — not the
// rig — bounds the cost: Tripo rigs ship 11–18 pieces, Meshy ones a
// single mesh of up to 2 M vertices. The scale is read once per
// critter and wants a tight height; the envelope is re-read every
// frame until it settles (90+ frames), so it stays light: 1000
// samples miss the all-vertex extent by ~1 % (up to ~4 % on the
// many-piece Tripo rigs), which FIT_PADDING swallows, at ~0.4 ms a
// frame (~1.6 ms on a 4× slower CPU).
const FIT_SCALE_SAMPLES = 10000;
const FIT_TRACK_SAMPLES = 1000;

// Camera fit. The critter spins on the holder's Y axis, so what has to
// stay in frame at any drag yaw is a CYLINDER: its height and its turn
// radius (the farthest posed vertex from that axis). Every critter is
// framed as if it were FIT_REFERENCE_RADIUS wide — the widest of the
// roster, Sihans, measured 1.25 u at TARGET_HEIGHT (2026-09-23, every
// vertex across the idle; the slimmest, Kermit, is 0.54) — so all nine
// stand the same height on screen, as they do in the arena. Only a
// critter wider than that pulls the camera back for itself. The old
// fit used a sphere around the world box, which overstated the width
// by 10–35 % and sized each critter by it: 98–288 px on a 440 px canvas.
const FIT_REFERENCE_RADIUS = 1.25;
// Margin over the exact no-clip distance (~265 px of 440 at 500×440).
const FIT_PADDING = 1.2;

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

// Auto-fit state.
//
// `scaleApplied` flips true the first frame we manage to apply a
// uniform scale to the wrapper (i.e. the GLB has loaded and at least
// one visible mesh contributed to the posed box). The scale itself
// is computed from the live pose, NOT from `Critter.bindPoseHeight`,
// which after the in-game fit holds that fit's target height.
//
// `fitTop` / `fitBottom` / `fitRadius` hold the LARGEST extent seen
// across recent ticks (world Y range and turn radius). The camera is
// re-aimed from this monotonic envelope, so it only ever pushes back,
// never zooms in. `framesSinceGrowth` lets us stop measuring after the
// silhouette has plateaued — keeps `tickPreview` cheap for the steady
// state.
let scaleApplied = false;
let fitTop = -Infinity;
let fitBottom = Infinity;
let fitRadius = 0;
let framesSinceGrowth = 0;
const FIT_STABLE_FRAMES = 90;       // ~1.5 s at 60 fps
const FIT_GROWTH_THRESHOLD = 0.02;  // re-fit when the needed distance grows >2 %
const fitBox = new THREE.Box3();
const fitAxis = new THREE.Vector3();
let measuredRadius = 0;

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

  // Framing: critters are uniformly scaled to ~1.9u height. Camera is
  // pulled back a touch (distance 6.2u, slightly lower lookAt) so tall
  // bichitos don't clip the top edge and the pedestal feels "further
  // away" — more stage presence, less mugshot. FOV 32° gives just
  // enough perspective without distorting the silhouette at that
  // distance.
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 2.15, 6.2);
  camera.lookAt(0, 0.95, 0);

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
    scene, holder, critter, camera, visible, scaleApplied, fitTop, fitBottom, fitRadius, framesSinceGrowth,
  });
}

/** Call every frame from main loop. Renders if visible. */
export function tickPreview(dt: number): void {
  if (!visible || !renderer || !scene || !camera || !holder || !critter) return;

  // Step 1: critter idle/bob/emissive update happens BEFORE the bbox
  // measurement so we sample the actual visible silhouette this frame.
  // Order matters — measuring before update would lag a frame and
  // miss any growth caused by the just-played idle keyframe.
  critter.update(dt);

  // Ease drag rotation toward its target. The holder only takes the new
  // yaw AFTER the measurement below; the fit doesn't care, since both
  // the height and the turn radius are the same at any yaw.
  const f = Math.min(dt * ROTATION_SMOOTH_SPEED, 1);
  currentRotationY += (targetRotationY - currentRotationY) * f;

  // Step 2: maintain the auto-fit envelope.
  const glb = critter.glbMesh;
  if (fitWrapper && glb) {
    if (!scaleApplied) {
      // First-frame scale: measure the posed silhouette and uniform-
      // scale the wrapper so it's TARGET_HEIGHT tall. The height of the
      // posed vertices doesn't depend on the drag yaw, so the holder
      // keeps its rotation.
      //
      // Gate: wait for `Critter.bindPoseHeight != null`, which signals
      // that `attachGlbMesh` has completed (the GLB scene graph has
      // been parented and procedural body+head hidden). Without this
      // gate we'd scale the procedural placeholder ovoids, then never
      // re-fit when the GLB later attaches with a wildly different
      // silhouette. (Its value is the in-game fit target, useless as
      // this viewport's scale, but as a "GLB ready" signal it is
      // correct.)
      if (critter.bindPoseHeight != null) {
        fitWrapper.scale.setScalar(1);
        const height = measureFit(glb, FIT_SCALE_SAMPLES) ? fitBox.max.y - fitBox.min.y : 0;
        if (height > 0.1) {
          fitWrapper.scale.setScalar(TARGET_HEIGHT / height);
          scaleApplied = true;
          framesSinceGrowth = 0;
        }
      }
    } else if (framesSinceGrowth < FIT_STABLE_FRAMES) {
      // Steady-state envelope tracking: widen the envelope when this
      // frame's pose pushes past it meaningfully, and only then re-aim
      // the camera — no trig every frame for a critter that has settled.
      const slack = FIT_GROWTH_THRESHOLD * TARGET_HEIGHT;
      const grew = measureFit(glb, FIT_TRACK_SAMPLES) && (
        fitBox.max.y > fitTop + slack ||
        fitBox.min.y < fitBottom - slack ||
        measuredRadius > fitRadius * (1 + FIT_GROWTH_THRESHOLD)
      );
      if (grew) {
        fitTop = Math.max(fitTop, fitBox.max.y);
        fitBottom = Math.min(fitBottom, fitBox.min.y);
        fitRadius = Math.max(fitRadius, measuredRadius);
        framesSinceGrowth = 0;
        applyCameraToFit();
      } else {
        framesSinceGrowth++;
      }
    }
  }

  holder.rotation.y = currentRotationY;
  renderer.render(scene, camera);
}

/**
 * Pull the camera back / re-aim its lookAt so the envelope fits the
 * canvas aspect with margin at any drag yaw. Called:
 *   · whenever the live envelope grows past the previous fit (see
 *     tickPreview's growth check).
 *   · on resize (aspect → horizontal half-FOV → required distance).
 *
 * The distance is the larger of what this critter's cylinder needs and
 * what the reference one needs (FIT_REFERENCE_RADIUS at TARGET_HEIGHT),
 * times FIT_PADDING — so the whole roster shares one camera distance.
 */
function applyCameraToFit(): void {
  if (!camera || !(fitTop > fitBottom)) return;
  const dist = Math.max(
    cylinderDistance(camera, fitTop - fitBottom, fitRadius),
    cylinderDistance(camera, TARGET_HEIGHT, FIT_REFERENCE_RADIUS),
  ) * FIT_PADDING;
  // Aim at the envelope's vertical centre so the framing is symmetric:
  // ear tips and feet land equidistant from the top/bottom of the
  // canvas regardless of how the silhouette's mass distributes.
  const centerY = (fitTop + fitBottom) / 2;
  camera.position.set(0, centerY, dist);
  camera.lookAt(0, centerY, 0);
}

/**
 * Closest distance (camera on the level of the cylinder's centre) at
 * which a cylinder `height` tall and `radius` wide stays in frame while
 * it spins about its axis: its top and bottom rims can swing `radius`
 * towards the lens, and a rim point seen edge-on needs
 * `radius / sin(halfFovH)`.
 */
function cylinderDistance(cam: THREE.PerspectiveCamera, height: number, radius: number): number {
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  const halfFovH = Math.atan(tanV * cam.aspect);
  return Math.max(height / 2 / tanV + radius, radius / Math.sin(halfFovH));
}

/**
 * Posed extent of the critter GLB `glb`, reading about `totalSamples`
 * vertices split evenly across its visible meshes: the world box into
 * `fitBox` and the turn radius (farthest sample from the holder's Y
 * axis) into `measuredRadius`. False while nothing visible is there.
 *
 * The GLB and not the whole critter: the procedural head is hidden
 * once the GLB attaches, but its eyes and pupils keep their own
 * `visible` flag and would count. Its ancestors are refreshed first
 * because `forEachPosedVertex` only updates the subtree, and the
 * wrapper scale and whatever `critter.update` moved above it change
 * during this tick.
 */
function measureFit(glb: THREE.Object3D, totalSamples: number): boolean {
  let meshes = 0;
  glb.traverse((node) => {
    if ((node as THREE.Mesh).isMesh && node.visible) meshes++;
  });
  if (meshes === 0 || !holder) return false;
  glb.updateWorldMatrix(true, false);
  holder.getWorldPosition(fitAxis);
  fitBox.makeEmpty();
  let radius = 0;
  forEachPosedVertex(glb, Math.ceil(totalSamples / meshes), (p) => {
    fitBox.expandByPoint(p);
    radius = Math.max(radius, Math.hypot(p.x - fitAxis.x, p.z - fitAxis.z));
  });
  measuredRadius = radius;
  return !fitBox.isEmpty();
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

  // Reset the fit pipeline so the next critter starts from a clean
  // state. tickPreview re-runs the live measure-and-scale step the
  // first frame the new critter has any visible mesh.
  fitWrapper.scale.setScalar(1);
  scaleApplied = false;
  fitTop = -Infinity;
  fitBottom = Infinity;
  fitRadius = 0;
  framesSinceGrowth = 0;
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
  // Re-fit the camera distance for the new aspect — a narrow window
  // needs the camera further back to keep the silhouette inside the
  // horizontal frustum. No-op when no critter has loaded yet (the
  // function early-returns while the envelope is still empty).
  applyCameraToFit();
  // Reset the steady-state counter so we re-measure once after the
  // resize settles — handles edge cases like dock/undock or a CSS
  // transition that briefly shrinks the canvas.
  framesSinceGrowth = 0;
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
