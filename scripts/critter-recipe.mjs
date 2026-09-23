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
//      then the optional `diet` (simplify to a triangle target) and
//      `textures` (dedup, WebP) sections — see their functions below;
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
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

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
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const game = await io.read(basePath);
  if (recipe.diet) await diet(game, recipe.diet);
  if (recipe.textures) await textures(game, recipe.textures);

  // Blender edits the prepared model: same rig and clips, and far lighter
  // to import once the diet has run.
  let blenderInput = basePath;
  if ((recipe.diet || recipe.textures) && recipe.clips?.length) {
    blenderInput = join(tmp, 'prepared.glb');
    writeFileSync(blenderInput, await io.writeBinary(game));
  }

  const blender = process.env.BLENDER || 'blender';
  for (const edit of recipe.clips ?? []) {
    const params = join(tmp, `${edit.clip}.json`);
    const donorPath = join(tmp, `${edit.clip}.donor.glb`);
    writeFileSync(params, JSON.stringify({ clip: edit.clip, ...edit.blender }));
    const log = execFileSync(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', resolve(ROOT, 'scripts/blender/critter-clip-edit.py'), '--', blenderInput, donorPath, params],
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
    execFileSync(process.execPath, [resolve(ROOT, 'node_modules/gltfpack/cli.js'), '-i', plainPath, '-o', outPath, '-c', '-kn', ...(recipe.gltfpack ?? [])],
      { cwd: ROOT, stdio: 'inherit' });
  } else {
    writeFileSync(outPath, readFileSync(plainPath));
  }
  const out = await io.read(outPath);
  console.log(`[receta] → ${outPath} (${mb(outPath)} MB · ${triangleCount(out)} triángulos · `
    + `${out.getRoot().listTextures().map((t) => t.getMimeType().replace('image/', '')).join('+') || 'sin texturas'})`);

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

// ---------------------------------------------------------------------------
// Diet and textures (graphics pass F2, 2026-09-23). Validated at game scale
// in .tmp/graficos/dieta of the PERSONAJES worktree: Kurama 20 k, Sebastian
// 15 k and Kermit 30 k triangles are indistinguishable in a match and in the
// character select, and Kermit keeps his warts at 30 k.
// ---------------------------------------------------------------------------

function primitives(doc) {
  return doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
}

function triangleCount(doc) {
  return primitives(doc).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
}

/**
 * `diet`: { targetTris, dropNormals?, uvSnapTexels?, renormal? }.
 * - dropNormals: Meshy exports split normals per face, which leaves every
 *   vertex "complex" for the simplifier (it stalls near 45 k): drop them,
 *   weld, and rebuild smooth ones by position.
 * - uvSnapTexels: at each position, UVs closer than this many texels are
 *   fake seams (about half of Meshy's) — make them equal so weld merges them.
 * - renormal: smooth normals rebuilt on the simplified mesh (inherited ones
 *   leave a dark notch at the base of Kurama's ear).
 * Refuses a model already at or below the target, so a diet never nests.
 */
async function diet(doc, { targetTris, dropNormals = false, uvSnapTexels = 0, renormal = true }) {
  const before = triangleCount(doc);
  if (before <= targetTris) throw new Error(`diet: the base already has ${before} triangles (target ${targetTris})`);
  if (dropNormals) for (const p of primitives(doc)) p.setAttribute('NORMAL', null);
  if (uvSnapTexels > 0) for (const p of primitives(doc)) snapUVs(p, uvSnapTexels);
  await doc.transform(weld());
  if (dropNormals) for (const p of primitives(doc)) smoothNormals(doc, p);
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: targetTris / before, error: 1 }));
  if (renormal) for (const p of primitives(doc)) smoothNormals(doc, p);
  // Skin weights survive weld/simplify untouched; check it anyway.
  const w = [];
  for (const p of primitives(doc)) {
    const weights = p.getAttribute('WEIGHTS_0');
    for (let i = 0; weights && i < weights.getCount(); i++) {
      weights.getElement(i, w);
      if (Math.abs(w[0] + w[1] + w[2] + w[3] - 1) > 0.02) throw new Error('diet: skin weights no longer add up to 1');
    }
  }
  console.log(`  dieta: ${before} → ${triangleCount(doc)} triángulos`);
}

