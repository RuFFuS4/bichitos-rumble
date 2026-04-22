#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Critter GLB animation report for Bichitos Rumble
// ---------------------------------------------------------------------------
//
// Walks public/models/critters/*.glb (or a path you pass in) and reports,
// per file, which AnimationClips it ships and which logical SkeletalState
// they resolve to via the same keyword map as src/critter-skeletal.ts.
//
// 100% offline. Read-only. No game runtime, no network, no writes.
//
// Usage:
//   node scripts/verify-critter-glbs.mjs
//   node scripts/verify-critter-glbs.mjs public/models/critters/sergei.glb
//   node scripts/verify-critter-glbs.mjs path/to/dir --strict
//   node scripts/verify-critter-glbs.mjs --all-states      # legacy 13-state scan
//
// --strict       → exit 1 if any scanned GLB has zero resolved priority clips
//                   (useful for CI gates; default is always exit 0).
// --all-states   → report against the full legacy state list (13 rows per
//                   critter). Default is the policy-locked 8 target states
//                   (idle / run / ability_1 / ability_2 / ability_3 /
//                   victory / defeat / fall) — everything else is procedural
//                   per SUBMISSION_CHECKLIST and doesn't need clip coverage.
// ---------------------------------------------------------------------------

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename, extname, resolve, relative } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

// ---------------------------------------------------------------------------
// State resolver — MUST mirror STATE_KEYWORDS in src/critter-skeletal.ts.
// If you add/rename a keyword there, update this table too.
// ---------------------------------------------------------------------------

const STATE_KEYWORDS = {
  idle:              ['idle', 'breathing', 'standing', 'breath'],
  walk:              ['walk'],
  run:               ['run', 'sprint', 'gallop'],
  headbutt_anticip:  ['anticip', 'windup', 'prepare', 'charge_up'],
  headbutt_lunge:    ['headbutt', 'head_butt', 'lunge', 'punch', 'strike', 'attack', 'melee'],
  ability_1:         ['ability1', 'ability_1', 'skill1', 'dash', 'charge', 'rush', 'leap', 'pounce'],
  ability_2:         ['ability2', 'ability_2', 'skill2', 'slam', 'special', 'grip', 'shield', 'cloud', 'tunnel', 'snowball', 'shadow_step', 'shadow', 'sweep', 'mirror'],
  ability_3:         ['ability3', 'ability_3', 'ultimate', 'ulti', 'frenzy', 'pound', 'mega', 'hypno', 'diggy', 'ice_age', 'tiger_roar', 'roar', 'crab_slash'],
  victory:           ['victory', 'win', 'celebrat', 'cheer', 'dance'],
  defeat:            ['defeat', 'lose', 'dying', 'death', 'ko', 'loss'],
  fall:              ['fall', 'drop', 'falling'],
  hit:               ['hit', 'damage', 'react', 'stagger', 'flinch'],
  respawn:           ['respawn', 'revive', 'spawn', 'appear'],
};

// Policy-locked target states (8). Aligned with BADGES_DESIGN / SUBMISSION_
// CHECKLIST: `walk` is eliminated, `headbutt_*` / `hit` / `respawn` are
// procedural for every critter. Anything not in this list is still looked
// up in STATE_KEYWORDS when --all-states is passed, but the default report
// only counts these 8 so the "covered" number matches the coverage target
// the roster aims at.
const TARGET_STATES = [
  'idle', 'run',
  'ability_1', 'ability_2', 'ability_3',
  'victory', 'defeat', 'fall',
];

// Extended legacy list, used when --all-states is passed. Preserves the
// old ordering for backward-compatible diffs.
const ALL_STATES = [
  'idle', 'run', 'victory', 'defeat', 'headbutt_lunge',
  'fall', 'hit', 'ability_1', 'ability_2', 'ability_3',
  'walk', 'respawn', 'headbutt_anticip',
];

const DEFAULT_DIR = resolve('public/models/critters');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let inputPath = null;
let strict = false;
let allStates = false;
for (const a of args) {
  if (a === '--strict') strict = true;
  else if (a === '--all-states') allStates = true;
  else if (!inputPath) inputPath = a;
}
if (!inputPath) inputPath = DEFAULT_DIR;

