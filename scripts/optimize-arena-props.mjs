#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Arena-prop optimizer for Bichitos Rumble
// ---------------------------------------------------------------------------
//
// Twin of scripts/optimize-models.mjs but targets arena decoration props
// (trees, rocks, totems, etc.) instead of critter meshes.
//
// Differences vs the critter pipeline:
//   - Lower default vertex budget (props are dumber than critters).
//   - Adds a post-simplify texture-resize pass with sharp so even
//     decorator GLBs that ship 4K baked textures land around ~1 MB each.
//   - Optional --pack flag writes to public/models/arenas/<pack>/ so we
//     can drop several packs side by side without any per-pack script.
//
// Usage:
//   node scripts/optimize-arena-props.mjs <dir> --pack <name> [--target-verts N] [--tex-size N]
//
// Example:
//   node scripts/optimize-arena-props.mjs public/models/arenas/_raw/jungle --pack jungle
//
// Reads every *.glb under <dir>, optimizes, writes to
// public/models/arenas/<pack>/<same-name>.glb.
// ---------------------------------------------------------------------------

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { dedup, simplify, weld, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const DEFAULT_TARGET_VERTS = 3000;  // props are simpler than critters
const MAX_VERTS = 5000;
const MAX_FILE_SIZE_MB = 1.5;
const DEFAULT_TEX_SIZE = 1024;

// --- CLI ------------------------------------------------------------------

const args = process.argv.slice(2);
let inputPath = null;
let pack = null;
let targetVerts = DEFAULT_TARGET_VERTS;
let texSize = DEFAULT_TEX_SIZE;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--pack' && args[i + 1]) { pack = args[++i]; }
  else if (args[i] === '--target-verts' && args[i + 1]) { targetVerts = +args[++i]; }
  else if (args[i] === '--tex-size' && args[i + 1]) { texSize = +args[++i]; }
  else if (!inputPath) { inputPath = args[i]; }
}

if (!inputPath || !pack) {
  console.error('Usage: node scripts/optimize-arena-props.mjs <dir> --pack <name> [--target-verts N] [--tex-size N]');
  process.exit(1);
}

const OUTPUT_DIR = resolve('public/models/arenas', pack);

// --- Main -----------------------------------------------------------------

async function main() {
  await MeshoptSimplifier.ready;

  const info = await stat(inputPath);
  let files;
  if (info.isDirectory()) {
    const entries = await readdir(inputPath);
    files = entries.filter(f => extname(f).toLowerCase() === '.glb').map(f => join(inputPath, f));
  } else {
    files = [inputPath];
  }
  if (files.length === 0) {
    console.error('No .glb files found at', inputPath);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`\n  Bichitos Rumble — Arena Prop Optimizer`);
  console.log(`  Pack:            ${pack}`);
  console.log(`  Target vertices: ${targetVerts}  (max ${MAX_VERTS})`);
  console.log(`  Texture size:    ${texSize}px`);
  console.log(`  Output:          ${OUTPUT_DIR}\n`);

  const summary = [];
  for (const file of files) {
    const row = await optimizeProp(file);
    summary.push(row);
  }

  // Summary table
  console.log('\n  Summary');
  console.log('  ' + '─'.repeat(76));
  console.log('  ' + 'name'.padEnd(30) + 'src MB'.padStart(10) + 'out MB'.padStart(10) + 'verts'.padStart(12) + '  status');
  console.log('  ' + '─'.repeat(76));
  for (const r of summary) {
    const status = r.vertOk && r.sizeOk ? '✓' : '⚠';
    console.log('  ' + r.name.padEnd(30) + r.srcMB.padStart(10) + r.outMB.padStart(10) + r.verts.padStart(12) + '  ' + status);
  }
  console.log('  ' + '─'.repeat(76));
  console.log();
}

async function optimizeProp(filePath) {
  const name = basename(filePath, '.glb');
  const outPath = join(OUTPUT_DIR, `${name}.glb`);

  console.log(`── ${name} ──`);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(filePath);

  const srcVerts = countVertices(document);
  const srcBuf = await readFile(filePath);
  const srcMB = (srcBuf.byteLength / 1024 / 1024).toFixed(1);
  console.log(`   Source:  ${srcVerts.toLocaleString()} verts, ${srcMB} MB`);

  const ratio = Math.min(1.0, targetVerts / Math.max(1, srcVerts));
  console.log(`   Simplify ratio: ${ratio.toFixed(6)} (target ${targetVerts})`);

  // dedup removes identical vertices / attributes / nodes.
  // weld with generous tolerance collapses near-identical vertices
  // that simplify then processes together.
  // simplify is the real work — meshopt's quadric error algo.
  // textureCompress downsizes + re-encodes textures via sharp.
  await document.transform(
    dedup(),
    weld({ tolerance: 0.0001 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize] }),
  );

  const outVerts = countVertices(document);
  const outBuffer = await io.writeBinary(document);
  await writeFile(outPath, Buffer.from(outBuffer));

  const outMB = (outBuffer.byteLength / 1024 / 1024).toFixed(2);
  const vertOk = outVerts <= MAX_VERTS;
  const sizeOk = outBuffer.byteLength <= MAX_FILE_SIZE_MB * 1024 * 1024;

  console.log(`   Result:  ${outVerts.toLocaleString()} verts, ${outMB} MB`);
  console.log(`   Verts:   ${vertOk ? '✓' : '⚠ OVER LIMIT'} (max ${MAX_VERTS})`);
  console.log(`   Size:    ${sizeOk ? '✓' : '⚠ OVER LIMIT'} (max ${MAX_FILE_SIZE_MB} MB)`);
  console.log(`   Output:  ${outPath}`);
  console.log();

  return {
    name, srcMB: srcMB + ' MB', outMB: outMB + ' MB',
    verts: outVerts.toLocaleString(), vertOk, sizeOk,
  };
}

function countVertices(document) {
  let total = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (pos) total += pos.getCount();
    }
  }
  return total;
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