/** Area-weighted face normals accumulated per POSITION, so UV seams don't
 *  split the shading. */
function smoothNormals(doc, prim) {
  const pos = prim.getAttribute('POSITION');
  const n = pos.getCount();
  const P = new Float32Array(n * 3);
  const el = [0, 0, 0];
  for (let i = 0; i < n; i++) { pos.getElement(i, el); P[3 * i] = el[0]; P[3 * i + 1] = el[1]; P[3 * i + 2] = el[2]; }
  const remap = MeshoptSimplifier.generatePositionRemap(P, 3);
  const acc = new Float32Array(n * 3);
  const idx = prim.getIndices().getArray();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
    const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // |n| = 2 × area
    for (const v of [a, b, c]) { const r = remap[v]; acc[3 * r] += nx; acc[3 * r + 1] += ny; acc[3 * r + 2] += nz; }
  }
  const N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = remap[i];
    const l = Math.hypot(acc[3 * r], acc[3 * r + 1], acc[3 * r + 2]) || 1;
    N[3 * i] = acc[3 * r] / l; N[3 * i + 1] = acc[3 * r + 1] / l; N[3 * i + 2] = acc[3 * r + 2] / l;
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(pos.getBuffer()));
}

/** At each position, give UVs closer than `texels` the same value so weld
 *  can merge them. Real seams (tens of texels apart) are left alone. */
function snapUVs(prim, texels) {
  const pos = prim.getAttribute('POSITION');
  const uv = prim.getAttribute('TEXCOORD_0');
  if (!uv) return;
  const info = prim.getMaterial()?.getBaseColorTextureInfo();
  const scale = info?.getExtension('KHR_texture_transform')?.getScale() ?? [1, 1];
  const size = prim.getMaterial()?.getBaseColorTexture()?.getSize() ?? [1024, 1024];
  const n = pos.getCount();
  const P = new Float32Array(n * 3);
  const e = [];
  for (let i = 0; i < n; i++) { pos.getElement(i, e); P[3 * i] = e[0]; P[3 * i + 1] = e[1]; P[3 * i + 2] = e[2]; }
  const remap = MeshoptSimplifier.generatePositionRemap(P, 3);
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = remap[i];
    if (r === i && !groups.has(r)) continue;
    let g = groups.get(r);
    if (!g) groups.set(r, (g = [r]));
    if (r !== i) g.push(i);
  }
  const raw = uv.getArray();
  const a = [], b = [];
  for (const g of groups.values()) {
    for (let x = 1; x < g.length; x++) {
      uv.getElement(g[x], b);
      for (let y = 0; y < x; y++) {
        uv.getElement(g[y], a);
        const d = Math.hypot((a[0] - b[0]) * scale[0] * size[0], (a[1] - b[1]) * scale[1] * size[1]);
        if (d === 0) break;
        if (d < texels) { raw[2 * g[x]] = raw[2 * g[y]]; raw[2 * g[x] + 1] = raw[2 * g[y] + 1]; break; }
      }
    }
  }
  uv.setArray(raw);
}

/**
 * `textures`: { dedup?, webp? }.
 * - dedup: one image for textures with identical bytes (the Meshy critters
 *   ship the base colour a second time as the emissive map).
 * - webp: re-encode as WebP at this quality (the Tripo 512² JPEGs).
 */
async function textures(doc, { dedup: shareIdentical = false, webp }) {
  const before = doc.getRoot().listTextures().reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0);
  if (shareIdentical) await doc.transform(dedup({ propertyTypes: [PropertyType.TEXTURE] }));
  if (webp) await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: webp }));
  const after = doc.getRoot().listTextures().reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0);
  console.log(`  texturas: ${(before / 1024).toFixed(0)} → ${(after / 1024).toFixed(0)} KB`);
}