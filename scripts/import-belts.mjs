#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Belt asset importer + optimizer
// ---------------------------------------------------------------------------
//
// One-shot script that:
//   1. Copies every *.glb from `<source>/` (default: user's Downloads
//      Cinturones_Insignias folder) to public/models/_raw/belts/ (gitignored).
//   2. Copies every *.png from the project root (where the user dropped
//      them) to public/images/_raw/belts/ (gitignored).
//   3. Renames each asset to the id used by src/badges.ts + db.ts.
//   4. Runs gltfpack + texture compress on GLBs → public/models/belts/.
//   5. Runs sharp WebP resize on PNGs → public/images/belts/<id>.png.
//
// Usage:
//   node scripts/import-belts.mjs [--source-glbs <dir>] [--source-pngs <dir>]
//
// After this lands, src/badges.ts + src/hall-of-belts.ts +
// src/badge-toast.ts swap their emoji icons for <img> tags pointing at
// public/images/belts/<id>.png. The GLBs are reserved for a future
// "trophy room" view (post-jam).
// ---------------------------------------------------------------------------

import { readFile, writeFile, readdir, stat, mkdir, copyFile } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

// ---- ID mapping ----------------------------------------------------------
// File-stem-as-supplied → canonical id used by badges.ts / db.ts.

const ID_MAP = {
  // Champions (9 — per-critter)
  Trunk_belt:            'trunk-champion',
  Kurama_belt:           'kurama-champion',
  Sergei_belt:           'sergei-champion',
  Shelly_belt:           'shelly-champion',
  Kermit_belt:           'kermit-champion',
  Sihans_belt:           'sihans-champion',
  Kowalski_belt:         'kowalski-champion',
  Cheeto_belt:           'cheeto-champion',
  Sebastian_belt:        'sebastian-champion',

  // Online belts (5 — global leaderboard)
  Throne_belt:           'throne-online',
  Flash_belt:            'flash-online',
  Ironclad_belt:         'ironclad-online',
  Slayer_belt:           'slayer-online',
  HotStreak_belt:        'hot-streak-online',

  // Offline global badges (7)
  Speedrun_Insignia:     'speedrun-belt',
  Speedrun_insignia:     'speedrun-belt',   // tolerate lowercase 'i'
  IronWill_insignia:     'iron-will',
  Untochable_insignia:   'untouchable',
  Survivor_insignia:     'survivor',
  Globetrotter_insignia: 'globetrotter',
  ArenaApex_insignia:    'arena-apex',
  PainTolerance_insignia: 'pain-tolerance',
};

// ---- CLI -----------------------------------------------------------------

const args = process.argv.slice(2);
let sourceGlbs = 'C:/Users/rafa_/Downloads/Bichitos Rumble/Cinturones_Insignias';
let sourcePngs = '.';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source-glbs' && args[i + 1]) sourceGlbs = args[++i];
  else if (args[i] === '--source-pngs' && args[i + 1]) sourcePngs = args[++i];
}

const RAW_GLBS = resolve('public/models/_raw/belts');
const RAW_PNGS = resolve('public/images/_raw/belts');
const OUT_GLBS = resolve('public/models/belts');
const OUT_PNGS = resolve('public/images/belts');

await mkdir(RAW_GLBS, { recursive: true });
await mkdir(RAW_PNGS, { recursive: true });
await mkdir(OUT_GLBS, { recursive: true });
await mkdir(OUT_PNGS, { recursive: true });

// ---- 1. Copy + rename raw assets ----------------------------------------

console.log('\n  Bichitos Rumble — Belt Importer\n');
console.log(`  Source GLBs: ${sourceGlbs}`);
console.log(`  Source PNGs: ${sourcePngs}\n`);

const glbFiles = (await readdir(sourceGlbs)).filter(f => f.endsWith('.glb'));
const pngFiles = (await readdir(sourcePngs)).filter(f => {
  const stem = basename(f, '.png');
  return f.endsWith('.png') && ID_MAP[stem];
});

console.log(`  Found ${glbFiles.length} GLB, ${pngFiles.length} PNG to import.\n`);

// Copy GLBs to raw
for (const file of glbFiles) {
  const stem = basename(file, '.glb');
  const id = ID_MAP[stem];
  if (!id) { console.log(`  ! skip unknown GLB: ${file}`); continue; }
  await copyFile(join(sourceGlbs, file), join(RAW_GLBS, `${id}.glb`));
}
// Copy PNGs to raw
for (const file of pngFiles) {
  const stem = basename(file, '.png');
  const id = ID_MAP[stem];
  if (!id) continue;
  await copyFile(join(sourcePngs, file), join(RAW_PNGS, `${id}.png`));
}

console.log('  ✓ Raw assets copied.\n');

// ---- 2. Process PNGs: resize to 256 WebP-in-PNG container ---------------

console.log('  PNGs → 256×256 (sharp compress)');
for (const file of await readdir(RAW_PNGS)) {
  if (!file.endsWith('.png')) continue;
  const inPath = join(RAW_PNGS, file);
  const outPath = join(OUT_PNGS, file);
  const srcBuf = await readFile(inPath);
  const outBuf = await sharp(srcBuf)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, quality: 85 })
    .toBuffer();
  await writeFile(outPath, outBuf);
  console.log(`    ${file.padEnd(30)} ${(srcBuf.length / 1024).toFixed(0).padStart(6)} KB → ${(outBuf.length / 1024).toFixed(0).padStart(5)} KB`);
}
console.log();

// ---- 3. Process GLBs: gltfpack simplify + texture compress --------------

console.log('  GLBs → gltfpack -si 0.003 + textures 256 WebP');
for (const file of await readdir(RAW_GLBS)) {
  if (!file.endsWith('.glb')) continue;
  const inPath = join(RAW_GLBS, file);
  const outPath = join(OUT_GLBS, file);

  // Pass 1: gltfpack simplify
  execSync(`npx gltfpack -i "${inPath}" -o "${outPath}" -si 0.003`, { stdio: 'pipe' });

  // Pass 2: texture compress
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(outPath);
  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256] }),
  );
  const buf = await io.writeBinary(doc);
  await writeFile(outPath, Buffer.from(buf));

  const srcSize = (await readFile(inPath)).byteLength;
  const outSize = buf.byteLength;
  console.log(`    ${file.padEnd(30)} ${(srcSize / 1024 / 1024).toFixed(1).padStart(5)} MB → ${(outSize / 1024).toFixed(0).padStart(5)} KB`);
}
console.log();

console.log('  ✓ All belts imported + optimized.\n');
console.log(`    Output: ${OUT_GLBS}`);
console.log(`            ${OUT_PNGS}\n`);
