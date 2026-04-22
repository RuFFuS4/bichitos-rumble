// ---------------------------------------------------------------------------
// Model loader — GLB loading with cache, deep clone, and material isolation
// ---------------------------------------------------------------------------
//
// Single shared loader instance. Callers get independent scene graphs with
// their own materials (safe to modify emissive/opacity per-instance).
//
// Textures (GPU texture objects) are shared across clones by design — they
// are read-only and sharing saves VRAM.
//
// Debug traces: prefixed with [ModelLoader] for easy filtering.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'meshoptimizer';

// ---------------------------------------------------------------------------
// Singleton loader setup
// ---------------------------------------------------------------------------
//
// MeshoptDecoder is wired so we can read GLBs post-processed with
// `gltfpack -c` (meshopt quantization compression). Meshy exports
// multi-million-vert skinned meshes that the gltf-transform simplify
// can't reduce because it isn't skin-aware. gltfpack can, but the
// output requires this decoder at load time. Adds ~20 KB gzipped to
// the bundle — acceptable trade-off for 90%+ size reduction on
// Meshy-sourced GLBs.
//
// Draco compression is NOT currently used — our import-critter.mjs
// pipeline uses meshopt (above) for Meshy inputs and plain simplify
// for Tripo inputs (which already arrive near-optimal). To enable
// Draco in the future:
//   1. Add draco() step to scripts/import-critter.mjs
//   2. Copy decoder from node_modules/three/examples/jsm/libs/draco/ to
//      public/draco/
//   3. Import DRACOLoader and wire:
//        const dracoLoader = new DRACOLoader();
//        dracoLoader.setDecoderPath('./draco/');
//        gltfLoader.setDRACOLoader(dracoLoader);
// ---------------------------------------------------------------------------

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// ---------------------------------------------------------------------------
// Cache: path → { original scene, animations, in-flight promise }
// ---------------------------------------------------------------------------

interface CacheEntry {
  scene: THREE.Group;
  /** Animation clips extracted from the GLB (empty if none). Clips are
   *  immutable data and can safely be shared across cloned meshes — each
   *  Critter gets its own AnimationMixer but binds to the same clips. */
  animations: THREE.AnimationClip[];
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a GLB model and return an independent deep clone with its own materials.
 * Cache hit → returns immediately (cloned). Cache miss → fetches, caches, clones.
 * Concurrent calls for the same path share one fetch (deduplication).
 */
export async function loadModel(glbPath: string): Promise<THREE.Group> {
  const entry = await ensureEntry(glbPath);
  return deepCloneWithMaterials(entry.scene);
}

/**
 * Load a GLB model AND its animation clips. Same caching rules as loadModel.
 * Returns a fresh scene clone each call + the SHARED clip array (clips are
 * immutable and safely shareable across clones — the per-instance
 * AnimationMixer handles binding them to the cloned skeleton).
 *
 * Animations are empty for models that don't ship clips — callers that don't
 * care about animation data can keep using loadModel(). This entry point is
 * specifically for Critter which wires the clips into SkeletalAnimator.
 */
export async function loadModelWithAnimations(glbPath: string): Promise<{
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}> {
  const entry = await ensureEntry(glbPath);
  return {
    scene: deepCloneWithMaterials(entry.scene),
    animations: entry.animations,
  };
}

async function ensureEntry(glbPath: string): Promise<CacheEntry> {
  const cached = cache.get(glbPath);
  if (cached) {
    console.debug('[ModelLoader] cache hit:', glbPath);
    return cached;
  }
  let promise = inFlight.get(glbPath);
  if (!promise) {
    console.debug('[ModelLoader] loading:', glbPath);
    promise = fetchAndCache(glbPath);
    inFlight.set(glbPath, promise);
  } else {
    console.debug('[ModelLoader] joining in-flight load:', glbPath);
  }
  return promise;
}

/**
 * Preload multiple models in parallel. Resolves when all are cached.
 * Failures are logged but do not reject the batch — partial success is OK.
 */
export async function preloadModels(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;

  console.debug('[ModelLoader] preloading', unique.length, 'model(s)');
  const results = await Promise.allSettled(
    unique.map(p => loadModel(p)), // loadModel caches on first call
  );

  let ok = 0;
  let fail = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') ok++;
    else {
      fail++;
      console.warn('[ModelLoader] preload failed:', r.reason);
    }
  }
  console.debug(`[ModelLoader] preload done: ${ok} ok, ${fail} failed`);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function fetchAndCache(glbPath: string): Promise<CacheEntry> {
  try {
    const gltf = await gltfLoader.loadAsync(glbPath);
    const entry: CacheEntry = {
      scene: gltf.scene,
      animations: gltf.animations ?? [],
    };
    cache.set(glbPath, entry);
    inFlight.delete(glbPath);
    const clipInfo = entry.animations.length > 0
      ? ` (${entry.animations.length} clip${entry.animations.length === 1 ? '' : 's'}: ${entry.animations.map(a => a.name).join(', ')})`
      : ' (no animation clips)';
    console.debug('[ModelLoader] cached:', glbPath + clipInfo);
    return entry;
  } catch (err) {
    inFlight.delete(glbPath);
    throw err;
  }
}

/**
 * Clone a scene graph AND create independent material instances.
 * This ensures updateVisuals() can modify emissive/opacity per critter
 * without cross-contamination.
 *
 * Textures (map, normalMap, etc.) stay shared — they are read-only GPU
 * resources and sharing saves VRAM.
 */
function deepCloneWithMaterials(source: THREE.Group): THREE.Group {
  // SkeletonUtils.clone() rebuilds the skeleton + bone references for any
  // SkinnedMesh in the hierarchy so each cloned critter has its own working
  // armature. A plain `source.clone(true)` keeps cloned SkinnedMesh.skeleton
  // pointing at the ORIGINAL Armature in the cache — moving the cloned
  // group then translates the empty/armature node but the vertex positions
  // stay bound to the cached skeleton, which is what produced the "physics
  // moves but visual stays put" symptom on the first rigged Sergei import.
  // Falls back to plain clone(true) for non-skinned models (slightly cheaper),
  // detected by walking the tree once for any SkinnedMesh node.
  let hasSkinnedMesh = false;
  source.traverse((n) => {
    if ((n as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true;
  });

  const cloned = hasSkinnedMesh
    ? (SkeletonUtils.clone(source) as THREE.Group)
    : source.clone(true);

  cloned.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(m => m.clone());
    } else if (mesh.material) {
      mesh.material = mesh.material.clone();
    }
  });

  return cloned;
}
