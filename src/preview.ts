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

// Auto-fit target — every critter is uniformly scaled so its
// VISIBLE silhouette HEIGHT lands on this value. We measure the
// LIVE world bbox (skipping invisible procedural placeholders) on
// every frame until the envelope stabilises, because Tripo critters
// have decorative non-skinned Mesh nodes parented to bones; the
// idle clip moves those bones, so the silhouette grows over the
// first second of playback. The previous build trusted the static
// `Critter.bindPoseHeight` (frame 1/30 of idle) which underestimated
// the steady-state silhouette by 30–60% on Trunk / Sergei / Kermit,
// pushing them past the camera's vertical frustum.
const TARGET_HEIGHT = 1.9;

// Camera-fit knobs.
//
// PADDING multiplies the minimum-fit distance derived from the
// bounding sphere. Sphere (not box) so the silhouette never clips
// when the user spins the model — sphere radius is rotation-invariant.
// 1.35 leaves a noticeable margin around the bichito on every side
// at every rotation. Tighter values (we tried 1.18) clipped on the
// widest builds (gorilla, elephant, frog antennae).
const FIT_PADDING = 1.35;
//
// Distance floor — keeps tiny critters (Sebastian / Sihans) from
// getting glued to the lens, where perspective skew makes them look
// distorted. Lowered from 5.6 to 4.6 so the "small builds look small"
// reading is preserved relative to the pedestal scale.
const MIN_FIT_DISTANCE = 4.6;

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
// one visible mesh contributed to the live bbox). The scale itself
// is computed from the live bbox, NOT from the stale
// `Critter.bindPoseHeight` snapshot, because per-bone non-skinned
// decoration meshes (Tripo) move with idle and inflate the bbox
// over the first ~half second.
//
// `maxSphereRadius` tracks the LARGEST bounding-sphere radius seen
// across recent ticks. The camera distance is recomputed from this
// monotonic envelope so it only ever pushes back, never zooms in.
// `framesSinceGrowth` lets us stop measuring after the silhouette
// has plateaued — keeps `tickPreview` cheap for the steady state.
let scaleApplied = false;
let maxSphereRadius = 0;
let lastSphereCenterY = 0;
let framesSinceGrowth = 0;
const FIT_STABLE_FRAMES = 90;       // ~1.5 s at 60 fps
const FIT_GROWTH_THRESHOLD = 0.02;  // re-fit when sphere grows >2 %

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
    scene, holder, critter, camera, visible, scaleApplied, maxSphereRadius, framesSinceGrowth,
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

  // Ease drag rotation toward its target. We also rotate AFTER the
  // measurement so the bbox we sample reflects the current pose, not
  // the post-rotation orientation. (Sphere fit is rotation-invariant
  // anyway, but reading at rotation=0 is a touch cheaper for Box3.)
  const f = Math.min(dt * ROTATION_SMOOTH_SPEED, 1);
  currentRotationY += (targetRotationY - currentRotationY) * f;

  // Step 2: maintain the auto-fit envelope.
  if (fitWrapper) {
    if (!scaleApplied) {
      // First-frame scale: measure the LIVE silhouette and uniform-scale
      // the wrapper so it's TARGET_HEIGHT tall. We can't trust
      // `Critter.bindPoseHeight` because Tripo critters have non-
      // skinned decoration meshes that animate with bones — the
      // bind-pose snapshot underestimates the steady silhouette by
      // 30–60 % on the heavier builds.
      //
      // Gate: wait for `Critter.bindPoseHeight != null`, which signals
      // that `attachGlbMesh` has completed (the GLB scene graph has
      // been parented and procedural body+head hidden). Without this
      // gate we'd scale the procedural placeholder ovoids, then never
      // re-fit when the GLB later attaches with a wildly different
      // silhouette. (`bindPoseHeight` itself is unreliable for the
      // ACTUAL scale value — see comment above — but as a "GLB ready"
      // signal it is correct.)
      if (critter.bindPoseHeight == null || !critter.glbMesh) {
        // GLB still loading. Skip until the next tick.
      } else {
        const savedRotY = holder.rotation.y;
        holder.rotation.y = 0;
        fitWrapper.scale.setScalar(1);
        const rawSize = measureVisibleSize(fitWrapper);
        if (rawSize && rawSize.y > 0.1) {
          const k = TARGET_HEIGHT / rawSize.y;
          fitWrapper.scale.setScalar(k);
          scaleApplied = true;
          maxSphereRadius = 0;
          framesSinceGrowth = 0;
        }
        holder.rotation.y = savedRotY;
      }
    } else if (framesSinceGrowth < FIT_STABLE_FRAMES) {
      // Steady-state envelope tracking: sample the bounding sphere and
      // grow `maxSphereRadius` if the current silhouette pushed past
      // the previous max. The camera fit is recomputed only when the
      // envelope expands meaningfully, so we don't redo trig every
      // frame for a critter that's already settled.
      const sphere = measureVisibleSphere(fitWrapper);
      if (sphere && sphere.radius > maxSphereRadius * (1 + FIT_GROWTH_THRESHOLD)) {
        maxSphereRadius = sphere.radius;
        lastSphereCenterY = sphere.center.y;
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
 * Pull the camera back / re-aim its lookAt so the current bounding
 * sphere fits the canvas aspect with margin. Called:
 *   · whenever the live envelope (`maxSphereRadius`) grows past the
 *     previous fit (see tickPreview's growth check).
 *   · on resize (aspect → horizontal half-FOV → required distance).
 *
 * Math: required distance is `radius / tan(halfFov)`. We compute the
 * value for both vertical and horizontal axes and take the larger
 * — sphere is rotation-invariant so this is the smallest distance
 * that guarantees the silhouette never clips at any drag rotation.
 * The result is multiplied by `FIT_PADDING` for breathing room and
 * clamped to `MIN_FIT_DISTANCE` so tiny critters (Sebastian, Sihans)
 * don't get glued to the lens.
 */
function applyCameraToFit(): void {
  if (!camera || maxSphereRadius <= 0) return;
  const halfFovV = (camera.fov * Math.PI / 180) / 2;
  const halfFovH = Math.atan(Math.tan(halfFovV) * camera.aspect);
  const distForV = maxSphereRadius / Math.tan(halfFovV);
  const distForH = maxSphereRadius / Math.tan(halfFovH);
  const dist = Math.max(MIN_FIT_DISTANCE, Math.max(distForV, distForH) * FIT_PADDING);
  // Aim the camera at the sphere's vertical centre so the framing is
  // symmetric: ear tips and feet land equidistant from the top/bottom
  // of the canvas regardless of how the silhouette's mass distributes.
  camera.position.set(0, lastSphereCenterY, dist);
  camera.lookAt(0, lastSphereCenterY, 0);
}

/**
 * Walk visible descendants of `obj` and union their world bboxes
 * into `out`. Returns true if at least one mesh contributed.
 *
 * Two-tier strategy because the roster mixes two GLB shapes:
 *
 * 1. Tripo critters (Trunk / Shelly / Kermit / Kowalski / Cheeto):
 *    multiple Mesh children parented to skeleton bones. Each Mesh's
 *    `geometry.boundingBox` is small (one body part) but its
 *    `matrixWorld` already captures the bone's current pose, so the
 *    union of per-mesh world bboxes gives a tight, animation-aware
 *    envelope.
 *
 * 2. Meshy critters (Kurama / Sergei / Sihans / Sebastian): one big
 *    SkinnedMesh whose `geometry.boundingBox` is the BIND POSE box.
 *    Idle animation moves bones (Kurama's 9 tails fan out, Sergei's
 *    arms extend) but the bind-pose box doesn't grow with the pose,
 *    so it underestimates the steady silhouette by 30–40 %.
 *
 *    For these we ALSO union every bone's world position in the
 *    skeleton — that gives the skeletal envelope at the current
 *    frame. The skin still extends a bit past the bone tips, so we
 *    keep the geometry box too and take the union of both.
 *
 * Three.js r172 `Box3.setFromObject` doesn't skip invisible objects
 * either, which is why we walk manually (procedural body+head
 * placeholders are visible:false and shouldn't contribute).
 */
function expandByVisibleMeshes(obj: THREE.Object3D, out: THREE.Box3): boolean {
  obj.updateMatrixWorld(true);
  let any = false;
  const tmpBox = new THREE.Box3();
  const tmpVec = new THREE.Vector3();
  obj.traverse((node) => {
    if (!node.visible) return;
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (local) {
      tmpBox.copy(local).applyMatrix4(mesh.matrixWorld);
      out.union(tmpBox);
      any = true;
    }
    // SkinnedMesh tier 2: union bone world positions so the envelope
    // tracks the current pose (idle anim, drag rotation, etc.). Bind-
    // pose `geometry.boundingBox` alone misses the animation reach.
    const skin = mesh as THREE.SkinnedMesh;
    if (skin.isSkinnedMesh && skin.skeleton) {
      for (const bone of skin.skeleton.bones) {
        bone.matrixWorld.decompose(tmpVec, new THREE.Quaternion(), new THREE.Vector3());
        out.expandByPoint(tmpVec);
      }
    }
  });
  return any;
}

/**
 * World-space axis-aligned size of every VISIBLE descendant.
 * Returns null when nothing visible has been added yet (e.g. the
 * GLB hasn't attached).
 */
function measureVisibleSize(obj: THREE.Object3D): THREE.Vector3 | null {
  const bbox = new THREE.Box3();
  if (!expandByVisibleMeshes(obj, bbox) || bbox.isEmpty()) return null;
  return bbox.getSize(new THREE.Vector3());
}

/**
 * World-space bounding sphere of every VISIBLE descendant. Used for
 * the camera-fit math — sphere is the natural primitive when the
 * user can rotate the model freely, since its radius doesn't depend
 * on orientation.
 */
function measureVisibleSphere(obj: THREE.Object3D): THREE.Sphere | null {
  const bbox = new THREE.Box3();
  if (!expandByVisibleMeshes(obj, bbox) || bbox.isEmpty()) return null;
  return bbox.getBoundingSphere(new THREE.Sphere());
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
  maxSphereRadius = 0;
  lastSphereCenterY = 0;
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
  // function early-returns when `maxSphereRadius` is still 0).
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
