#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Erase label text from the HUD sprite sheet
// ---------------------------------------------------------------------------
//
// public/images/hud-icons.png ships as a 1024×1536 sheet with 4 cols × 7 rows
// of chibi icons. Each cell was authored by the IA with a numeric label +
// caption below the icon (e.g. "5. ELEPHANT", "6. FOX 9-TAILS"). The labels
// were meant as artist reference but end up visible in-game because the
// sheet is used directly for the HUD + character selector without extra
// cropping.
//
// This one-shot clears the label strip at the bottom of every cell by
// setting alpha=0 on every pixel inside that strip. No resize — cell
// dimensions stay 256×219 so CSS background-size + positions don't need
// recalculation, and the icons keep their authored aspect ratio (no
// vertical stretch). Raw buffer manipulation instead of sharp composite
// because sharp's "source" blend mode erased the whole sheet on first try.
//
// Usage: `node scripts/trim-hud-sheet.mjs`.
// Backs up the previous PNG to `hud-icons.original.png` on first run so
// re-running is idempotent; subsequent runs always read from the backup.
// ---------------------------------------------------------------------------

import sharp from 'sharp';
import { existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('public/images/hud-icons.png');
const BACKUP = resolve('public/images/hud-icons.original.png');

const COLS = 4;
const ROWS = 7;
// Icon ends roughly at 66 % of the cell; everything below is label.
const ICON_KEEP_RATIO = 0.66;

async function main() {
  if (!existsSync(BACKUP)) {
    copyFileSync(SRC, BACKUP);
    console.log(`[trim-hud-sheet] backup created: ${BACKUP}`);
  }

  // Always read from the pristine backup so re-runs are idempotent.
  const meta = await sharp(BACKUP).metadata();
  if (!meta.width || !meta.height) throw new Error('no dims');
  const W = meta.width;
  const H = meta.height;

  const cellW = Math.floor(W / COLS);
  const cellH = Math.floor(H / ROWS);
  const keepH = Math.round(cellH * ICON_KEEP_RATIO);
  const labelTop = keepH; // within a cell, the label strip starts here

  console.log(`[trim-hud-sheet] sheet  ${W} × ${H}  (cell ${cellW} × ${cellH})`);
  console.log(`[trim-hud-sheet] erase  rows ${labelTop}..${cellH} of every cell (bottom strip)`);

  // Read the PNG into a raw RGBA buffer so we can zero out alpha in the
  // label strips. ensureAlpha() promotes RGB → RGBA if needed.
  const { data, info } = await sharp(BACKUP)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const channels = info.channels; // should be 4

  let erased = 0;
  for (let r = 0; r < ROWS; r++) {
    const cellYStart = r * cellH + labelTop;
    const cellYEnd = (r + 1) * cellH;
    for (let y = cellYStart; y < cellYEnd; y++) {
      if (y >= H) break;
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * channels;
        // Zero RGB + alpha so the pixel is fully transparent; resetting
        // RGB avoids leaving pre-multiplied colour artefacts in some
        // decoders even when alpha is 0.
        pixels[idx + 0] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        if (channels >= 4) pixels[idx + 3] = 0;
        erased++;
      }
    }
  }

  await sharp(data, {
    raw: { width: W, height: H, channels },
  })
    .png()
    .toFile(SRC);

  console.log(`[trim-hud-sheet] cleared ${erased} label pixels`);
  console.log(`[trim-hud-sheet] wrote ${SRC}`);
  console.log('');
  console.log(`Sheet dimensions unchanged — CSS background-size + positions stay valid.`);
}

main().catch((e) => {
  console.error('[trim-hud-sheet] failed:', e);
  process.exit(1);
});
