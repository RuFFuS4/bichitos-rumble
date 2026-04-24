#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rebuild the HUD sprite sheet from the authored PNG
// ---------------------------------------------------------------------------
//
// Source: `HUD_mejorado.png` in the project root — the artist-final version
// with clean icons (no labels) in a 4 × 6 grid with 20 px margin + 20 px
// gutter between cells (measured against the export guides).
//
// This script extracts each cell individually, drops the gutter+margin
// padding, and recomposes a uniform 4 × 6 grid of 256 × 256 square cells
// (total 1024 × 1536, matching the legacy sheet dimensions so CSS stays
// trivial: `background-size: 400% 600%`, positions at 0/33.3/66.6/100%
// horizontally and 0/20/40/60/80/100% vertically).
//
// Special case — belts-trophy in row 5 occupies TWO horizontal cells
// (col 2-3 merged) because the championship belt is a wide horizontal
// shape that reads badly when squished into a square. We letterbox it
// into a single cell (preserving aspect, top/bottom transparent padding)
// so all downstream CSS keeps treating every icon as 1-cell-square.
//
// Output: `public/images/hud-icons.png` (overwrites the current sheet;
// the original trimmed one stays available at `hud-icons.original.png`
// from the earlier trim script for emergency rollback).
//
// Usage: `node scripts/rebuild-hud-sheet.mjs`.
// Idempotent: re-runs always read from `HUD_mejorado.png`, so running
// twice produces the same output.
// ---------------------------------------------------------------------------

import sharp from 'sharp';
import { resolve } from 'node:path';

const SOURCE = resolve('HUD_mejorado.png');
const OUT = resolve('public/images/hud-icons.png');

// Authored sheet layout (measured from the export guides the user shared):
//   canvas:   1024 × 1536
//   grid:     4 cols × 6 rows
//   margin:   20 px (all four sides)
//   gutter:   20 px (between cells)
// Derivation (horizontal): (1024 - 2*20 - 3*20) / 4 = 924 / 4 = 231 px per cell.
// Derivation (vertical):   (1536 - 2*20 - 5*20) / 6 = 1396 / 6 ≈ 232.67 px per cell.
const SRC_W = 1024;
const SRC_H = 1536;
const COLS = 4;
const ROWS = 6;
const MARGIN = 20;
const GUTTER = 20;
const SRC_CELL_W = (SRC_W - 2 * MARGIN - (COLS - 1) * GUTTER) / COLS; // 231
const SRC_CELL_H = (SRC_H - 2 * MARGIN - (ROWS - 1) * GUTTER) / ROWS; // 232.67

// Target grid is uniform + square so the CSS stays simple.
const DST_CELL = 256;
const DST_W = COLS * DST_CELL; // 1024
const DST_H = ROWS * DST_CELL; // 1536

/** (col, row) → source rect in the authored PNG. */
function srcRect(col, row, widthCells = 1) {
  // widthCells lets us pull a horizontal pair (belts-trophy) as a single
  // wide extract: from col to col+widthCells−1, including the inner
  // gutter between them.
  const x = Math.round(MARGIN + col * (SRC_CELL_W + GUTTER));
  const y = Math.round(MARGIN + row * (SRC_CELL_H + GUTTER));
  const w = Math.round(widthCells * SRC_CELL_W + (widthCells - 1) * GUTTER);
  const h = Math.round(SRC_CELL_H);
  return { left: x, top: y, width: w, height: h };
}

async function main() {
  // Cells that occupy more than one column in the source. Keyed by
  // "col,row" — extraction uses the width; the destination always
  // places it in the first (col) slot and leaves the neighbouring
  // slot empty (transparent cell in the output grid).
  const WIDE_CELLS = {
    // belts-trophy: row 5 (bottom), cols 2–3 (spans both).
    '2,5': { widthCells: 2 },
  };
  // Cells in the destination grid that should be left blank (no icon).
  // With belts-trophy at (2,5) spanning to (3,5), slot (3,5) is blank.
  // Other empties (if we ever trim more icons) go here too.
  const BLANK_CELLS = new Set([
    '3,5', // right of the wide belts-trophy
  ]);

  // 1) Render every cell into a 256×256 tile, in memory.
  const tiles = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const key = `${col},${row}`;
      if (BLANK_CELLS.has(key)) continue;
      const wide = WIDE_CELLS[key]?.widthCells ?? 1;
      const rect = srcRect(col, row, wide);
      let cell = sharp(SOURCE).extract(rect);
      if (wide > 1) {
        // Letterbox wide cells into a square: preserve aspect, centre the
        // icon, fill remaining vertical padding with transparency.
        cell = cell.resize(DST_CELL, null, {
          fit: 'inside',
          kernel: 'lanczos3',
        }).extend({
          top: Math.floor((DST_CELL - Math.round((DST_CELL / rect.width) * rect.height)) / 2),
          bottom: 0, // extend() auto-pads to match the second dim below
          left: 0, right: 0,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        });
      } else {
        // Normal cells just resize to 256×256. Source is 231×232.67 so
        // the stretch is ~1.08× horizontal, ~1.10× vertical — visually
        // indistinguishable for chibi icons.
        cell = cell.resize(DST_CELL, DST_CELL, { kernel: 'lanczos3' });
      }
      const buf = await cell.png().toBuffer();
      tiles.push({
        input: buf,
        left: col * DST_CELL,
        top: row * DST_CELL,
      });
    }
  }

  // 2) Compose the 1024×1536 output on a transparent canvas.
  await sharp({
    create: {
      width: DST_W,
      height: DST_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(tiles)
    .png()
    .toFile(OUT);

  console.log(`[rebuild-hud-sheet] wrote ${OUT}  (${DST_W} × ${DST_H}, 4×6 grid, cell ${DST_CELL}×${DST_CELL})`);
  console.log(`[rebuild-hud-sheet] tiles written: ${tiles.length}`);
  console.log(`[rebuild-hud-sheet] CSS reminder: background-size must be 400% 600% (was 700% for the 7-row sheet).`);
}

main().catch((e) => {
  console.error('[rebuild-hud-sheet] failed:', e);
  process.exit(1);
});
