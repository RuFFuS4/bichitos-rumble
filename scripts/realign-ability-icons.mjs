#!/usr/bin/env node
// ---------------------------------------------------------------------------
// realign-ability-icons — re-centre each cell of ability-icons.png
// ---------------------------------------------------------------------------
//
// The ability sprite sheet ships with 3 cols × 9 rows of icons. CSS
// positions each cell via background-position percentages assuming
// the icon CONTENT sits exactly at its cell centre. Pixel-by-pixel
// centroid measurement of the original asset (run before this
// script) showed a systematic offset:
//
//   col 0 (slot J):  +7.1 px right of cell centre
//   col 1 (slot K):  -1.2 px (essentially centred)
//   col 2 (slot L):  -9.2 px left of cell centre
//   all rows:        +11 px down on average
//
// Translated to the rendered HUD (~48 px icon container) the J slot
// reads ~1.5 px right of centre, the L slot ~1.8 px left, and every
// icon sits ~2 px low. Visible to the eye even if subtle.
//
// What this script does
//   1. Backs up the source asset to .original.png if no backup
//      exists (idempotent — won't overwrite an existing backup).
//   2. For each (col, row) cell, measures the alpha-weighted
//      centroid of the visible content within the source cell.
//   3. Crops a square region centred on that centroid at the
//      target cell size (240 px).
//   4. Composites all 27 re-centred cells into a clean 720×2160
//      sheet (rounded from 724×2172 — same 3:9 aspect ratio so CSS
//      `background-size: 300% 900%` keeps working unchanged).
//   5. Writes the result back over the original.
//
// Run via:  node scripts/realign-ability-icons.mjs
// or:       npm run realign-ability-icons
//
// Idempotent on a clean sheet. Re-running on an already-aligned
// sheet has no effect (centroids land at cell centres).
// ---------------------------------------------------------------------------

import sharp from 'sharp';
import { existsSync } from 'node:fs';

const SRC_PATH = 'public/images/ability-icons.png';
const BACKUP_PATH = 'public/images/ability-icons.original.png';

// ---------------------------------------------------------------------------
// 1. Read source + back it up
// ---------------------------------------------------------------------------

const meta = await sharp(SRC_PATH).metadata();
const SRC_W = meta.width;
const SRC_H = meta.height;
console.log(`Source: ${SRC_PATH}  ${SRC_W}×${SRC_H}`);

if (!existsSync(BACKUP_PATH)) {
  await sharp(SRC_PATH).toFile(BACKUP_PATH);
  console.log(`Backup written → ${BACKUP_PATH}`);
} else {
  console.log(`Backup already exists at ${BACKUP_PATH} — leaving it alone.`);
}

const SRC_CELL_W = SRC_W / 3;
const SRC_CELL_H = SRC_H / 9;

// Output dimensions: round to clean integers so cells are exactly
// 240×240. CSS uses bg-size 300% 900% (relative), so the absolute
// pixel dims don't matter as long as the 3:9 aspect is preserved.
const DST_W = 720;
const DST_H = 2160;
const DST_CELL = 240;

// ---------------------------------------------------------------------------
// 2. Read raw RGBA + measure centroids
// ---------------------------------------------------------------------------

const { data, info } = await sharp(SRC_PATH).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
console.log(`Raw RGBA loaded: ${info.width}×${info.height} ${info.channels} channels`);

/** Alpha-weighted centroid of pixels with alpha > 50 within a rect. */
function centroid(x0, y0, w, h) {
  let sumX = 0, sumY = 0, count = 0;
  const x1 = Math.min(SRC_W, x0 + w);
  const y1 = Math.min(SRC_H, y0 + h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * SRC_W + x) * 4 + 3;
      if (data[idx] > 50) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count, count };
}

/**
 * Refine an initial crop top-left so the centroid of the resulting
 * 240×240 window lands at its centre. Needed because some source
 * cells have decorative motion swooshes that bleed into adjacent
 * cells — measuring the centroid clipped to the source cell rect
 * underestimates the true icon centre. Re-measuring within the
 * crop captures the full icon and converges in 1-2 passes.
 */
