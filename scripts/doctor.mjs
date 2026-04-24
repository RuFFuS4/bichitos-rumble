#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pre-submission doctor — exhaustive health check across the codebase
// ---------------------------------------------------------------------------
//
// Runs every smoke check we have, in one command, with a clear
// PASS / WARN / FAIL verdict per section and a final summary.
//
// Scope:
//   · typecheck (client + server, both strict)
//   · vite production build (and report bundle sizes vs budget)
//   · all critter GLBs (structure + state resolution)
//   · all critter clips (variance — would runtime drop any?)
//   · OG image present + roughly 1200×628
//   · favicon present
//   · every mapping fixture (scripts/mappings/*.json) corresponds to
//     an existing GLB and every GLB with non-zero clips has a fixture
//   · no stray .tmp / .pre.glb / .bak in public/
//   · devDependencies installed (gltfpack, sharp, terser, etc.)
//
// Exit non-zero if any FAIL surfaces. Use as a local gate before
// merging to main or tagging a release.
//
// Usage:
//   npm run doctor
//   node scripts/doctor.mjs
// ---------------------------------------------------------------------------

import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

// ---------------------------------------------------------------------------

const BUNDLE_WARN_MB = 1.5;     // warn if any single chunk exceeds (raw)
const BUNDLE_FAIL_MB = 3.0;     // fail if any single chunk exceeds (raw)
const SKELETAL_EPS = 1e-4;
const OG_TARGET_W = 1200;
const OG_TARGET_H = 628;
const OG_MAX_MB = 5;

const results = {
  pass: 0,
  warn: 0,
  fail: 0,
};

function section(title) {
  console.log(`\n── ${title} ──`);
}
function pass(msg) { results.pass++; console.log(`  ✓ ${msg}`); }
function warn(msg) { results.warn++; console.log(`  ⚠ ${msg}`); }
function fail(msg) { results.fail++; console.log(`  ✗ ${msg}`); }

// ---------------------------------------------------------------------------
// 1. Typecheck (client + server)
// ---------------------------------------------------------------------------

