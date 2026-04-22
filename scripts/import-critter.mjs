#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Critter import pipeline — Tripo / Meshy source GLB → public/models/critters/
// ---------------------------------------------------------------------------
//
// Generic replacement for one-off per-critter import scripts. Handles the
// full Tripo-Animate / Meshy export path in one pass:
//
//   1. Read source GLB (usually high-poly with animations wrapped in NLA
//      tracks named "NlaTrack", "NlaTrack.001", … — semantic names lost).
//   2. Rename each AnimationClip by matching its duration against a mapping
//      file (`scripts/mappings/<id>.json`) or inline `--map` payload. The
//      name chosen must match the keyword resolver in
//      `src/critter-skeletal.ts` (idle / run / pounce / shadow_step /
//      tiger_roar / …).
//   3. Optimise geometry with dedup + weld + meshoptimizer simplify to
//      land in the ~2-4 MB target the roster expects.
//   4. Write to `public/models/critters/<id>.glb`.
//
// This bypasses Blender entirely. Blender's export has been observed
// flattening live clips to 2 identical keyframes (see Kermit transplant
// fallback in BLENDER_MCP.md). When the source is clean, the direct
// gltf-transform path preserves every fcurve.
//
// Usage
//   node scripts/import-critter.mjs <id> <source.glb> [flags]
//
// Flags
//   --map <path-or-json>   mapping file or inline JSON array
//   --target-verts <N>     vertex budget (default 5000 — the simplifier
//                          respects skinning so the actual output tends
//                          to be higher, see optimize-models.mjs)
//   --tolerance <S>        duration-match tolerance in seconds (default 0.01)
//   --dry-run              print the rename plan + ratio, don't write output
//
// Mapping file format — `scripts/mappings/<id>.json`:
//   [
//     { "dur": 1.292, "name": "Run" },
//     { "dur": 2.750, "name": "Ability1Pounce" },
//     ...
//   ]
//
// Example (Cheeto):
//   node scripts/import-critter.mjs cheeto "C:/Downloads/Cheeto.glb"
//
// After import run:
//   node scripts/verify-critter-glbs.mjs public/models/critters/<id>.glb
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { resolve, dirname, join as pathJoin } from 'node:path';
import { spawn } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  dedup, simplify, weld, textureCompress,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/**
 * File-size threshold (bytes) above which we route through gltfpack.
 * Meshy exports are typically 100-200 MB and need the skin-aware
 * simplifier + meshopt compression to reach a shippable size; Tripo
 * exports are ~70 MB and their skinned meshes are already light enough
 * that the gltf-transform simplify in the default pipeline handles them.
 */
const GLTFPACK_THRESHOLD_BYTES = 80 * 1024 * 1024;

// ---------------------------------------------------------------------------
// CLI parse
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length < 2 || argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(argv.length < 2 ? 1 : 0);
}

const id = argv[0].toLowerCase();
const srcPath = argv[1];
const flags = {
  map: null,
  targetVerts: 5000,
  tolerance: 0.01,
  dryRun: false,
  // Force the gltfpack route regardless of source size. Inverse flag
  // below forces the plain route. Default: auto-detect by size.
  viaGltfpack: /** @type {boolean | 'auto'} */ ('auto'),
};

for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--map' && argv[i + 1])            { flags.map = argv[++i]; }
  else if (a === '--target-verts' && argv[i + 1]) { flags.targetVerts = parseInt(argv[++i], 10); }
  else if (a === '--tolerance' && argv[i + 1])    { flags.tolerance = parseFloat(argv[++i]); }
  else if (a === '--dry-run')                     { flags.dryRun = true; }
  else if (a === '--via-gltfpack')                { flags.viaGltfpack = true; }
  else if (a === '--no-gltfpack')                 { flags.viaGltfpack = false; }
  else { console.error(`Unknown flag: ${a}`); usage(); process.exit(1); }
}

const outPath = resolve(`public/models/critters/${id}.glb`);

// ---------------------------------------------------------------------------

