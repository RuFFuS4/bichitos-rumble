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
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// ---------------------------------------------------------------------------
// Singleton loader setup
// ---------------------------------------------------------------------------

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

// ---------------------------------------------------------------------------
// Cache: path → { original scene, in-flight promise }
// ---------------------------------------------------------------------------

interface CacheEntry {
  scene: THREE.Group;
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
  // Cache hit: clone and return
  const cached = cache.get(glbPath);
  if (cached) {
    console.debug('[ModelLoader] cache hit:', glbPath);
    return deepCloneWithMaterials(cached.scene);
  }

  // Deduplicate in-flight loads
  let promise = inFlight.get(glbPath);
  if (!promise) {
    console.debug('[ModelLoader] loading:', glbPath);
    promise = fetchAndCache(glbPath);
    inFlight.set(glbPath, promise);
  } else {
    console.debug('[ModelLoader] joining in-flight load:', glbPath);
  }

  const entry = await promise;
  return deepCloneWithMaterials(entry.scene);
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
    const entry: CacheEntry = { scene: gltf.scene };
    cache.set(glbPath, entry);
    inFlight.delete(glbPath);
    console.debug('[ModelLoader] cached:', glbPath);
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
  const cloned = source.clone(true);

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
