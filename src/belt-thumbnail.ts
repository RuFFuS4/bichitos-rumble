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
 * Stable, per-belt rotation offset so the grid doesn't render every
 * thumbnail at the exact same angle. Hashes the beltId into the range
 * [-0.18, +0.18] rad (≈ ±10°). Cinco valores discretos para que
 * belts vecinos no parezcan idénticos pero la lectura siga ordenada.
 */
function beltOrientationOffset(beltId: string): number {
  let h = 0;
  for (let i = 0; i < beltId.length; i++) h = (h * 31 + beltId.charCodeAt(i)) | 0;
  const bucket = ((h % 5) + 5) % 5;       // 0..4
  return (bucket - 2) * 0.09;              // -0.18, -0.09, 0, 0.09, 0.18 rad
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
      // BLOQUE FINAL micropass — antes todos los belts apuntaban a la
      // misma esquina (rotación fija -π/12). Ahora un ángulo base
      // ligeramente más cinematográfico (-π/7 ≈ -25 °) + una variación
      // determinística per-beltId para que la grid no se vea como una
      // fila idéntica. La variación se mantiene pequeña (±0.18 rad ≈
      // ±10 °) para preservar consistencia, y un leve tilt frontal
      // (rotation.x ~0.10) hace que la medalla capte la key light.
      const baseY = -Math.PI / 7;
      const variantY = beltOrientationOffset(beltId);
      glb.rotation.y = baseY + variantY;
      glb.rotation.x = 0.10;

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
