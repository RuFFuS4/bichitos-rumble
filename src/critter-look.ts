import * as THREE from 'three';
import { FEEL } from './gamefeel';

// ---------------------------------------------------------------------------
// Critter look — the cartoon outline around every critter
// ---------------------------------------------------------------------------
//
// Rafa, 2026-09-23: «contorno» on top of the current shading (no toon).
// Rule in STYLE_LOCK.md §Materials; knobs in FEEL.look.
//
// Inverted hull: every mesh of the critter gets a twin that shares its
// geometry and skeleton, drawn with back faces only and pushed out along
// the SKINNED normal in screen space, so it rides every animation for free.
// The push is a world-space width (it grows with the critter on screen)
// clamped to a pixel range, and the hull is pushed back in depth so it
// never paints over the critter's own concave bits.
//
// PRESENTATION ONLY: the hulls are plain meshes under `glbMesh`, tagged
// `userData.critterOutline` so measures (posed-bounds), the Kurama decoy and
// anything else walking the model can skip them.
// ---------------------------------------------------------------------------

/** Single outline colour for the whole roster (STYLE_LOCK.md). The arena
 *  fog tints it like it tints the critter's body, on purpose. */
const OUTLINE_COLOR = 0x1a0820;

/** `?look=plain` turns the outline off for this page load (A/B, captures). */
const URL_PLAIN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('look') === 'plain';

export interface CritterOutline {
  hulls: THREE.Mesh[];
  material: THREE.MeshBasicMaterial;
}

// Last drawing-buffer size and pixel ratio seen by any hull. `onBeforeRender`
// runs before the first compile, so a freshly compiled hull starts from the
// real viewport instead of a placeholder (one frame of giant outline).
const lastViewport = new THREE.Vector2(1920, 1080);
let lastDpr = 1;

/** Is the outline on right now (FEEL.look.outline, unless `?look=plain`)? */
export function outlineEnabled(): boolean {
  return !URL_PLAIN && FEEL.look.outline > 0;
}

/**
 * Give every visible mesh under `root` an outline hull. Call once the GLB
 * is attached, measured and its parts indexed (the hulls must not count in
 * any of those). Returns null for a model with no meshes.
 */
export function attachOutline(root: THREE.Object3D): CritterOutline | null {
  const material = createOutlineMaterial();
  const sources: THREE.Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.visible && !mesh.userData.critterOutline) sources.push(mesh);
  });
  if (!sources.length) {
    material.dispose();
    return null;
  }
  const hulls = sources.map((src) => {
    const skinned = src as THREE.SkinnedMesh;
    let hull: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const skinnedHull = new THREE.SkinnedMesh(skinned.geometry, material);
      skinnedHull.bind(skinned.skeleton, skinned.bindMatrix);
      // Same skinned bounds as its mesh: share them instead of skinning
      // every vertex a second time on the first frame (frustum culling).
      skinnedHull.computeBoundingSphere = () => {
        if (!skinned.boundingSphere) skinned.computeBoundingSphere();
        skinnedHull.boundingSphere = skinned.boundingSphere;
      };
      hull = skinnedHull;
    } else {
      hull = new THREE.Mesh(src.geometry, material);
    }
    hull.name = `${src.name}__outline`;
    hull.userData.critterOutline = true;
    hull.renderOrder = src.renderOrder;
    // The viewport differs per renderer (arena vs character select).
    hull.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(lastViewport);
      lastDpr = renderer.getPixelRatio();
      const u = material.userData.uniforms as OutlineUniforms | undefined;
      if (u) syncUniforms(u);
    };
    src.add(hull);
    return hull;
  });
  return { hulls, material };
}

/** Show or hide the hulls (hidden while the critter is translucent). */
export function setOutlineVisible(outline: CritterOutline | null, visible: boolean): void {
  if (!outline) return;
  const on = visible && outlineEnabled();
  for (const hull of outline.hulls) hull.visible = on;
}

interface OutlineUniforms {
  uViewport: { value: THREE.Vector2 };
  uWidth: { value: number };
  uPx: { value: THREE.Vector2 };
  uPush: { value: number };
}

/** Viewport and FEEL.look knobs into the shader (tunable live). */
function syncUniforms(u: OutlineUniforms): void {
  u.uViewport.value.copy(lastViewport);
  u.uWidth.value = FEEL.look.outlineWidth;
  u.uPx.value.set(FEEL.look.outlineMinPx * lastDpr, FEEL.look.outlineMaxPx * lastDpr);
  u.uPush.value = FEEL.look.outlineDepthPush;
}

function createOutlineMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    const uniforms: OutlineUniforms = {
      uViewport: { value: new THREE.Vector2() },
      uWidth: { value: 0 },
      uPx: { value: new THREE.Vector2() },
      uPush: { value: 0 },
    };
    syncUniforms(uniforms);
    Object.assign(shader.uniforms, uniforms);
    material.userData.uniforms = uniforms;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec2 uViewport;
uniform float uWidth;
uniform vec2 uPx;
uniform float uPush;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  // Skinned normal when there is a skeleton (MeshBasicMaterial computes it
  // under USE_SKINNING), the raw one otherwise.
  #ifdef USE_SKINNING
    vec3 outlineNormal = objectNormal;
  #else
    vec3 outlineNormal = normal;
  #endif
  // Out along the normal as seen on screen: a world width turned into
  // pixels at this depth, clamped to [uPx.x, uPx.y].
  vec3 nView = normalize(normalMatrix * outlineNormal);
  vec2 dirPx = (projectionMatrix * vec4(nView, 0.0)).xy * uViewport;
  float len = length(dirPx);
  if (len > 1e-6) {
    float px = uWidth * projectionMatrix[1][1] * uViewport.y * 0.5 / gl_Position.w;
    px = clamp(px, uPx.x, uPx.y);
    gl_Position.xy += (dirPx / len) * px * 2.0 / uViewport * gl_Position.w;
  }
  // Back in depth ONLY, so the hull hides behind the critter's own
  // surfaces: moving the vertex itself back would also slide it towards
  // the vanishing point (a lopsided ring, half of it gone in close-ups).
  vec4 pushed = projectionMatrix * vec4(mvPosition.xy, mvPosition.z - uPush, 1.0);
  gl_Position.z = pushed.z / pushed.w * gl_Position.w;
}`);
  };
  return material;
}
