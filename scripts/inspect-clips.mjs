#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Per-clip variance inspector — does the runtime filter keep every clip?
// ---------------------------------------------------------------------------
//
// Companion to verify-critter-glbs.mjs. That script audits structure
// (geometry, materials, clip names, state coverage). This one drills
// into each AnimationClip and replicates the `isClipEffectivelyStatic`
// filter from src/critter-skeletal.ts, so we know ahead of time which
// clips would be DROPPED at runtime (T-pose snap = bad).
//
// Triggers of a dropped clip: a Tripo/Meshy export that flattened an
// fcurve to 2 identical keyframes, or a 0-variance placeholder. When
// we see one here, the fix is either to re-export the source clean or
// to transplant the clip with gltf-transform (see the Kermit fallback
// in BLENDER_MCP.md).
//
// Usage:
//   node scripts/inspect-clips.mjs <glb-path>
//   node scripts/inspect-clips.mjs public/models/critters/kowalski.glb
//
// EPS matches the runtime filter exactly (1e-4 per-component).
// ---------------------------------------------------------------------------

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const EPS = 1e-4;
const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/inspect-clips.mjs <glb-path>');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(path);
const anims = doc.getRoot().listAnimations();

console.log(`\n${path}`);
console.log(`Clips: ${anims.length}\n`);
console.log('clip                      dur(s)   channels  alive  max_var    runtime_verdict');
console.log('-'.repeat(90));

let dropped = 0;
for (const anim of anims) {
  const channels = anim.listChannels();
  let maxTime = 0;
  let aliveTracks = 0;
  let maxVar = 0;

  for (const ch of channels) {
    const sampler = ch.getSampler();
    if (!sampler) continue;
    const input = sampler.getInput();
    const output = sampler.getOutput();
    if (!input || !output) continue;
    const times = input.getArray();
    const values = output.getArray();
    if (!times || !values) continue;

    const last = times[times.length - 1];
    if (last > maxTime) maxTime = last;

    if (times.length < 2) continue;
    const stride = values.length / times.length;

    let trackVar = 0;
    let alive = false;
    for (let k = 1; k < times.length; k++) {
      for (let c = 0; c < stride; c++) {
        const diff = Math.abs(values[k * stride + c] - values[c]);
        if (diff > trackVar) trackVar = diff;
        if (diff > EPS) alive = true;
      }
    }
    if (alive) aliveTracks++;
    if (trackVar > maxVar) maxVar = trackVar;
  }

  const verdict = aliveTracks > 0 ? '✓ KEEP' : '❌ DROP (T-pose snap)';
  if (aliveTracks === 0) dropped++;
  console.log(
    `${(anim.getName() || '(unnamed)').padEnd(24)}  ${maxTime.toFixed(2).padStart(5)}   ${String(channels.length).padStart(7)}   ${String(aliveTracks).padStart(5)}  ${maxVar.toFixed(5).padStart(8)}  ${verdict}`,
  );
}

console.log();
if (dropped > 0) {
  console.log(`⚠ ${dropped} clip(s) would be dropped at runtime (static).`);
  console.log(`  Fix: re-export source clean or transplant via gltf-transform.`);
  process.exit(1);
}
console.log(`✓ All clips pass the runtime static filter.`);
