// ---------------------------------------------------------------------------
// Critter parts — runtime access to the bones and primitives of a GLB
// ---------------------------------------------------------------------------
//
// Companion to `src/critter-skeletal.ts` (which owns the AnimationMixer
// + clip playback). This module is a separate concern: skeletal clips
// drive authored animation; this module lets signature abilities hook
// INDIVIDUAL bones or mesh primitives at runtime.
//
// Why a separate module?
//   - Clips are authored content — if a critter doesn't ship one, the
//     animator just falls back to procedural. Binary on/off.
//   - Parts are structural — ANY GLB exposes them, clipped or not. We
//     need to manipulate them for effects like "Shelly hides her head
//     in the shell" that no clip can express compactly.
//
// Tolerance strategy: everything returns safely when a name isn't there
// (different rigs, Meshy vs Tripo vs hand-built, may name things
// differently). Callers never have to guard. Missing bone → no-op.
//
// See PROCEDURAL_PARTS.md for the per-critter playbook that drove this
// API shape.
// ---------------------------------------------------------------------------

import * as THREE from 'three';

/**
 * Pre-scanned catalog of a critter's addressable pieces. Construction
 * is O(nodes + meshes), which runs once after the GLB clone. Lookups
 * are O(1) via Map.
 */
export interface CritterParts {
  /** Bones available on this skeleton, keyed by name. Empty when the
   *  GLB has no SkinnedMesh. Case-sensitive — consumers should know
   *  the exact names (see inspect-parts output). */
  readonly bones: ReadonlyMap<string, THREE.Bone>;

  /** Mesh primitives on the root, in traversal order. Useful when the
   *  segmentation survived but names were genericized (Tripo's
   *  `Mesh_0.001`..`Mesh_N.001`). */
  readonly primitives: ReadonlyArray<THREE.Mesh>;

  // ---- Bones ---------------------------------------------------------

  /** Lookup a bone by name. `null` when not present on this skeleton. */
  getBone(name: string): THREE.Bone | null;

  /** True when a bone with that exact name exists. */
  hasBone(name: string): boolean;

  /**
   * Uniformly scale a bone. A `factor` of ~0 hides the geometry weighted
   * to it (we use 0.01 internally to avoid NaN in matrix inversion).
   * Storing the original scale on first call enables `resetBone`.
   */
  scaleBone(name: string, factor: number): void;

  /** Conveniencia: scale the bone to 0.01, effectively hiding it. */
  hideBone(name: string): void;

  /** Restore the bone's original scale (whatever it was when first
   *  observed). No-op if we never touched it. */
  resetBone(name: string): void;

  /** Restore every bone we've modified back to its original scale. */
  resetAllBones(): void;

  /** Lookup a primitive by zero-based traversal index (fast) or by a
   *  label previously set via `labelPrimitive`. */
  getPrimitive(indexOrLabel: number | string): THREE.Mesh | null;

  /** Tag a primitive with a stable label so future lookups can use a
   *  semantic name (e.g. `labelPrimitive('trunk-nose', 3)` after a
   *  centroid heuristic identifies which part is the trunk). */
  labelPrimitive(label: string, index: number): void;

  /**
   * Produce a clone of the entire mesh tree with every material replaced
   * by a tinted copy. Used for decoys (Kurama Mirror Trick) or ghost
   * effects. Caller is responsible for adding the clone to a scene and
   * calling `disposeCloneTree` when done.
   *
   * The clone shares GEOMETRY references (cheap) but has its own
   * MATERIAL instances (so opacity / color changes don't affect the
   * original). For a SkinnedMesh source, uses SkeletonUtils.clone to
   * rebuild bones on the clone side (matches the pattern in
   * model-loader.ts).
   */
  cloneTinted(color: number, opacity?: number): THREE.Object3D;
}

/**
 * Build the parts catalog. Safe to call with a non-skinned root — the
 * bones map will just be empty and only primitive lookups work.
 *
 * @param root the cloned GLB root that lives in the scene (typically
 *             `critter.glbMesh`)
 * @param skeleton the skeleton bound to the SkinnedMesh under `root`,
 *                 or `null` if the GLB has no skinning
 */
