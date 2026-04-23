#!/usr/bin/env node
// Last-resort simplification for arena props whose IA output ships
// thousands of tiny primitives (one mesh per leaf). gltf-transform's
// `join` merges compatible primitives, then simplify runs with a big
// error tolerance so the whole thing collapses into a reasonable
// silhouette. Visible quality drop on close inspection but the
// silhouette is what matters for background props.
//
// Usage:
//   node scripts/aggressive-simplify.mjs <in.glb> <out.glb> [--ratio N] [--error N]

import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import { dedup, weld, join, simplify, flatten } from '@gltf-transform/functions';

const [inPath, outPath, ...rest] = process.argv.slice(2);
let ratio = 0.005;
let err = 0.2;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--ratio' && rest[i+1]) ratio = +rest[++i];
  else if (rest[i] === '--error' && rest[i+1]) err = +rest[++i];
}

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inPath);

const srcVerts = countVerts(doc);
const srcMB = ((await readFile(inPath)).byteLength / 1024 / 1024).toFixed(1);
console.log(`   Source: ${srcVerts.toLocaleString()} verts, ${srcMB} MB`);

await doc.transform(
  dedup(),
  flatten(),                                 // collapse scene graph
  weld({ tolerance: 0.005 }),                // very permissive weld
  join(),                                    // merge primitives by material
  simplify({ simplifier: MeshoptSimplifier, ratio, error: err }),
);

const outBuf = await io.writeBinary(doc);
await writeFile(outPath, Buffer.from(outBuf));
const outVerts = countVerts(doc);
const outMB = (outBuf.byteLength / 1024 / 1024).toFixed(2);
console.log(`   Result: ${outVerts.toLocaleString()} verts, ${outMB} MB`);

function countVerts(d) {
  let n = 0;
  for (const m of d.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      if (pos) n += pos.getCount();
    }
  return n;
}
