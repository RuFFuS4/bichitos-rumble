// ---------------------------------------------------------------------------
// Belt thumbnail renderer — small 3D snapshots of belt GLBs
// ---------------------------------------------------------------------------
//
// 2026-05-01 final block — replaces the 2D /images/belts/*.png artwork in
// the Hall of Belts grid + end-screen unlock toasts with rendered 3D
// snapshots of /models/belts/<beltId>.glb. Uses the same shared offscreen
// renderer pattern slot-thumbnail.ts proved out for critter slots, so we
// pay one canvas + one renderer instance for the whole catalogue.
//
// Public surface:
//   getBeltThumbnail(beltId): Promise<string | null>
//     → resolves with a data-URL PNG of the belt GLB, or null if the GLB
//       failed to load. Cached per beltId — subsequent calls are free.
//
// Each belt model is loaded lazily on first request; the offscreen
// renderer's drawing buffer (preserveDrawingBuffer: true) lets us
// toDataURL after a single render call.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { loadModel } from './model-loader';

const THUMB_SIZE = 144; // px (rendered square, downscaled visually in CSS)

// ---------------------------------------------------------------------------
// Shared belt-pose constants — used by belt-thumbnail (grid + toasts) AND by
// belt-viewer (modal). Kept here as the single source of truth so the
// thumbnail and the viewer can never drift.
//
// Empirical: GLBs in /models/belts/*.glb export with the medallion facing
// +X by convention (Tripo default). The thumbnail camera lives at +Z
// looking toward origin, so without correction the medallion sits 90° off
// to the right (Rafa screenshot: "miran hacia la derecha"). A -π/2 yaw
// rotates the medallion to face +Z (toward the camera), reading frontal.
// If a future belt GLB happens to export with a different convention we
// override per-id below; for now all five online + eleven offline GLBs
// share the same export.
// ---------------------------------------------------------------------------
export const BELT_FRONT_ROTATION_Y = -Math.PI / 2;  // 90° CW around Y → frontal
export const BELT_PREVIEW_ROTATION_X = 0.06;        // tiny upward tilt for relief

const cache = new Map<string, string>();           // beltId → data URL
const inflight = new Map<string, Promise<string | null>>();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let holder: THREE.Group | null = null;

function initSharedScene(): void {
  if (renderer) return;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  // Belt GLBs are roughly 1-2 m wide, 0.6-1.2 m tall. Camera framed
  // tight on the centre of the model with a slight tilt so the
  // medallion catches the light.
  camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  camera.position.set(0, 0.6, 3.0);
  camera.lookAt(0, 0, 0);

  // Three-point lighting tuned for shiny metallic accents — most
  // belts are leather + gold so we want a key light, a soft fill,
  // and a rim that hits the edges of the medallion.
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffe8b8, 1.4);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
  rim.position.set(-3, 1, -2);
  scene.add(rim);

  holder = new THREE.Group();
  scene.add(holder);
}

/** Belt id → file path. Falls back to id-based path under /models/belts. */
function beltGlbPath(beltId: string): string {
  return `./models/belts/${beltId}.glb`;
}

/**
 * Stable, per-belt rotation offset. Rafa pidió frontal limpio en el
 * BLOQUE FINALÍSIMO, así que la variación se mantiene mínima
 * — ±0.02 rad ≈ ±1 ° — sólo para que la grid no parezca un copia y
 * pega exacto. Hash determinístico per-id → mismo belt siempre igual.
 */
function beltOrientationOffset(beltId: string): number {
  let h = 0;
  for (let i = 0; i < beltId.length; i++) h = (h * 31 + beltId.charCodeAt(i)) | 0;
  const bucket = ((h % 5) + 5) % 5;       // 0..4
  return (bucket - 2) * 0.01;              // -0.02, -0.01, 0, 0.01, 0.02 rad
}

/**
 * Returns a data-URL PNG of the belt GLB rendered to a 144×144 canvas.
 * Cached per beltId; subsequent calls resolve synchronously from cache.
 * Returns null when the GLB fails to load.
 */
export function getBeltThumbnail(beltId: string): Promise<string | null> {
  const cached = cache.get(beltId);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(beltId);
  if (pending) return pending;

  const p = (async (): Promise<string | null> => {
    try {
      initSharedScene();
      if (!renderer || !scene || !camera || !holder) return null;

      const glb = await loadModel(beltGlbPath(beltId));

      // Auto-fit: measure bbox at unit scale and rescale so the
      // longest axis fills ~80 % of the camera's view. Without this
      // belt models exported at different native sizes show up at
      // wildly different visual scales in the grid.
      glb.scale.setScalar(1);
      glb.position.set(0, 0, 0);
      glb.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(glb);
      const size = bbox.getSize(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z);
      if (maxAxis > 0.001) {
        const targetMax = 1.6;
        glb.scale.setScalar(targetMax / maxAxis);
        glb.updateMatrixWorld(true);
        const recentred = new THREE.Box3().setFromObject(glb);
        const c = recentred.getCenter(new THREE.Vector3());
        glb.position.x = -c.x;
        glb.position.y = -c.y + 0.05;
        glb.position.z = -c.z;
      }
      // BLOQUE FINALÍSIMO — los GLBs exportan con el medallón mirando
      // +X (default Tripo); con la cámara en +Z eso lo dejaba 90° a
      // la derecha. Aplicamos `BELT_FRONT_ROTATION_Y` (-π/2) para
      // ponerlos frontales + variación determinística MUY pequeña
      // per-id (±0.02 rad ≈ ±1 °) que rompe la lectura "todos
      // idénticos" sin meterles ladeo. Tilt vertical sutil para
      // que la key light marque relieve.
      const variantY = beltOrientationOffset(beltId);
      glb.rotation.y = BELT_FRONT_ROTATION_Y + variantY;
      glb.rotation.x = BELT_PREVIEW_ROTATION_X;

      while (holder.children.length > 0) {
        const c = holder.children[0];
        holder.remove(c);
        c.traverse((n) => {
          if (n instanceof THREE.Mesh) {
            n.geometry?.dispose();
            const m = n.material;
            if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
            else if (m) (m as THREE.Material).dispose();
          }
        });
      }
      holder.add(glb);

      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      cache.set(beltId, url);
      return url;
    } catch (e) {
      console.debug('[belt-thumbnail] failed for', beltId, e);
      return null;
    } finally {
      inflight.delete(beltId);
    }
  })();

  inflight.set(beltId, p);
  return p;
}
