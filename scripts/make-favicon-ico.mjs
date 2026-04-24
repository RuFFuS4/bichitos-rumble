#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Favicon .ico builder for Bichitos Rumble
// ---------------------------------------------------------------------------
//
// Reads public/favicon-br.png (the final HUD artwork) and builds
// public/favicon.ico — a multi-resolution .ico containing
// 16 / 32 / 48 / 64 / 128 / 256 px PNG frames. Modern browsers pick the
// best size automatically. Windows taskbar / tab icons historically
// prefer .ico over .png, iOS Safari also probes for /favicon.ico first.
//
// We keep favicon-br.png and favicon.svg alongside as fallbacks — this
// script only adds the .ico, never deletes.
//
// ICO layout (no external deps; sharp handles the resize):
//   [6 B header] [N × 16 B directory entries] [N × PNG bytes]
// PNG-in-ICO is supported by every browser since IE11. For older clients
// we keep the legacy PNG link too.
//
// Run:
//   node scripts/make-favicon-ico.mjs
// ---------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const SRC = 'public/favicon-br.png';
const OUT = 'public/favicon.ico';
const SIZES = [16, 32, 48, 64, 128, 256];

console.log(`[favicon-ico] Reading ${SRC}`);
const srcBuf = await readFile(SRC);
const srcMeta = await sharp(srcBuf).metadata();
console.log(`[favicon-ico] Source: ${srcMeta.width}x${srcMeta.height} ${srcMeta.format}`);

// Resize to every target size (PNG-encoded so we can embed directly).
const frames = [];
for (const size of SIZES) {
  const pngBuf = await sharp(srcBuf)
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  frames.push({ size, data: pngBuf });
  console.log(`  ${size}x${size} → ${pngBuf.byteLength} bytes`);
}

// --- Build ICO ---
const HEADER_SIZE = 6;
const DIR_ENTRY_SIZE = 16;
const dirOffset = HEADER_SIZE;
const dataOffset = HEADER_SIZE + DIR_ENTRY_SIZE * frames.length;

const totalSize = dataOffset + frames.reduce((s, f) => s + f.data.byteLength, 0);
const out = Buffer.alloc(totalSize);

// Header: reserved=0, type=1 (icon), count=N
out.writeUInt16LE(0, 0);            // reserved
out.writeUInt16LE(1, 2);            // 1 = icon
out.writeUInt16LE(frames.length, 4);

// Directory entries
let runningOffset = dataOffset;
for (let i = 0; i < frames.length; i++) {
  const { size, data } = frames[i];
  const entryStart = HEADER_SIZE + i * DIR_ENTRY_SIZE;
  // Width/Height: 0 represents 256 (per ICO spec).
  out.writeUInt8(size >= 256 ? 0 : size, entryStart + 0);
  out.writeUInt8(size >= 256 ? 0 : size, entryStart + 1);
  out.writeUInt8(0, entryStart + 2);                    // palette colors (0 = truecolor)
  out.writeUInt8(0, entryStart + 3);                    // reserved
  out.writeUInt16LE(1, entryStart + 4);                 // color planes
  out.writeUInt16LE(32, entryStart + 6);                // bits per pixel (RGBA)
  out.writeUInt32LE(data.byteLength, entryStart + 8);   // data size
  out.writeUInt32LE(runningOffset, entryStart + 12);    // data offset
  data.copy(out, runningOffset);
  runningOffset += data.byteLength;
}

await writeFile(OUT, out);
console.log(`\n[favicon-ico] Wrote ${OUT}: ${out.byteLength} bytes, ${frames.length} frames`);
