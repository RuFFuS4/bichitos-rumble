// ---------------------------------------------------------------------------
// compress-critter-glbs — H2 slice 3: meshopt para los crítters sin comprimir
// ---------------------------------------------------------------------------
//
// Seis GLBs shipping SIN EXT_meshopt_compression (cheeto, kowalski,
// sergei, shelly, trunk, sihans). Este script les aplica el MISMO
// tramo final del pipeline de import (gltfpack `-c -kn`) — pero SIN el
// `-si 0.02` de import-critter, que está pensado para sources crudos de
// Meshy con millones de vértices: estos GLBs ya están simplificados y
// re-simplificarlos al 2 % los destruiría.
//
//   -c   → cuantización + compresión meshopt (decoder ya wired en
//          src/model-loader.ts desde la era del jam)
//   -kn  → conserva nombres de nodos (huesos para el resolver skeletal
//          + critter-parts)
//
// sihans además lleva un pase previo de textura (gltf-transform
// textureCompress → WebP ≤1024², q82 — idéntico al pipeline): su única
// textura es un PNG de ~5,3 MB, el 80 % del fichero.
//
// Los originales quedan en el historial de git (se sobreescribe in
// place, misma convención que el re-encode de kermit del jam).
// Verificación: verify-critter-glbs (clips por nombre) corre en
// `npm run check`; el pase visual va aparte.
//
// Uso: node scripts/compress-critter-glbs.mjs
// ---------------------------------------------------------------------------

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { stat, writeFile, unlink, rename } from 'node:fs/promises';

const DIR = 'public/models/critters';
const PLAIN = ['cheeto', 'kowalski', 'sergei', 'shelly', 'trunk'];
const WITH_TEXTURE_PASS = ['sihans'];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const mb = (n) => (n / 1048576).toFixed(2);

function runGltfpack(inPath, outPath) {
  return new Promise((res, rej) => {
    const child = spawn('npx', ['gltfpack', '-i', inPath, '-o', outPath, '-c', '-kn'],
      { shell: true, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`gltfpack exit ${code}`))));
  });
}

let before = 0, after = 0;

for (const id of [...PLAIN, ...WITH_TEXTURE_PASS]) {
  const path = `${DIR}/${id}.glb`;
  const srcSize = (await stat(path)).size;
  before += srcSize;

  let packInput = path;
  const tmpPre = `${DIR}/${id}.pre.glb`;
  if (WITH_TEXTURE_PASS.includes(id)) {
    const doc = await io.read(path);
    await doc.transform(
      dedup(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    );
    await writeFile(tmpPre, Buffer.from(await io.writeBinary(doc)));
    packInput = tmpPre;
  }

  const tmpOut = `${DIR}/${id}.packed.glb`;
  await runGltfpack(packInput, tmpOut);
  if (packInput === tmpPre) await unlink(tmpPre).catch(() => {});
  await rename(tmpOut, path);

  const dstSize = (await stat(path)).size;
  after += dstSize;
  console.log(`[glb] ${id.padEnd(10)} ${mb(srcSize)} MB → ${mb(dstSize)} MB`);
}

console.log(`[glb] TOTAL: ${mb(before)} MB → ${mb(after)} MB (−${mb(before - after)} MB)`);