const PRIORITY = allStates ? ALL_STATES : TARGET_STATES;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const info = await stat(inputPath).catch(() => null);
  if (!info) {
    console.error(`Path not found: ${inputPath}`);
    process.exit(1);
  }

  let files;
  if (info.isDirectory()) {
    const entries = await readdir(inputPath);
    files = entries
      .filter(f => extname(f).toLowerCase() === '.glb')
      .sort()
      .map(f => join(inputPath, f));
  } else {
    files = [inputPath];
  }

  if (files.length === 0) {
    console.error(`No .glb files found at ${inputPath}`);
    process.exit(1);
  }

  console.log(`\n  Bichitos Rumble — Critter GLB Animation Report`);
  console.log(`  Scanning: ${relative(process.cwd(), inputPath) || inputPath}`);
  console.log(`  Files:    ${files.length}`);
  console.log(`  Policy:   ${allStates ? 'legacy (13 states)' : 'target (8 states — idle/run/ability_1..3/victory/defeat/fall)'}\n`);

  const summary = [];
  for (const file of files) {
    const row = await reportFile(file);
    summary.push(row);
  }

  printSummary(summary);

  if (strict) {
    const broken = summary.filter(r => !r.error && r.resolvedCount === 0);
    if (broken.length > 0) {
      console.error(
        `\nSTRICT mode: ${broken.length} GLB(s) have zero resolved priority clips.\n`
      );
      process.exit(1);
    }
  }
}

async function reportFile(filePath) {
  const id = basename(filePath, '.glb').toLowerCase();
  const sizeBytes = (await readFile(filePath)).byteLength;
  const sizeKB = (sizeBytes / 1024).toFixed(0);

  console.log(`── ${id} ── (${sizeKB} KB)`);

  let document;
  try {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    document = await io.read(filePath);
  } catch (err) {
    console.log(`   ERROR reading GLB: ${err.message}\n`);
    return { id, sizeKB, error: err.message, clips: [], resolved: {}, resolvedCount: 0 };
  }

  const root = document.getRoot();

  // ─── Geometry/material audit ──────────────────────────────────────────
  // Primary motivation: the /animations lab (mesh2motion) is finicky with
  // GLBs missing NORMAL attributes or materials, so we surface that here
  // before the user drops a critter into the lab and wonders why it fails.
  const geoAudit = auditGeometry(root);
  const matAudit = auditMaterials(root);
  console.log(
    `   Geometry: ${geoAudit.totalVerts} verts, ${geoAudit.totalTris} tris` +
    (geoAudit.degenerateTris > 0 ? ` (${geoAudit.degenerateTris} degenerate)` : '')
  );
  console.log(
    `   Attrs:    ` +
    `position ${flag(geoAudit.hasPosition)}  ` +
    `normal ${flag(geoAudit.hasNormal)}  ` +
    `uv ${flag(geoAudit.hasUv)}  ` +
    (geoAudit.hasInterleaved ? `interleaved ✓` : `interleaved —`)
  );
  console.log(
    `   Material: ${matAudit.count} (${matAudit.types.join(', ') || '—'})` +
    (matAudit.missingOnMesh ? `  ⚠ mesh without material` : '')
  );
  if (!geoAudit.hasNormal) {
    console.log(`   ⚠ Missing NORMAL — lab will fall back to computeVertexNormals().`);
  }

  // ─── Animation audit ──────────────────────────────────────────────────
  const animations = root.listAnimations();
  const clipNames = animations.map(a => a.getName() || '(unnamed)');

  // Resolve each state to the first matching clip (same rule as runtime).
  // We still resolve against ALL states — so orphan detection sees clips
  // that would match non-target states (e.g. a stray walk clip). The
  // per-row output only prints the PRIORITY list though.
  const resolved = {};
  for (const state of Object.keys(STATE_KEYWORDS)) {
    resolved[state] = findClipForState(clipNames, state);
  }

  // Which clips never matched anything — usually a naming problem.
  const matchedClips = new Set(Object.values(resolved).filter(Boolean));
  const orphanClips = clipNames.filter(n => !matchedClips.has(n));

  if (clipNames.length === 0) {
    console.log(`   Clips:    (none — procedural-only critter)`);
  } else {
    console.log(`   Clips:    ${clipNames.length}`);
    for (const state of PRIORITY) {
      const clip = resolved[state];
      const mark = clip ? '✓' : '·';
      const label = state.padEnd(18);
      const value = clip ? clip : '—';
      console.log(`     ${mark} ${label} ${value}`);
    }
    if (orphanClips.length > 0) {
      console.log(`   Unmatched clips (rename to help the resolver):`);
      for (const n of orphanClips) console.log(`     · ${n}`);
    }
  }

  // "Coverage" counts only the states we actually aim for — matches the
  // policy and gives the "4/8" headline the summary table prints.
  const resolvedCount = PRIORITY.reduce(
    (n, state) => n + (resolved[state] ? 1 : 0),
    0,
  );
  console.log();

  return {
    id,
    sizeKB,
    clips: clipNames,
    resolved,
    resolvedCount,
    orphanCount: orphanClips.length,
    geoAudit,
    matAudit,
  };
}

function flag(ok) { return ok ? '✓' : '✗'; }