async function main() {
  await MeshoptSimplifier.ready;

  const mapping = await resolveMapping(id, flags.map);
  if (!mapping || mapping.length === 0) {
    console.error(`No mapping provided for "${id}".`);
    console.error(`Create scripts/mappings/${id}.json or pass --map <file|json>.`);
    process.exit(1);
  }

  console.log(`\n  Bichitos Rumble — Critter Import`);
  console.log(`  id     : ${id}`);
  console.log(`  source : ${srcPath}`);
  console.log(`  target : ${outPath}`);
  console.log(`  mapping: ${mapping.length} clips\n`);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(srcPath);

  // ─── Step 1. Rename animations by duration ─────────────────────────
  console.log(`── Step 1. Rename animations by duration ──`);
  const anims = doc.getRoot().listAnimations();
  const renamed = new Set();
  let unmatched = 0;

  for (const anim of anims) {
    const dur = computeDuration(anim);
    const match = mapping.find(m => Math.abs(m.dur - dur) < flags.tolerance);
    const oldName = anim.getName();
    if (match) {
      anim.setName(match.name);
      renamed.add(match.name);
      console.log(`   ${oldName.padEnd(18)} (${dur.toFixed(3)}s) → ${match.name}`);
    } else {
      unmatched++;
      console.log(`   ${oldName.padEnd(18)} (${dur.toFixed(3)}s) → ⚠ NO MATCH`);
    }
  }

  const missing = mapping.filter(m => !renamed.has(m.name));
  if (missing.length > 0) {
    console.log(`\n   ⚠ Mapped-but-not-found clips (expected in source but absent):`);
    for (const m of missing) console.log(`     · ${m.name} (expected ${m.dur.toFixed(3)}s)`);
  }
  if (unmatched > 0) {
    console.log(`\n   ⚠ ${unmatched} source clip(s) without a mapping entry.`);
    console.log(`     They will keep their NlaTrack.XXX name and won't resolve to a state.`);
  }

  // ─── Step 2. Optimise ──────────────────────────────────────────────
  // Two routes:
  //   - Plain (Tripo-sized sources): dedup + weld + simplify + texture
  //     compress, all through gltf-transform. Fast, ~2-3 MB outputs.
  //   - via-gltfpack (Meshy-sized sources): we only rename anims here,
  //     then dedup + textureCompress to knock down textures, write to
  //     a .tmp file, and delegate the heavy simplify + meshopt
  //     quantization compression to the gltfpack CLI. Output ends up
  //     ~2-5 MB even on 150+ MB sources; runtime decompresses via
  //     MeshoptDecoder (wired in src/model-loader.ts).
  console.log(`\n── Step 2. Optimise ──`);
  const srcVerts = countVertices(doc);
  const srcBytes = (await readFile(srcPath)).byteLength;
  const srcSizeMB = (srcBytes / 1024 / 1024).toFixed(1);
  const autoGltfpack =
    flags.viaGltfpack === true ||
    (flags.viaGltfpack === 'auto' && srcBytes > GLTFPACK_THRESHOLD_BYTES);
  console.log(`   Source: ${srcVerts.toLocaleString()} verts, ${srcSizeMB} MB`);
  console.log(`   Route : ${autoGltfpack ? 'via gltfpack (skin-aware)' : 'plain gltf-transform'}`);

  if (flags.dryRun) {
    console.log(`\n   --dry-run: skipping transform + write.\n`);
    return;
  }

  if (autoGltfpack) {
    await optimiseViaGltfpack(doc, io, outPath, id);
  } else {
    await optimisePlain(doc, srcVerts, flags.targetVerts);
    await writeDoc(doc, io, outPath);
  }
  console.log(`\nNext: node scripts/verify-critter-glbs.mjs public/models/critters/${id}.glb\n`);
}

