#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Stride inspector — how fast does each Run clip "push the ground"?
// ---------------------------------------------------------------------------
//
// A Run clip is authored in place: the feet sweep back and forth under a
// body that never moves. In game the body DOES move, at whatever speed the
// physics says. The feet only look planted when the ground slides under
// them at the same speed the clip sweeps them backwards during contact —
// if the body is faster the critter glides, if slower it runs on a
// treadmill.
//
// This script measures that sweep speed ("stride speed") straight from the
// GLB, with the same three.js GLTFLoader + AnimationMixer the game uses:
//
//   1. load the GLB (textures stripped — they're irrelevant and GLTFLoader
//      can't decode images in node),
//   2. orient it like the game does (`RosterEntry.rotation`, so +Z is the
//      critter's forward, same as `Critter.mesh`),
//   3. sample the Run clip over one loop at timeScale 1,
//   4. for each foot bone, take the samples where it is in contact (low in
//      its own height range) and moving backwards, and keep the median
//      backward speed.
//
// Result is in MODEL units per second at timeScale 1 and roster scale 1 —
// the runtime multiplies by the critter's live GLB scale, so a future
// scale change doesn't invalidate the table.
//
// Usage:
//   node scripts/inspect-stride.mjs              # table for the 9 critters
//   node scripts/inspect-stride.mjs --json       # machine-readable
//   node scripts/inspect-stride.mjs --write      # regenerate src/critter-locomotion.ts
//   node scripts/inspect-stride.mjs kermit       # one critter
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getRosterEntry } from '../src/roster.ts';
import { ANIMATION_OVERRIDES } from '../src/animation-overrides.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CRITTERS = ['sergei', 'trunk', 'kurama', 'shelly', 'kermit', 'sihans', 'kowalski', 'cheeto', 'sebastian'];
const SAMPLES = 240;
/** Fraction of each foot's height range that still counts as "on the ground". */
const CONTACT_BAND = 0.25;
const OUT_TS = resolve(ROOT, 'src/critter-locomotion.ts');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const doWrite = args.includes('--write');
const only = args.filter((a) => !a.startsWith('--'));
const ids = only.length ? only : CRITTERS;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

/** GLB → three.js {scene, animations}, geometry and textures dropped. */
async function loadForAnimation(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  for (const t of root.listTextures()) t.dispose();
  for (const ext of root.listExtensionsUsed()) ext.dispose();
  const bin = await io.writeBinary(doc);
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  return new Promise((ok, fail) => new GLTFLoader().parse(buf, '', ok, fail));
}

function runClipName(id, clips) {
  const o = ANIMATION_OVERRIDES[id]?.run;
  const forced = typeof o === 'string' ? o : o?.clip;
  if (forced && clips.some((c) => c.name === forced)) return forced;
  // Same exact-name tier the runtime resolver tries first.
  return clips.find((c) => c.name.toLowerCase().replace(/[_\s-]/g, '') === 'run')?.name ?? null;
}

function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

