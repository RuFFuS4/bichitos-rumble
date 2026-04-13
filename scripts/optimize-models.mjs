#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Model optimization pipeline for Bichitos Rumble
// ---------------------------------------------------------------------------
//
// Takes high-poly Tripo3D GLB exports and produces game-ready models that
// conform to the style lock constraints (see STYLE_LOCK.md).
//
// Usage:
//   node scripts/optimize-models.mjs <path-to-glb-or-directory> [--target-verts N]
//
// Examples:
//   node scripts/optimize-models.mjs "C:/Models/Sergei.glb"
//   node scripts/optimize-models.mjs "C:/Models/" --target-verts 4000
//
// Output: public/models/critters/<id>.glb
// ---------------------------------------------------------------------------

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_TARGET_VERTS = 5000;
const MAX_VERTS = 8000;        // style lock hard limit
const MAX_FILE_SIZE = 512000;  // 500 KB
const OUTPUT_DIR = resolve('public/models/critters');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let inputPath = null;
let targetVerts = DEFAULT_TARGET_VERTS;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target-verts' && args[i + 1]) {
    targetVerts = parseInt(args[i + 1], 10);
    i++;
  } else if (!inputPath) {
    inputPath = args[i];
  }
}

if (!inputPath) {
  console.error('Usage: node scripts/optimize-models.mjs <path> [--target-verts N]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await MeshoptSimplifier.ready;

  const info = await stat(inputPath);
  let files;

  if (info.isDirectory()) {
    const entries = await readdir(inputPath);
    files = entries
      .filter(f => extname(f).toLowerCase() === '.glb')
      .map(f => join(inputPath, f));
  } else {
    files = [inputPath];
  }

  if (files.length === 0) {
    console.error('No .glb files found at', inputPath);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`\n  Bichitos Rumble — Model Optimizer`);
  console.log(`  Target vertices: ${targetVerts}`);
  console.log(`  Output: ${OUTPUT_DIR}\n`);

  for (const file of files) {
    await optimizeModel(file);
  }

  console.log('\nDone.\n');
}

async function optimizeModel(filePath) {
  const name = basename(filePath, '.glb');
  const id = name.toLowerCase();
  const outPath = join(OUTPUT_DIR, `${id}.glb`);

  console.log(`── ${name} ──`);

  // Read source
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(filePath);

  // Count source vertices
  const srcVerts = countVertices(document);
  const srcSizeMB = ((await readFile(filePath)).byteLength / 1024 / 1024).toFixed(1);
  console.log(`   Source: ${srcVerts.toLocaleString()} verts, ${srcSizeMB} MB`);

  // Calculate simplification ratio
  const ratio = Math.min(1.0, targetVerts / srcVerts);
  console.log(`   Simplify ratio: ${ratio.toFixed(6)} (target ${targetVerts})`);

  // Pipeline: dedup → weld → simplify
  await document.transform(
    dedup(),
    weld({ tolerance: 0.0001 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
  );

  // Count result vertices
  const outVerts = countVertices(document);

  // Write output (no Draco for now — Draco requires the CLI or encoder extension
  // which has more complex setup. Raw simplified GLB is already tiny enough for
  // low-poly chibi models. Can add Draco as a second pass later if needed.)
  const outBuffer = await io.writeBinary(document);
  await writeFile(outPath, Buffer.from(outBuffer));

  const outSize = outBuffer.byteLength;
  const outSizeKB = (outSize / 1024).toFixed(0);

  // Validation
  const vertOk = outVerts <= MAX_VERTS;
  const sizeOk = outSize <= MAX_FILE_SIZE;

  console.log(`   Result: ${outVerts.toLocaleString()} verts, ${outSizeKB} KB`);
  console.log(`   Verts:  ${vertOk ? '✓' : '⚠ OVER LIMIT'} (max ${MAX_VERTS})`);
  console.log(`   Size:   ${sizeOk ? '✓' : '⚠ OVER LIMIT'} (max ${MAX_FILE_SIZE / 1024} KB)`);
  console.log(`   Output: ${outPath}`);
  console.log();
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