function refineCrop(initialX, initialY) {
  let cropX = initialX;
  let cropY = initialY;
  for (let iter = 0; iter < 5; iter++) {
    const clampedX = Math.max(0, Math.min(SRC_W - DST_CELL, cropX));
    const clampedY = Math.max(0, Math.min(SRC_H - DST_CELL, cropY));
    const c = centroid(clampedX, clampedY, DST_CELL, DST_CELL);
    if (c == null) return { x: clampedX, y: clampedY };
    const dx = c.x - (clampedX + DST_CELL / 2);
    const dy = c.y - (clampedY + DST_CELL / 2);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      return { x: clampedX, y: clampedY };
    }
    cropX = clampedX + Math.round(dx);
    cropY = clampedY + Math.round(dy);
    // Stop refining if we've hit a clamp boundary (further drift
    // toward the clamped edge is impossible).
    if (
      (clampedX === 0 && cropX < 0) ||
      (clampedX === SRC_W - DST_CELL && cropX > SRC_W - DST_CELL) ||
      (clampedY === 0 && cropY < 0) ||
      (clampedY === SRC_H - DST_CELL && cropY > SRC_H - DST_CELL)
    ) {
      return { x: clampedX, y: clampedY };
    }
  }
  // Did not converge in 5 iters — return last clamped position.
  return {
    x: Math.max(0, Math.min(SRC_W - DST_CELL, cropX)),
    y: Math.max(0, Math.min(SRC_H - DST_CELL, cropY)),
  };
}

// ---------------------------------------------------------------------------
// 3. Build the composite plan: extract centred crops
// ---------------------------------------------------------------------------

const composites = [];
let movedCount = 0;
for (let row = 0; row < 9; row++) {
  for (let col = 0; col < 3; col++) {
    const cellX0 = Math.floor(col * SRC_CELL_W);
    const cellY0 = Math.floor(row * SRC_CELL_H);
    const cellW = Math.ceil(SRC_CELL_W);
    const cellH = Math.ceil(SRC_CELL_H);

    const c = centroid(cellX0, cellY0, cellW, cellH);
    let initX, initY;
    if (c == null) {
      // Empty cell (no visible content) — fall back to cell-centre crop.
      initX = Math.round(cellX0 + cellW / 2 - DST_CELL / 2);
      initY = Math.round(cellY0 + cellH / 2 - DST_CELL / 2);
    } else {
      initX = Math.round(c.x - DST_CELL / 2);
      initY = Math.round(c.y - DST_CELL / 2);
    }

    // Refine: re-measure centroid within the crop window itself and
    // shift until centred. The crop window is wider than the source
    // cell rect so it captures icons whose decorations bleed into
    // neighbour cells. Falls back to clamped initial crop near edges.
    const { x: clampedX, y: clampedY } = refineCrop(initX, initY);

    if (clampedX !== cellX0 || clampedY !== cellY0) movedCount++;

    const cellBuf = await sharp(SRC_PATH)
      .extract({ left: clampedX, top: clampedY, width: DST_CELL, height: DST_CELL })
      .png()
      .toBuffer();

    composites.push({
      input: cellBuf,
      left: col * DST_CELL,
      top: row * DST_CELL,
    });

    if (c != null) {
      const dx = (c.x - cellX0) - cellW / 2;
      const dy = (c.y - cellY0) - cellH / 2;
      console.log(`  cell ${col},${row}  centroid offset=(${dx.toFixed(1)}, ${dy.toFixed(1)})  crop=(${clampedX}, ${clampedY})`);
    }
  }
}

console.log(`\nRecentred ${movedCount} of 27 cells.`);

// ---------------------------------------------------------------------------
// 4. Build the output sheet
// ---------------------------------------------------------------------------

const result = await sharp({
  create: {
    width: DST_W,
    height: DST_H,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(composites)
  .png()
  .toBuffer();

await sharp(result).toFile(SRC_PATH);
console.log(`\nWrote re-centred sheet → ${SRC_PATH}  (${DST_W}×${DST_H})`);
console.log('CSS does NOT need updating: background-size 300% 900% works on any 3:9 sheet.');