async function optimisePlain(doc, srcVerts, targetVerts) {
  const ratio = Math.min(1.0, targetVerts / srcVerts);
  console.log(`   Simplify ratio: ${ratio.toFixed(6)} (target ${targetVerts} verts)`);
  // Plain pipeline — the one that's been shipping Tripo imports at
  // 2-3 MB since 2026-04-21.
  await doc.transform(
    dedup(),
    weld({ tolerance: 0.0001 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
  );
  const outVerts = countVertices(doc);
  console.log(`   Result: ${outVerts.toLocaleString()} verts`);
}

async function optimiseViaGltfpack(doc, io, outPath, id) {
  // Pass 1: rename already applied in memory. dedup + texture compress
  // (WebP, alpha-safe, ≤1024²) here — gltfpack's Node build can't do
  // WebP itself (no platform WebP encoder), so we do it before handing
  // off. Write to a .tmp next to the final path.
  console.log(`   Pass 1: dedup + textureCompress (WebP ≤1024²) → .tmp`);
  await doc.transform(
    dedup(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [1024, 1024],
      quality: 82,
    }),
  );
  await mkdir(dirname(outPath), { recursive: true });
  // gltfpack matches by extension to pick a reader — has to be .glb.
  const tmpPath = outPath.replace(/\.glb$/, '.pre.glb');
  const tmpBuffer = await io.writeBinary(doc);
  await writeFile(tmpPath, Buffer.from(tmpBuffer));
  const tmpSizeMB = (tmpBuffer.byteLength / 1024 / 1024).toFixed(1);
  console.log(`   Wrote ${tmpSizeMB} MB → ${id}.pre.glb`);

  // Pass 2: gltfpack handles the skin-aware simplify + meshopt
  // compression. `-si 0.02` targets ~2% triangle count; `-c` enables
  // meshopt quantization (requires MeshoptDecoder at runtime, wired
  // in src/model-loader.ts). `-kn` keeps node names (we need the
  // bones named for the skeletal resolver + critter-parts).
  console.log(`   Pass 2: gltfpack -si 0.02 -c -kn → ${id}.glb`);
  await runGltfpack(tmpPath, outPath);
  await unlink(tmpPath).catch(() => { /* already gone */ });

  const finalBytes = (await stat(outPath)).size;
  const finalSizeKB = (finalBytes / 1024).toFixed(0);
  const finalSizeMB = (finalBytes / 1024 / 1024).toFixed(2);
  console.log(`   Wrote ${finalSizeKB} KB (${finalSizeMB} MB) → ${outPath}`);
}

function runGltfpack(inPath, outPath) {
  return new Promise((resolveRun, rejectRun) => {
    // -si 0.02 — simplify to 2% of original triangle count
    // -c       — meshopt quantization compression
    // -kn      — keep node names (needed for bone lookups in skeletal /
    //            critter-parts)
    // Invoked via `npx gltfpack` so we pick up the devDep install.
    const child = spawn('npx', ['gltfpack', '-i', inPath, '-o', outPath, '-si', '0.02', '-c', '-kn'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stderr = '';
    child.stdout.on('data', (c) => process.stdout.write(`     ${String(c)}`));
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun(undefined);
      else rejectRun(new Error(`gltfpack exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function writeDoc(doc, io, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  const outBuffer = await io.writeBinary(doc);
  await writeFile(outPath, Buffer.from(outBuffer));
  const outSizeKB = (outBuffer.byteLength / 1024).toFixed(0);
  console.log(`   Wrote ${outSizeKB} KB → ${outPath}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveMapping(id, mapFlag) {
  // 1. Inline JSON
  if (mapFlag && mapFlag.trim().startsWith('[')) {
    try { return JSON.parse(mapFlag); }
    catch (err) { throw new Error(`--map is not valid JSON: ${err.message}`); }
  }
  // 2. Explicit file
  if (mapFlag) {
    const raw = await readFile(mapFlag, 'utf8');
    return JSON.parse(raw);
  }
  // 3. Convention: scripts/mappings/<id>.json
  const conventional = resolve(pathJoin('scripts', 'mappings', `${id}.json`));
  const info = await stat(conventional).catch(() => null);
  if (info && info.isFile()) {
    const raw = await readFile(conventional, 'utf8');
    return JSON.parse(raw);
  }
  return null;
}

function computeDuration(anim) {
  let maxTime = 0;
  for (const ch of anim.listChannels()) {
    const input = ch.getSampler()?.getInput();
    const arr = input?.getArray();
    if (!arr) continue;
    const last = arr[arr.length - 1];
    if (last > maxTime) maxTime = last;
  }
  return maxTime;
}

function countVertices(doc) {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (pos) total += pos.getCount();
    }
  }
  return total;
}

function usage() {
  console.log(`
Usage: node scripts/import-critter.mjs <id> <source.glb> [flags]

Flags:
  --map <file|json>     mapping (default: scripts/mappings/<id>.json)
  --target-verts <N>    vertex budget (default 5000)
  --tolerance <S>       duration-match tolerance (default 0.01 s)
  --dry-run             print plan + ratio, don't write

Mapping format:
  [ { "dur": 1.292, "name": "Run" }, ... ]

See scripts/mappings/cheeto.json for a reference file.
  `.trim());
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