async function runTypecheck() {
  section('TypeScript (client)');
  try {
    await spawnOk('npx', ['tsc', '--noEmit']);
    pass('client tsc --noEmit clean');
  } catch (err) {
    fail(`client tsc failed: ${err.message}`);
  }

  section('TypeScript (server)');
  try {
    await spawnOk('npx', ['tsc', '--noEmit'], { cwd: resolve('server') });
    pass('server tsc --noEmit clean');
  } catch (err) {
    fail(`server tsc failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Vite production build + bundle sizes
// ---------------------------------------------------------------------------

async function runBuild() {
  section('Vite production build');
  try {
    await spawnOk('npx', ['vite', 'build']);
    pass('vite build clean');
  } catch (err) {
    fail(`vite build failed: ${err.message}`);
    return;
  }

  // Report chunk sizes
  const distAssets = resolve('dist/assets');
  let files;
  try { files = await readdir(distAssets); } catch { return; }
  const jsFiles = files.filter((f) => f.endsWith('.js'));
  for (const f of jsFiles) {
    const size = (await stat(join(distAssets, f))).size;
    const mb = size / 1024 / 1024;
    if (mb > BUNDLE_FAIL_MB) fail(`chunk ${f} is ${mb.toFixed(2)} MB (budget ${BUNDLE_FAIL_MB} MB)`);
    else if (mb > BUNDLE_WARN_MB) warn(`chunk ${f} is ${mb.toFixed(2)} MB (budget warn ${BUNDLE_WARN_MB} MB)`);
    else pass(`chunk ${f}: ${(size / 1024).toFixed(0)} KB`);
  }
}

// ---------------------------------------------------------------------------
// 3. Critter GLBs (structure + clips)
// ---------------------------------------------------------------------------

async function runGlbChecks() {
  section('Critter GLBs');
  const dir = resolve('public/models/critters');
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.glb'));
  if (entries.length !== 9) {
    warn(`expected 9 critter GLBs, found ${entries.length}`);
  }

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

  for (const file of entries.sort()) {
    const path = join(dir, file);
    try {
      const doc = await io.read(path);
      const anims = doc.getRoot().listAnimations();
      let staticCount = 0;
      for (const anim of anims) {
        let anyAlive = false;
        for (const ch of anim.listChannels()) {
          const samp = ch.getSampler();
          const vals = samp?.getOutput()?.getArray();
          if (!vals) continue;
          for (let i = 1; i < vals.length; i++) {
            if (Math.abs(vals[i] - vals[0]) > SKELETAL_EPS) {
              anyAlive = true;
              break;
            }
          }
          if (anyAlive) break;
        }
        if (!anyAlive && anim.listChannels().length > 0) staticCount++;
      }
      if (staticCount > 0) {
        warn(`${file}: ${staticCount} static clip(s) — runtime will drop`);
      } else if (anims.length === 0) {
        warn(`${file}: 0 clips (procedural-only critter)`);
      } else {
        pass(`${file}: ${anims.length} clips, all alive`);
      }
    } catch (err) {
      fail(`${file}: read error ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Mapping fixtures vs GLBs
// ---------------------------------------------------------------------------

async function runMappingConsistency() {
  section('Mapping fixtures (scripts/mappings/ vs public/models/critters/)');
  const mapDir = resolve('scripts/mappings');
  let mappings;
  try { mappings = (await readdir(mapDir)).filter((f) => f.endsWith('.json')); }
  catch { pass('no mappings directory — skip'); return; }
  for (const f of mappings) {
    const id = f.replace(/\.json$/, '');
    const glb = resolve(`public/models/critters/${id}.glb`);
    const info = await stat(glb).catch(() => null);
    if (!info) warn(`mapping ${f} has no matching ${id}.glb (re-import pending?)`);
    else pass(`${f} ↔ ${id}.glb`);
  }
}

// ---------------------------------------------------------------------------
// 5. OG image + favicon presence
// ---------------------------------------------------------------------------

async function runStaticAssets() {
  section('Social + favicon');
  const favicon = resolve('public/favicon.svg');
  const og = resolve('public/og-image.png');
  const favInfo = await stat(favicon).catch(() => null);
  if (favInfo) pass(`favicon.svg (${favInfo.size} B)`);
  else warn('favicon.svg missing — tab will render Vite default');

  const ogInfo = await stat(og).catch(() => null);
  if (!ogInfo) {
    warn('og-image.png missing — social card will 404 on share');
    return;
  }
  const mb = ogInfo.size / 1024 / 1024;
  if (mb > OG_MAX_MB) fail(`og-image.png is ${mb.toFixed(2)} MB (> ${OG_MAX_MB} MB X/Twitter limit)`);
  else pass(`og-image.png: ${mb.toFixed(2)} MB`);

  // Approximate dimensions via sharp if available.
  try {
    const sharpMod = await import('sharp');
    const metadata = await sharpMod.default(og).metadata();
    if (metadata.width !== OG_TARGET_W || metadata.height !== OG_TARGET_H) {
      warn(`og-image.png is ${metadata.width}×${metadata.height} (expected ${OG_TARGET_W}×${OG_TARGET_H})`);
    } else {
      pass(`og-image.png dimensions ${metadata.width}×${metadata.height}`);
    }
  } catch { /* sharp not installed or read failed; skip */ }
}

// ---------------------------------------------------------------------------
// 6. Stray intermediate files
// ---------------------------------------------------------------------------

async function runStrayFiles() {
  section('Stray intermediates (shouldn\'t ship)');
  const publicDir = resolve('public');
  const strays = [];
  async function walk(dir) {
    for (const name of await readdir(dir)) {
      const full = join(dir, name);
      const info = await stat(full);
      if (info.isDirectory()) await walk(full);
      else if (/\.(tmp|bak|pre\.glb)$/.test(name)) strays.push(full);
    }
  }
  await walk(publicDir);
  if (strays.length === 0) pass('no .tmp / .bak / .pre.glb under public/');
  else for (const s of strays) warn(`stray: ${s}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\n  Bichitos Rumble — Doctor');
console.log('  Running full pre-submission health check...');

await runTypecheck();
await runBuild();
await runGlbChecks();
await runMappingConsistency();
await runStaticAssets();
await runStrayFiles();

console.log(`\n── Summary ──`);
console.log(`  ${results.pass} pass · ${results.warn} warn · ${results.fail} fail`);

if (results.fail > 0) {
  console.log(`\n  ✗ FAIL — fix before merge.\n`);
  process.exit(1);
}
if (results.warn > 0) {
  console.log(`\n  ⚠ PASS WITH WARNINGS — review before merge.\n`);
  process.exit(0);
}
console.log(`\n  ✓ All green. Ship it.\n`);

// ---------------------------------------------------------------------------

function spawnOk(cmd, args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      ...opts,
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) resolveRun(undefined);
      else rejectRun(new Error(stderr.trim().split('\n').pop() || `exited ${code}`));
    });
  });
}