function auditGeometry(root) {
  let totalVerts = 0;
  let totalTris = 0;
  let degenerateTris = 0;
  let hasPosition = false;
  let hasNormal = false;
  let hasUv = false;
  let hasInterleaved = false; // gltf-transform doesn't expose interleaving
                              // directly — we only know from the raw file.
                              // Left as a placeholder: the lab's defensive
                              // code is what actually matters at runtime.

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const uv = prim.getAttribute('TEXCOORD_0');
      if (pos) {
        hasPosition = true;
        totalVerts += pos.getCount();
      }
      if (nor) hasNormal = true;
      if (uv) hasUv = true;

      // Count triangles + degenerate (zero-area) ones.
      const indices = prim.getIndices();
      if (pos && indices) {
        const idxArr = indices.getArray();
        const posArr = pos.getArray();
        const triCount = Math.floor(idxArr.length / 3);
        totalTris += triCount;
        for (let t = 0; t < triCount; t++) {
          const a = idxArr[t * 3] * 3;
          const b = idxArr[t * 3 + 1] * 3;
          const c = idxArr[t * 3 + 2] * 3;
          // Cross product magnitude for area×2
          const ax = posArr[a], ay = posArr[a + 1], az = posArr[a + 2];
          const bx = posArr[b], by = posArr[b + 1], bz = posArr[b + 2];
          const cx = posArr[c], cy = posArr[c + 1], cz = posArr[c + 2];
          const ux = bx - ax, uy = by - ay, uz = bz - az;
          const vx = cx - ax, vy = cy - ay, vz = cz - az;
          const nx = uy * vz - uz * vy;
          const ny = uz * vx - ux * vz;
          const nz = ux * vy - uy * vx;
          if (nx * nx + ny * ny + nz * nz < 1e-14) degenerateTris++;
        }
      } else if (pos) {
        // Non-indexed: assume each 3 verts = 1 triangle.
        totalTris += Math.floor(pos.getCount() / 3);
      }
    }
  }

  return { totalVerts, totalTris, degenerateTris, hasPosition, hasNormal, hasUv, hasInterleaved };
}

function auditMaterials(root) {
  const materials = root.listMaterials();
  const types = [];
  for (const mat of materials) {
    // gltf-transform materials are always PBR (MetallicRoughness by default).
    const hasBase = !!mat.getBaseColorTexture() || mat.getBaseColorHex() !== 0xffffff;
    types.push(hasBase ? 'PBR+tex' : 'PBR');
  }
  // Detect if any mesh primitive has no material assigned.
  let missingOnMesh = false;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getMaterial()) missingOnMesh = true;
    }
  }
  return { count: materials.length, types, missingOnMesh };
}

// Mirrors src/critter-skeletal.ts findClipForState: exact match on the
// state name (post strip-punct) wins before falling back to a fuzzy
// substring keyword scan. Without this, clip "Run" would lose to
// "Ability1TrunkRam" when resolving the 'run' state, because "trunkram"
// happens to contain the substring "run".
function findClipForState(clipNames, state) {
  const keywords = STATE_KEYWORDS[state];
  const snake = state.replace(/_/g, '');
  const lowered = clipNames.map((c) => ({
    name: c,
    lower: c.toLowerCase(),
    compact: c.toLowerCase().replace(/[_\s-]/g, ''),
  }));

  // 1) Exact match on the state name (or snake_case variant).
  for (const entry of lowered) {
    if (entry.compact === state || entry.compact === snake) return entry.name;
  }

  // 2) Keyword substring match.
  for (const kw of keywords) {
    for (const entry of lowered) {
      if (entry.lower.includes(kw)) return entry.name;
    }
  }
  return null;
}

function printSummary(rows) {
  console.log(`── Summary ──`);
  const totalStates = PRIORITY.length;
  const header =
    `  ${'id'.padEnd(12)}${'size'.padEnd(10)}${'verts'.padEnd(8)}` +
    `${'n/uv'.padEnd(7)}${'mat'.padEnd(6)}${'clips'.padEnd(8)}${'covered'.padEnd(10)}orphans`;
  console.log(header);
  console.log(`  ${'-'.repeat(header.length - 2)}`);
  for (const r of rows) {
    if (r.error) {
      console.log(`  ${r.id.padEnd(12)}${(r.sizeKB + ' KB').padEnd(10)}ERROR`);
      continue;
    }
    const covered = `${r.resolvedCount}/${totalStates}`;
    const attrs = `${flag(r.geoAudit.hasNormal)}/${flag(r.geoAudit.hasUv)}`;
    const mat = r.matAudit.missingOnMesh ? '⚠' : String(r.matAudit.count);
    console.log(
      `  ${r.id.padEnd(12)}${(r.sizeKB + ' KB').padEnd(10)}` +
      `${String(r.geoAudit.totalVerts).padEnd(8)}${attrs.padEnd(7)}${mat.padEnd(6)}` +
      `${String(r.clips.length).padEnd(8)}${covered.padEnd(10)}${r.orphanCount || ''}`
    );
  }
  console.log();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