async function measure(id) {
  const entry = getRosterEntry(id.charAt(0).toUpperCase() + id.slice(1)) ?? getRosterEntry(id);
  if (!entry?.glbPath) return { id, error: 'no GLB in roster' };
  const path = resolve(ROOT, 'public', entry.glbPath.replace(/^\.\//, ''));
  const gltf = await loadForAnimation(path);
  const clipName = runClipName(id, gltf.animations);
  if (!clipName) return { id, error: 'no Run clip' };
  const clip = gltf.animations.find((c) => c.name === clipName);

  const holder = new THREE.Group();
  gltf.scene.rotation.y = entry.rotation;
  holder.add(gltf.scene);
  const bones = [];
  gltf.scene.traverse((n) => { if (n.isBone) bones.push(n); });
  let feet = bones.filter((b) => /foot/i.test(b.name) && !/toe|end|nub|top/i.test(b.name));
  const feetSource = feet.length ? 'name' : 'lowest';
  if (!feet.length) {
    holder.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    feet = bones.map((b) => ({ b, y: b.getWorldPosition(v).y })).sort((a, c) => a.y - c.y).slice(0, 2).map((o) => o.b);
  }

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip);
  action.play();
  const dur = clip.duration;
  const dt = dur / SAMPLES;
  const series = feet.map(() => []);
  const v = new THREE.Vector3();
  for (let i = 0; i < SAMPLES; i++) {
    mixer.setTime(i * dt);
    holder.updateMatrixWorld(true);
    feet.forEach((b, fi) => { b.getWorldPosition(v); series[fi].push([v.x, v.y, v.z]); });
  }

  const perFoot = feet.map((b, fi) => {
    const s = series[fi];
    const ys = s.map((p) => p[1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const contactY = yMin + CONTACT_BAND * (yMax - yMin);
    const back = [];
    // Centro del apoyo como media circular de las fases en contacto.
    let cs = 0, sn = 0;
    let rangeX = [Infinity, -Infinity], rangeZ = [Infinity, -Infinity];
    for (let i = 0; i < SAMPLES; i++) {
      const [x, y, z] = s[i];
      rangeX = [Math.min(rangeX[0], x), Math.max(rangeX[1], x)];
      rangeZ = [Math.min(rangeZ[0], z), Math.max(rangeZ[1], z)];
      if (y > contactY) continue;
      const a = (i / SAMPLES) * 2 * Math.PI;
      cs += Math.cos(a); sn += Math.sin(a);
      const next = s[(i + 1) % SAMPLES], prev = s[(i - 1 + SAMPLES) % SAMPLES];
      const vz = (next[2] - prev[2]) / (2 * dt);
      if (vz < 0) back.push(-vz);
    }
    const contactPhase = ((Math.atan2(sn, cs) / (2 * Math.PI)) + 1) % 1;
    return {
      bone: b.name,
      left: /^l(eft)?[_\s.-]?|left/i.test(b.name),
      contactSpeed: median(back),
      contactFrac: back.length / SAMPLES,
      contactPhase,
      swingZ: rangeZ[1] - rangeZ[0],
      swingX: rangeX[1] - rangeX[0],
      lift: yMax - yMin,
    };
  }).filter((f) => Number.isFinite(f.contactSpeed));

  const stride = median(perFoot.map((f) => f.contactSpeed));
  const swingZ = median(perFoot.map((f) => f.swingZ));
  const swingX = median(perFoot.map((f) => f.swingX));
  const leftFoot = perFoot.find((f) => f.left);
  const warnings = [];
  if (perFoot.length < 2) warnings.push('menos de 2 pies medidos');
  if (!leftFoot) warnings.push('no identifico el pie izquierdo');
  if (swingX > swingZ * 1.25) warnings.push(`los pies barren más en X (${swingX.toFixed(3)}) que en Z (${swingZ.toFixed(3)}): ¿rotation del roster mal?`);
  return {
    id, clip: clipName, duration: dur, feetSource, feet: perFoot.map((f) => f.bone),
    stride, leftPhase: leftFoot?.contactPhase ?? 0, swingZ, rosterScale: entry.scale, strideWorld: stride * entry.scale,
    perFoot, warnings,
  };
}

const results = [];
for (const id of ids) results.push(await measure(id));

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('\nZancada del clip Run (unidades de modelo por segundo de clip, timeScale 1)\n');
  console.log('critter     clip  dur(s)  pies  zancada  f.izq  barrido  escala  zancada·escala  avisos');
  console.log('-'.repeat(102));
  for (const r of results) {
    if (r.error) { console.log(`${r.id.padEnd(11)} ERROR: ${r.error}`); continue; }
    console.log(
      `${r.id.padEnd(11)} ${r.clip.padEnd(5)} ${r.duration.toFixed(3).padStart(6)}  ${String(r.feet.length).padStart(4)}  ${r.stride.toFixed(3).padStart(7)}  ${r.leftPhase.toFixed(2).padStart(5)}  ${r.swingZ.toFixed(3).padStart(7)}  ${r.rosterScale.toFixed(2).padStart(6)}  ${r.strideWorld.toFixed(2).padStart(14)}  ${r.warnings.join('; ')}`,
    );
  }
}

if (doWrite) {
  if (only.length) {
    console.error('\n--write regenera la tabla ENTERA: lánzalo sin nombres de critter.');
    process.exit(1);
  }
  const bad = results.filter((r) => r.error || r.warnings.length);
  if (bad.length) {
    console.error(`\n--write abortado: ${bad.map((r) => r.id).join(', ')} con error o aviso. Revisa antes de regenerar.`);
    process.exit(1);
  }
  const src = readFileSync(OUT_TS, 'utf8');
  const anchor = 'export const RUN_GAIT';
  const start = src.indexOf(anchor);
  const end = src.indexOf('\n};', start);
  if (start < 0 || end < 0) { console.error('No encuentro RUN_GAIT en', OUT_TS); process.exit(1); }
  const body = results.map((r) =>
    `  ${r.id}: { stride: ${r.stride.toFixed(3)}, leftPhase: ${r.leftPhase.toFixed(2)} }, // ${r.clip} ${r.duration.toFixed(2)} s · ${r.feet.join(' + ')}`,
  ).join('\n');
  const next = src.slice(0, start) + 'export const RUN_GAIT: Record<string, RunGait> = {\n' + body + src.slice(end);
  writeFileSync(OUT_TS, next);
  console.log('\nescrito', OUT_TS);
}