export function createCritterParts(
  root: THREE.Object3D,
  skeleton: THREE.Skeleton | null,
): CritterParts {
  const bones = new Map<string, THREE.Bone>();
  if (skeleton) {
    for (const bone of skeleton.bones) {
      if (bone.name) bones.set(bone.name, bone);
    }
  }

  const primitives: THREE.Mesh[] = [];
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) primitives.push(child as THREE.Mesh);
  });

  // Per-bone original scale cache — filled lazily on first mutation so
  // resetBone doesn't need a pre-pass over every bone in the rig.
  const originalScales = new Map<string, THREE.Vector3>();
  const labels = new Map<string, number>();

  function rememberScale(name: string, bone: THREE.Bone) {
    if (!originalScales.has(name)) {
      originalScales.set(name, bone.scale.clone());
    }
  }

  const api: CritterParts = {
    bones,
    primitives,

    getBone(name) {
      return bones.get(name) ?? null;
    },

    hasBone(name) {
      return bones.has(name);
    },

    scaleBone(name, factor) {
      const bone = bones.get(name);
      if (!bone) return;
      rememberScale(name, bone);
      // Clamp at a tiny positive so matrix inverse stays stable.
      const f = Math.max(1e-3, factor);
      bone.scale.setScalar(f);
    },

    hideBone(name) {
      api.scaleBone(name, 0.01);
    },

    resetBone(name) {
      const bone = bones.get(name);
      const saved = originalScales.get(name);
      if (!bone || !saved) return;
      bone.scale.copy(saved);
    },

    resetAllBones() {
      for (const [name, saved] of originalScales) {
        const bone = bones.get(name);
        if (bone) bone.scale.copy(saved);
      }
    },

    getPrimitive(indexOrLabel) {
      if (typeof indexOrLabel === 'number') {
        return primitives[indexOrLabel] ?? null;
      }
      const idx = labels.get(indexOrLabel);
      if (idx === undefined) return null;
      return primitives[idx] ?? null;
    },

    labelPrimitive(label, index) {
      if (index < 0 || index >= primitives.length) return;
      labels.set(label, index);
    },

    cloneTinted(color, opacity = 1) {
      // Deep clone the visual tree. We DON'T re-skin the clone here —
      // decoys typically stand still, so sharing the skeleton reference
      // is fine. If a caller needs an independently-posed skinned clone
      // they should use SkeletonUtils.clone directly (see model-loader).
      const clone = root.clone(true);
      const tint = new THREE.Color(color);
      clone.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const srcMat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(srcMat)) {
          mesh.material = srcMat.map((m) => tintedClone(m, tint, opacity));
        } else if (srcMat) {
          mesh.material = tintedClone(srcMat, tint, opacity);
        }
      });
      return clone;
    },
  };

  return api;
}

/**
 * Helper to duplicate a material with an overriding color + opacity.
 * Keeps texture references intact (so the decoy still has the critter's
 * albedo, just re-tinted).
 */
function tintedClone(
  src: THREE.Material,
  tint: THREE.Color,
  opacity: number,
): THREE.Material {
  const copy = src.clone();
  // Standard + Phong + Basic all expose `.color` + `.transparent` +
  // `.opacity`. Anything exotic (raw shaders) ends up untouched, which
  // is fine — the caller can override afterward.
  const anyCopy = copy as unknown as {
    color?: THREE.Color;
    transparent?: boolean;
    opacity?: number;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  if (anyCopy.color) anyCopy.color.copy(tint);
  if (anyCopy.emissive) anyCopy.emissive.copy(tint).multiplyScalar(0.4);
  anyCopy.transparent = opacity < 1;
  anyCopy.opacity = opacity;
  return copy;
}

/**
 * Dispose a clone produced by `cloneTinted` — releases the (cloned)
 * materials. Geometry is shared with the source, so do NOT dispose it.
 */
export function disposeCloneTree(clone: THREE.Object3D): void {
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else if (mat) mat.dispose();
  });
}
