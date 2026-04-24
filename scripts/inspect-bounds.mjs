#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Critter GLB bounding box + bone inventory
// ---------------------------------------------------------------------------
//
// When a new critter GLB lands (Meshy / Tripo / Mixamo), the roster
// entry needs a scale + pivotY tuned against its local coordinate
// space. Different pipelines use different conventions:
//   - Tripo     : mesh origin at feet, +X forward, Y up
//   - Meshy AI  : mesh centered at hip, Z forward, Y up, ~1m tall
//   - Mixamo    : mesh centered, Y up, 1m tall
//
// This script reports: axis-aligned bounding box of the mesh, plus
// suggested scale (to normalize critter to the in-game 1.6u tall
// baseline) and pivotY (to snap feet to ground).
//
// Read-only. No effect on the GLB file.
//
// Usage:
//   node scripts/inspect-bounds.mjs public/models/critters/<id>.glb
// ---------------------------------------------------------------------------

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/inspect-bounds.mjs <glb-path>');
  process.exit(1);
}

const TARGET_HEIGHT = 1.6;  // in-game critter "chibi target" height (world units)

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(path);
const root = doc.getRoot();

let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
let vertCount = 0;

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    const arr = pos.getArray();
    if (!arr) continue;
    vertCount += pos.getCount();
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
}

const width  = maxX - minX;
const height = maxY - minY;
const depth  = maxZ - minZ;

// Suggested scale: fit the critter's tallest dimension to TARGET_HEIGHT.
// Some critters are horizontal (turtle, crab) so we also report a width-
// based suggestion; pick whichever makes the critter read as ~1.6u.
const scaleByY = TARGET_HEIGHT / height;
// pivotY convention in roster.ts: the mesh is positioned at
// body.position.y + pivotY, and scale applies, so the final feet Y is
//    mesh.y + (minY * scale) + pivotY = 0
// Solving for pivotY at mesh.y = 0: pivotY = -minY * scale.
const pivotY = -minY * scaleByY;

console.log(`\n${path}`);
console.log(`Verts: ${vertCount.toLocaleString()}\n`);
console.log(`Bounding box (local):`);
console.log(`  X: [${minX.toFixed(3)}, ${maxX.toFixed(3)}]  width  ${width.toFixed(3)}`);
console.log(`  Y: [${minY.toFixed(3)}, ${maxY.toFixed(3)}]  height ${height.toFixed(3)}`);
console.log(`  Z: [${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]  depth  ${depth.toFixed(3)}`);
console.log(`\nOrigin hint:`);
if (Math.abs(minY) < 0.02 * height) {
  console.log(`  feet-at-origin — use pivotY = 0 in roster`);
} else if (Math.abs(minY + height / 2) < 0.02 * height) {
  console.log(`  centered — use pivotY ≈ ${pivotY.toFixed(3)} × scale to ground the feet`);
} else {
  console.log(`  offset — use pivotY ≈ ${pivotY.toFixed(3)} × scale (feet_y = ${minY.toFixed(3)} local)`);
}

console.log(`\nRoster suggestion (aim ${TARGET_HEIGHT}u tall):`);
console.log(`  scale : ${scaleByY.toFixed(2)}`);
console.log(`  pivotY: ${pivotY.toFixed(3)}   (= -minY × scale so feet land at y=0)`);
console.log();
