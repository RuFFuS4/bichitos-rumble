#!/usr/bin/env node
// ---------------------------------------------------------------------------
// critter-recipe — hand edits of a critter GLB, reproducible from a recipe
// ---------------------------------------------------------------------------
//
// Some clips need surgery the source never had (Kowalski's Run: feet that
// sweep the ground, an upright torso). Doing it by hand in Blender leaves a
// binary nobody can regenerate — and a later `import-critter` (e.g. a
// re-export from Tripo) would wipe it silently. So every edit lives in
// scripts/critter-recipes/<id>.json and this script replays it:
//
//   1. take the BASE GLB pinned in the recipe (`git show <ref>:<path>`),
//      never the file it is about to overwrite — replaying is idempotent;
//   2. per edited clip, run Blender headless with
//      scripts/blender/critter-clip-edit.py → a donor GLB;
//   3. copy only that clip's listed channels from the donor into the base
//      — every bone Blender edited must be in `nodes`, or it fails;
//   4. repack with gltfpack -c -kn (same tail as compress-critter-glbs), so
//      the new keys are quantised like the rest: geometry and the other
//      clips come out equivalent (same triangles, rotations within
//      ~0.003°), textures byte-identical;
//   5. when writing the game GLB: regenerate RUN_GAIT
//      (inspect-stride --write) and the URL version (stamp-critter-glbs),
//      and record the output hash in the recipe (`output`).
//
// Usage:
//   node scripts/critter-recipe.mjs kowalski                    # apply → public/models/critters/kowalski.glb
//   node scripts/critter-recipe.mjs kowalski --out=x.glb        # A/B: write elsewhere, touch nothing else
//   node scripts/critter-recipe.mjs kowalski --out=x.glb --set=Run.torso.pitchDeg=8   # try a value
//
// The game GLB only ever comes from the versioned recipe: --set needs
// --out, and the script refuses to overwrite a game GLB that is neither
// the recipe's last `output` nor its base (someone changed it outside the
// recipe — a re-import?) unless --force.
//
// Blender: $BLENDER, else `blender` on the PATH (tested with 5.2 LTS).
// After a re-import of the critter, commit it, point `base.ref` at that
// commit and replay — see ASSET_PIPELINE.md §"Recetas post-import".
// ---------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
if (!id) {
  console.error('uso: node scripts/critter-recipe.mjs <id> [--out=fichero.glb] [--set=Clip.seccion.clave=valor]');
  process.exit(1);
}
const outArg = args.find((a) => a.startsWith('--out='))?.slice(6);
const force = args.includes('--force');
const sets = args.filter((a) => a.startsWith('--set='));
const gamePath = resolve(ROOT, 'public/models/critters', `${id}.glb`);
const outPath = outArg ? resolve(outArg) : gamePath;
const writesGame = outPath === gamePath;
const recipePath = resolve(ROOT, 'scripts/critter-recipes', `${id}.json`);
const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);
const fail = (msg) => { console.error(`[receta] ${msg}`); process.exit(1); };
const baseBytes = execFileSync('git', ['show', `${recipe.base.ref}:public/models/critters/${id}.glb`], { cwd: ROOT, maxBuffer: 1 << 28 });

if (writesGame && sets.length) {
  fail('--set solo con --out: el GLB del juego sale siempre de la receta versionada. Pasa el valor a la receta y relánzala.');
}
if (writesGame && !force) {
  const current = hash8(readFileSync(gamePath));
  if (current !== recipe.output && current !== hash8(baseBytes)) {
    fail(`${id}.glb (${current}) no es la última salida de la receta (${recipe.output ?? '—'}) ni su base ${recipe.base.ref}: `
      + 'ha cambiado por fuera (¿un re-import?). Commitéalo, apunta base.ref a ese commit y relanza; --force para pisarlo igualmente.');
  }
}

// --set=Run.torso.pitchDeg=8 → recipe.clips[Run].blender.torso.pitchDeg = 8
for (const set of sets) {
  const [path, raw] = set.slice(6).split('=');
  const [clipName, ...keys] = path.split('.');
  const edit = recipe.clips.find((c) => c.clip === clipName);
  if (!edit || !keys.length) throw new Error(`--set: no clip "${clipName}" in the recipe, or no key`);
  let obj = edit.blender;
  for (const k of keys.slice(0, -1)) obj = obj[k] ??= {};
  obj[keys.at(-1)] = JSON.parse(raw);
}

