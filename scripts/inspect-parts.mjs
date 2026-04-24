#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Critter GLB part inspector
// ---------------------------------------------------------------------------
//
// Did Tripo / Meshy preserve the logical body-part separation the user
// authored before export? This script walks the GLB scene graph and
// reports every Mesh / Node name, so we can tell whether we can hook
// "proc shrink shell head" or "proc stretch trunk" kinds of ability
// effects without shipping extra meshes.
//
// Output per GLB:
//   - mesh count + total vertex count
//   - per-primitive rows: name, vertex count, parent chain (ellipsis
//     for long parents)
//   - per-node rows for nodes that own no geometry (e.g. pure joints /
//     group empties — useful for detecting "Trunk_Nose_Group" style
//     containers)
//   - suggestions: if any common part keyword matches (nose/trunk/head/
//     shell/leg/arm/wing/tail/horn/claw/ear), flag it as a candidate
//     for procedural manipulation.
//
// Usage:
//   node scripts/inspect-parts.mjs                                 # all 9 critters
//   node scripts/inspect-parts.mjs public/models/critters/trunk.glb
//   npm run inspect:parts
//   npm run inspect:parts public/models/critters/trunk.glb
//
// 100% read-only. No side effects on the GLB files.
// ---------------------------------------------------------------------------

import { readdir, stat } from 'node:fs/promises';
import { basename, extname, resolve, join, relative } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const DEFAULT_DIR = resolve('public/models/critters');

// Keywords that tend to signal interesting body parts. Matched
// case-insensitively against node / mesh names. Extend freely — the
// worst case of a stray match is a false-positive hint, no failure.
const PART_KEYWORDS = [
  'nose', 'trunk', 'snout', 'beak', 'muzzle',
  'head', 'face', 'skull',
  'shell', 'carapace',
  'tail',
  'wing', 'fin',
  'arm', 'hand', 'claw', 'pincer', 'paw',
  'leg', 'foot', 'feet',
  'ear', 'horn', 'antler', 'crest',
  'eye',
  'body', 'torso', 'chest', 'belly',
  'cape', 'hat',
];

const args = process.argv.slice(2);
let targets = [];
for (const a of args) {
  if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else if (!a.startsWith('--')) targets.push(resolve(a));
  else { console.error(`Unknown flag: ${a}`); usage(); process.exit(1); }
}

async function main() {
  if (targets.length === 0) {
    const entries = await readdir(DEFAULT_DIR);
    targets = entries
      .filter((f) => extname(f).toLowerCase() === '.glb')
      .sort()
      .map((f) => join(DEFAULT_DIR, f));
  }
  if (targets.length === 0) {
    console.error(`No .glb files found at ${DEFAULT_DIR}`);
    process.exit(1);
  }

  console.log(`\n  Bichitos Rumble — Critter Part Inspector`);
  console.log(`  Target: ${relative(process.cwd(), DEFAULT_DIR)}`);
  console.log(`  Files:  ${targets.length}\n`);

  for (const file of targets) {
    await inspectOne(file);
  }
}

async function inspectOne(filePath) {
  const id = basename(filePath, '.glb');
  const info = await stat(filePath).catch(() => null);
  if (!info || !info.isFile()) {
    console.log(`── ${id} ──  (not found)\n`);
    return;
  }
  const sizeKB = (info.size / 1024).toFixed(0);

  let doc;
  try {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    doc = await io.read(filePath);
  } catch (err) {
    console.log(`── ${id} ──  ERROR: ${err.message}\n`);
    return;
  }

  const root = doc.getRoot();
  const meshes = root.listMeshes();
  const nodes = root.listNodes();

  let totalVerts = 0;
  const meshRows = [];
  for (const mesh of meshes) {
    const meshName = mesh.getName() || '(unnamed)';
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const verts = pos ? pos.getCount() : 0;
      totalVerts += verts;
      meshRows.push({ meshName, verts });
    }
  }

  // Nodes that own a mesh: easier to label by their parent name (the
  // node) rather than the mesh itself.
  const namedNodes = [];
  for (const node of nodes) {
    const name = node.getName();
    if (!name) continue;
    const hasMesh = !!node.getMesh();
    const hasSkin = !!node.getSkin();
    namedNodes.push({ name, hasMesh, hasSkin });
  }

  console.log(`── ${id} ──  (${sizeKB} KB, ${meshes.length} meshes, ${nodes.length} nodes, ${totalVerts.toLocaleString()} verts)`);

  // Mesh rows
  if (meshRows.length > 0) {
    console.log(`   Meshes / primitives (name · vertex count):`);
    for (const r of meshRows) {
      const flag = matchPartKeyword(r.meshName) ? ' ★' : '';
      console.log(`     · ${r.meshName.padEnd(36)} ${String(r.verts).padStart(7)} verts${flag}`);
    }
  }

  // Node rows — filter to the ones that have a name and don't duplicate
  // the mesh row (i.e. an empty container node or a skinning joint).
  const interestingNodes = namedNodes.filter((n) =>
    !n.hasMesh || /_group|_parent|armature|root|rig/i.test(n.name),
  );
  if (interestingNodes.length > 0) {
    console.log(`   Nodes without geometry (joints / groups):`);
    for (const n of interestingNodes.slice(0, 60)) {
      const flag = matchPartKeyword(n.name) ? ' ★' : '';
      const kind = n.hasSkin ? 'skin-root' : n.hasMesh ? 'mesh+group' : 'empty/joint';
      console.log(`     · ${n.name.padEnd(36)} ${kind.padStart(12)}${flag}`);
    }
    if (interestingNodes.length > 60) {
      console.log(`     … and ${interestingNodes.length - 60} more (truncated).`);
    }
  }

  // Part-keyword suggestions — collect from both meshes and nodes
  const suggestions = new Set();
  for (const r of meshRows) {
    const kw = matchPartKeyword(r.meshName);
    if (kw) suggestions.add(`${kw} ← ${r.meshName}`);
  }
  for (const n of namedNodes) {
    const kw = matchPartKeyword(n.name);
    if (kw) suggestions.add(`${kw} ← ${n.name}`);
  }
  if (suggestions.size > 0) {
    console.log(`   ★ Part-keyword hits (candidates for procedural hooks):`);
    for (const s of suggestions) console.log(`     ${s}`);
  } else {
    console.log(`   · No part-keyword hits — mesh is either unnamed or fully merged.`);
  }

  console.log();
}

function matchPartKeyword(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const kw of PART_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

function usage() {
  console.log(`
Usage: node scripts/inspect-parts.mjs [glb-path...]

No argument → inspects every .glb under public/models/critters/.
Reports mesh + node names, flags keyword matches (trunk, shell,
head, leg, …) that might be hookable by procedural effects.
  `.trim());
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
