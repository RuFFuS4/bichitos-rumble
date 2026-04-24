#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Arena-prop texture compression pass
// ---------------------------------------------------------------------------
//
// Run AFTER gltfpack has simplified the mesh. gltfpack's Node build lacks
// BasisU support so textures stay as-is (often multi-MB PNGs straight out
// of the AI generator). This script re-encodes every texture to WebP at a
// configurable max resolution, dropping the final GLB size dramatically
// without a visible quality hit on background props.
//
// Usage:
//   node scripts/compress-arena-textures.mjs <dir> [--max-size N]
//
// Example (run in-place on the pack output):
//   node scripts/compress-arena-textures.mjs public/models/arenas/jungle --max-size 512
// ---------------------------------------------------------------------------

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { textureCompress, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';

const DEFAULT_MAX_SIZE = 512;

const args = process.argv.slice(2);
let inputPath = null;
let maxSize = DEFAULT_MAX_SIZE;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--max-size' && args[i + 1]) { maxSize = +args[++i]; }
  else if (!inputPath) { inputPath = args[i]; }
}
if (!inputPath) {
  console.error('Usage: node scripts/compress-arena-textures.mjs <dir> [--max-size N]');
  process.exit(1);
}

async function main() {
  const info = await stat(inputPath);
  let files;
  if (info.isDirectory()) {
    const entries = await readdir(inputPath);
    files = entries.filter(f => extname(f).toLowerCase() === '.glb').map(f => join(inputPath, f));
  } else {
    files = [inputPath];
  }

  console.log(`\n  Arena Prop Texture Compressor`);
  console.log(`  Max texture size: ${maxSize}px\n`);

  for (const file of files) {
    const name = basename(file);
    const srcSize = (await readFile(file)).byteLength;
    console.log(`── ${name}  (${(srcSize / 1024 / 1024).toFixed(1)} MB)`);

    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const document = await io.read(file);
    await document.transform(
      dedup(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxSize, maxSize] }),
    );
    const buf = await io.writeBinary(document);
    await writeFile(file, Buffer.from(buf));
    const outSize = buf.byteLength;
    const ratio = ((outSize / srcSize) * 100).toFixed(1);
    console.log(`   → ${(outSize / 1024 / 1024).toFixed(2)} MB  (${ratio}% of original)`);
  }

  console.log();
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
