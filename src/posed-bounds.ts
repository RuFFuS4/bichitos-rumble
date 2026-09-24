import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Posed bounds — where a rigged model's vertices are THIS frame
// ---------------------------------------------------------------------------
//
// A skinned mesh's `geometry.boundingBox` is its BIND pose, so any box
// built from it misjudges the idle silhouette (the character select
// measured Kermit 3.28 u tall when he stands 1.70). `Box3.setFromObject`
// is no way out either: it ignores `visible` (the hidden procedural
// body/head placeholders count) and its precise mode skins EVERY vertex,
// 250–500 ms per call on the 1–2 M-vertex critters.
//
// Here each visible mesh is read with a fixed vertex stride and every
// sample goes through the live bones (`getVertexPosition`), so the
// measure follows the current pose at a cost linear in the sample count.
// ---------------------------------------------------------------------------

const _vertex = new THREE.Vector3();

/**
 * Call `visit` with the world position of about `samplesPerMesh` posed
 * vertices of every mesh under `root` whose own `visible` flag is on
 * (stride `count / samplesPerMesh`, so small pieces are read whole). The
 * vector passed to `visit` is reused: copy it to keep it.
 */
export function forEachPosedVertex(
  root: THREE.Object3D,
  samplesPerMesh: number,
  visit: (worldPosition: THREE.Vector3) => void,
): void {
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    // Outline hulls (critter-look.ts) repeat their mesh's vertices.
    if (!mesh.isMesh || !mesh.visible || mesh.userData.critterOutline) return;
    const count = mesh.geometry.attributes.position?.count ?? 0;
    const step = Math.max(1, Math.floor(count / samplesPerMesh));
    for (let i = 0; i < count; i += step) {
      visit(mesh.getVertexPosition(i, _vertex).applyMatrix4(mesh.matrixWorld));
    }
  });
}

/**
 * Set `out` to the world-space box of the posed vertices under `root`
 * (see `forEachPosedVertex`). Returns false when nothing was read (no
 * visible mesh yet).
 */
export function measurePosedBox(root: THREE.Object3D, out: THREE.Box3, samplesPerMesh: number): boolean {
  out.makeEmpty();
  forEachPosedVertex(root, samplesPerMesh, (p) => out.expandByPoint(p));
  return !out.isEmpty();
}