const tmp = mkdtempSync(join(tmpdir(), `critter-recipe-${id}-`));
const mb = (p) => (statSync(p).size / 1048576).toFixed(3);
try {
  const basePath = join(tmp, 'base.glb');
  writeFileSync(basePath, baseBytes);
  console.log(`[receta] ${id}: base ${recipe.base.ref} (${mb(basePath)} MB)`);

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const game = await io.read(basePath);

  const blender = process.env.BLENDER || 'blender';
  for (const edit of recipe.clips) {
    const params = join(tmp, `${edit.clip}.json`);
    const donorPath = join(tmp, `${edit.clip}.donor.glb`);
    writeFileSync(params, JSON.stringify({ clip: edit.clip, ...edit.blender }));
    const log = execFileSync(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', resolve(ROOT, 'scripts/blender/critter-clip-edit.py'), '--', basePath, donorPath, params],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
    for (const line of log.split('\n')) if (/^\[(edit|hold|ik|saltos|torso)\]/.test(line)) console.log(`  ${line.trim()}`);
    const written = (log.match(/^\[escritos\] (.*)$/m)?.[1] ?? '').trim().split(',').filter(Boolean);
    const left = edit.nodes === 'all' ? [] : written.filter((bone) => !edit.nodes.includes(bone));
    if (left.length) throw new Error(`${edit.clip}: Blender editó ${left.join(', ')}, que no está en "nodes": la edición se perdería`);
    const lines = transplantClip(game, await io.read(donorPath), edit.clip, edit.nodes);
    console.log(`  trasplante: ${lines.length} canales (${edit.nodes === 'all' ? 'todos' : edit.nodes.join(', ')})`);
  }

  const plainPath = join(tmp, 'plain.glb');
  writeFileSync(plainPath, await io.writeBinary(game));
  if (recipe.repack) {
    // gltfpack's own CLI through node, no shell: paths with spaces survive.
    execFileSync(process.execPath, [resolve(ROOT, 'node_modules/gltfpack/cli.js'), '-i', plainPath, '-o', outPath, '-c', '-kn'],
      { cwd: ROOT, stdio: 'inherit' });
  } else {
    writeFileSync(outPath, readFileSync(plainPath));
  }
  console.log(`[receta] → ${outPath} (${mb(outPath)} MB)`);

  if (writesGame) {
    execFileSync(process.execPath, [resolve(ROOT, 'scripts/inspect-stride.mjs'), '--write'], { cwd: ROOT, stdio: 'inherit' });
    execFileSync(process.execPath, [resolve(ROOT, 'scripts/stamp-critter-glbs.mjs')], { cwd: ROOT, stdio: 'inherit' });
    recipe.output = hash8(readFileSync(gamePath));
    writeFileSync(recipePath, `${JSON.stringify(recipe, null, 2)}\n`);
    console.log(`[receta] output ${recipe.output} anotado en ${id}.json`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/**
 * Copy one clip's channels from the donor into the game GLB. Channels are
 * matched by node name + target path; only existing samplers are replaced
 * (a listed node with no channel in the game clip is an error, not a
 * silent skip). `nodes` is a list of node names or 'all'.
 */
function transplantClip(target, donor, clip, nodes) {
  const gAnim = target.getRoot().listAnimations().find((a) => a.getName() === clip);
  const dAnim = donor.getRoot().listAnimations().find((a) => a.getName() === clip);
  if (!gAnim || !dAnim) throw new Error(`no clip "${clip}" in the ${gAnim ? 'donor' : 'base'} GLB`);
  const buffer = target.getRoot().listBuffers()[0];
  const wanted = nodes === 'all' ? null : new Set(nodes);
  const done = [];
  for (const ch of gAnim.listChannels()) {
    const node = ch.getTargetNode();
    const path = ch.getTargetPath();
    if (!node || (wanted && !wanted.has(node.getName()))) continue;
    const dch = dAnim.listChannels().find((c) => c.getTargetNode()?.getName() === node.getName() && c.getTargetPath() === path);
    if (!dch) continue;
    const ds = dch.getSampler();
    const dIn = ds.getInput();
    const dOut = ds.getOutput();
    // getElement de-normalises a quantised donor, so the copy is plain float.
    const n = dIn.getCount();
    const size = dOut.getElementSize();
    const times = new Float32Array(n);
    const vals = new Float32Array(n * size);
    const el = [];
    for (let i = 0; i < n; i++) {
      times[i] = dIn.getElement(i, el)[0];
      dOut.getElement(i, el);
      for (let k = 0; k < size; k++) vals[i * size + k] = el[k];
    }
    const tag = `${clip}_${node.getName()}_${path}`;
    const s = ch.getSampler();
    const old = [s.getInput(), s.getOutput()];
    s.setInput(target.createAccessor(`${tag}_t`).setType('SCALAR').setArray(times).setBuffer(buffer))
      .setOutput(target.createAccessor(`${tag}_v`).setType(dOut.getType()).setArray(vals).setBuffer(buffer))
      .setInterpolation(ds.getInterpolation() === 'STEP' ? 'STEP' : 'LINEAR');
    for (const acc of old) if (acc && acc.listParents().length <= 1) acc.dispose();
    done.push(`${node.getName()}.${path}`);
  }
  const missing = wanted ? [...wanted].filter((name) => !done.some((d) => d.startsWith(`${name}.`))) : [];
  if (missing.length) throw new Error(`${clip}: no channel to replace for ${missing.join(', ')}`);
  if (!done.length) throw new Error(`${clip}: nothing transplanted`);
  return done;
}
