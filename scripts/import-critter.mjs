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

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

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
};

for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--map' && argv[i + 1])            { flags.map = argv[++i]; }
  else if (a === '--target-verts' && argv[i + 1]) { flags.targetVerts = parseInt(argv[++i], 10); }
  else if (a === '--tolerance' && argv[i + 1])    { flags.tolerance = parseFloat(argv[++i]); }
  else if (a === '--dry-run')                     { flags.dryRun = true; }
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

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
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

  // ─── Step 2. Optimise geometry ─────────────────────────────────────
  console.log(`\n── Step 2. Optimise geometry ──`);
  const srcVerts = countVertices(doc);
  const srcSizeMB = ((await readFile(srcPath)).byteLength / 1024 / 1024).toFixed(1);
  const ratio = Math.min(1.0, flags.targetVerts / srcVerts);
  console.log(`   Source: ${srcVerts.toLocaleString()} verts, ${srcSizeMB} MB`);
  console.log(`   Simplify ratio: ${ratio.toFixed(6)} (target ${flags.targetVerts})`);

  if (flags.dryRun) {
    console.log(`\n   --dry-run: skipping transform + write.\n`);
    return;
  }

  await doc.transform(
    dedup(),
    weld({ tolerance: 0.0001 }),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }),
  );

  const outVerts = countVertices(doc);
  console.log(`   Result: ${outVerts.toLocaleString()} verts`);

  // ─── Step 3. Write ─────────────────────────────────────────────────
  console.log(`\n── Step 3. Write ──`);
  await mkdir(dirname(outPath), { recursive: true });
  const outBuffer = await io.writeBinary(doc);
  await writeFile(outPath, Buffer.from(outBuffer));
  const outSizeKB = (outBuffer.byteLength / 1024).toFixed(0);
  console.log(`   Wrote ${outSizeKB} KB → ${outPath}`);
  console.log(`\nNext: node scripts/verify-critter-glbs.mjs public/models/critters/${id}.glb\n`);
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
  const conventional = resolve(join('scripts', 'mappings', `${id}.json`));
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
