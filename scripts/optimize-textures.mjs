#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Texture-only GLB optimizer for Bichitos Rumble
// ---------------------------------------------------------------------------
//
// Conservative pass that reduces a GLB's payload by shrinking + recompressing
// its textures WITHOUT touching:
//   · skeleton / bone hierarchy
//   · AnimationClip tracks (keyframe data)
//   · clip names
//   · material structure (slot count, factors, alpha mode)
//   · mesh geometry
//
// What it does:
//   1. Reads every image referenced by the GLB.
//   2. Resizes each one to fit within MAX_DIM on its longest side (preserving
//      aspect ratio). Skips resize if the image is already smaller.
//   3. If the image's alpha channel is effectively opaque (>99.9% of pixels
//      at alpha=255) and its role is not normal/metallic-roughness (those
//      MUST stay raw), re-encodes it as JPEG at QUALITY. Otherwise keeps
//      it as PNG.
//   4. Writes the result to <output-path>.
//
// Usage:
//   node scripts/optimize-textures.mjs <input.glb> <output.glb>
//   node scripts/optimize-textures.mjs public/models/critters/sergei.glb /tmp/sergei-opt.glb
//
// Intentional NON-FEATURES:
//   · No mesh simplification (scope says "NO simplificar malla").
//   · No Draco compression (can break tooling compatibility).
//   · No animation resampling (would alter keyframes).
//   · No deduping of textures that are not bit-identical (ambiguous).
//
// Safety: always run `scripts/inspect-clips.mjs` + `scripts/verify-critter-
// glbs.mjs` on the output to confirm the animation data is byte-for-byte
// the same.
// ---------------------------------------------------------------------------

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const MAX_DIM = 1024;       // longest-side cap for resize
const JPEG_QUALITY = 85;    // JPEG quality when alpha is opaque
const ALPHA_OPAQUE_THRESHOLD = 0.999; // fraction of pixels that must be alpha=255

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/optimize-textures.mjs <input.glb> <output.glb>');
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

console.log(`\n[optimize-textures] Reading ${inputPath}`);
const doc = await io.read(inputPath);
const root = doc.getRoot();
const textures = root.listTextures();
const materials = root.listMaterials();

// Build a map from texture -> role (baseColor / emissive / normal / mr / occlusion)
// so we know which compression strategy is safe.
const roleByTexture = new Map();
for (const mat of materials) {
  const map = {
    baseColor: mat.getBaseColorTexture(),
    emissive: mat.getEmissiveTexture(),
    normal: mat.getNormalTexture(),
    metallicRoughness: mat.getMetallicRoughnessTexture(),
    occlusion: mat.getOcclusionTexture(),
  };
  for (const [role, tex] of Object.entries(map)) {
    if (tex) roleByTexture.set(tex, role);
  }
}

// Roles where losing alpha / switching to JPEG is safe visually.
// Normal maps and metallicRoughness MUST stay in lossless format — they
// are data, not color, and JPEG artifacts break shading.
const SAFE_TO_JPEG = new Set(['baseColor', 'emissive', 'occlusion']);

let totalOriginal = 0;
let totalOptimized = 0;
let changes = 0;

for (const [idx, tex] of textures.entries()) {
  const img = tex.getImage();
  if (!img) continue;
  const originalBytes = img.byteLength;
  totalOriginal += originalBytes;

  const role = roleByTexture.get(tex) || 'unknown';
  const meta = await sharp(Buffer.from(img)).metadata();
  const { width = 0, height = 0, channels = 3 } = meta;

  console.log(`\nTexture #${idx} (${role}) ${width}x${height} ${meta.format} ${(originalBytes / 1024).toFixed(1)} KB`);

  // Decide resize target
  const longest = Math.max(width, height);
  const resizeTarget = longest > MAX_DIM ? MAX_DIM : longest;
  const willResize = resizeTarget !== longest;

  // Analyze alpha opacity (only if channel count = 4)
  let alphaOpaque = channels < 4;
  if (channels === 4) {
    const { data, info } = await sharp(Buffer.from(img)).raw().toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    let opaqueCount = 0;
    for (let p = 0; p < pixels; p++) {
      if (data[p * info.channels + 3] === 255) opaqueCount++;
    }
    alphaOpaque = (opaqueCount / pixels) >= ALPHA_OPAQUE_THRESHOLD;
  }

  const canJpeg = alphaOpaque && SAFE_TO_JPEG.has(role);
  const targetFormat = canJpeg ? 'jpeg' : 'png';

  // Build the new image buffer
  let pipeline = sharp(Buffer.from(img));
  if (willResize) {
    pipeline = pipeline.resize(resizeTarget, resizeTarget, { fit: 'inside', withoutEnlargement: true });
  }
  if (targetFormat === 'jpeg') {
    pipeline = pipeline.flatten({ background: '#000000' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9, palette: false });
  }
  const newBuf = await pipeline.toBuffer();

  // Apply back to the texture + update MIME
  tex.setImage(new Uint8Array(newBuf));
  tex.setMimeType(targetFormat === 'jpeg' ? 'image/jpeg' : 'image/png');

  totalOptimized += newBuf.byteLength;
  changes++;

  const resizedDesc = willResize ? `${resizeTarget}x${resizeTarget}` : `${width}x${height} (unchanged)`;
  const formatDesc = targetFormat === 'jpeg' ? 'JPEG' : 'PNG';
  const saved = originalBytes - newBuf.byteLength;
  const savedPct = ((saved / originalBytes) * 100).toFixed(1);
  console.log(`  -> ${resizedDesc} ${formatDesc}  ${(newBuf.byteLength / 1024).toFixed(1)} KB  (-${savedPct}%)`);
}

console.log(`\n[optimize-textures] Writing ${outputPath}`);
await io.write(outputPath, doc);

console.log('\n=== SUMMARY ===');
console.log(`textures processed : ${changes}`);
console.log(`texture bytes      : ${(totalOriginal / 1024 / 1024).toFixed(2)} MB -> ${(totalOptimized / 1024 / 1024).toFixed(2)} MB`);
console.log(`reduction          : ${((1 - totalOptimized / totalOriginal) * 100).toFixed(1)}%`);
