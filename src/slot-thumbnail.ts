// ---------------------------------------------------------------------------
// Character-select slot thumbnails — real 3D critter renders
// ---------------------------------------------------------------------------
//
// Replaces the old coloured circle in each slot with a low-res render of
// the critter's GLB model. Uses a single shared offscreen WebGLRenderer,
// renders each critter once, caches the resulting data-URL, and hands it
// back to hud.ts as a background-image.
//
// Keeps the character-select grid feeling like a real character picker
// instead of a palette of dots.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import type { RosterEntry } from './roster';
import { loadModelWithAnimations } from './model-loader';

const THUMB_SIZE = 128; // px — rendered square, downscaled visually in CSS

const cache = new Map<string, string>(); // entry.id → data URL
const inflight = new Map<string, Promise<string | null>>();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let holder: THREE.Group | null = null;

function initSharedScene(): void {
  if (renderer) return;

  // `preserveDrawingBuffer` is needed so toDataURL() captures the rendered
  // frame instead of an empty canvas (the default clears after composite).
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  // Critter stands ~2m tall (bounds ±0.5 scaled 2×). Camera is pulled back
  // enough to frame the WHOLE body with some headroom so nothing gets
  // clipped in the 128×128 thumbnail.
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 1.3, 4.5);
  camera.lookAt(0, 1.0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.35);
  rim.position.set(-3, 2, -2);
  scene.add(rim);

  holder = new THREE.Group();
  scene.add(holder);
}

/**
 * Returns a data URL for a small 3D render of this critter, or null if the
 * entry has no GLB. Cached per entry.id — subsequent calls are instant.
 */
export function getCritterThumbnail(entry: RosterEntry): Promise<string | null> {
  const cached = cache.get(entry.id);
  if (cached) return Promise.resolve(cached);
  if (!entry.glbPath) return Promise.resolve(null);
  const pending = inflight.get(entry.id);
  if (pending) return pending;

  const p = (async () => {
    try {
      initSharedScene();
      if (!renderer || !scene || !camera || !holder) return null;

      const { scene: glb, animations } = await loadModelWithAnimations(entry.glbPath!);
      glb.scale.setScalar(entry.scale);
      glb.rotation.y = entry.rotation;
      glb.position.set(entry.offset[0], entry.offset[1] + entry.pivotY, entry.offset[2]);

      // Clear any prior critter and install this one
      while (holder.children.length > 0) {
        const c = holder.children[0];
        holder.remove(c);
        c.traverse(n => {
          if (n instanceof THREE.Mesh) {
            n.geometry?.dispose();
            const m = n.material;
            if (Array.isArray(m)) m.forEach(mm => mm.dispose());
            else if (m) (m as THREE.Material).dispose();
          }
        });
      }
      holder.add(glb);

      // 2026-04-30 final-polish — drive the idle clip for ~0.5 s
      // before snapping the thumbnail. Without this, the GLB renders
      // in BIND POSE (T-pose for Mixamo / arms-out for Tripo) which
      // looks broken in the online waiting room. Picking the
      // best-named idle clip is a soft heuristic — fall back to the
      // first clip if none matches; if no clips ship with the GLB,
      // we render bind pose and live with it (rare — only true
      // procedural-only critters, none currently in roster).
      const idleClip = animations.find((c) => /idle|breath|stand/i.test(c.name))
        ?? animations[0]
        ?? null;
      if (idleClip) {
        const mixer = new THREE.AnimationMixer(glb);
        const action = mixer.clipAction(idleClip);
        action.play();
        // Advance to a non-zero pose. 0.5 s is well into the loop for
        // most idles (~1.5 s typical) so the silhouette reads "alive".
        mixer.update(0.5);
        glb.updateMatrixWorld(true);
      }

      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      cache.set(entry.id, url);
      return url;
    } catch (e) {
      console.debug('[thumb] failed for', entry.id, e);
      return null;
    } finally {
      inflight.delete(entry.id);
    }
  })();

  inflight.set(entry.id, p);
  return p;
}
