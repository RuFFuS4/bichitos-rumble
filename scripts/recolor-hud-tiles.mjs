#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Recolor HUD chibi tiles to the current critter palette
// ---------------------------------------------------------------------------
//
// The chibi heads in the HUD sheet come from Rafa's `HUD_mejorado.png`
// (see rebuild-hud-sheet.mjs), drawn with the jam-era palette. On
// 2026-09-24 the critters took the palette of Rafa's sketches (PERSONAJES)
// and two tiles stopped matching the 3D model:
//   · Sergei — brown fur, now charcoal. Face, earrings and the saturated
//     wristbands stay (the 3D keeps brown wraps too).
//   · Shelly — brown shell, now olive green. Body and belly stay.
// Rafa approved this recolor over a regenerated drawing (2026-09-24).
//
// Only "dark brown" pixels move (hue 2-52°, saturated, low lightness),
// blended by how brown they are so edges stay soft. Soft edges also mean a
// second pass would nudge them again (measured: 240 px on Sergei), so a
// tile that no longer has a real brown mass (< ALREADY_DONE px, vs 20 880
// and 5 453 in the original drawing) is taken as done and left alone.
//
// Reads and rewrites the master `public/images/_raw/hud-icons.png`, then
// regenerates `public/images/hud-icons.webp` (q90, as compress-images.mjs).
// After a rebuild from HUD_mejorado.png the order is:
//   rebuild-hud-sheet.mjs → compress-images.mjs → recolor-hud-tiles.mjs
//
// Usage: node scripts/recolor-hud-tiles.mjs
// ---------------------------------------------------------------------------

import sharp from 'sharp';
import { resolve } from 'node:path';

const MASTER = resolve('public/images/_raw/hud-icons.png');
const WEBP = resolve('public/images/hud-icons.webp');
const CELL = 256; // the rebuilt sheet is a uniform 4 × 6 grid of 256 px
const ALREADY_DONE = 1000; // brown px (weight > 0.5) below which a tile counts as recoloured

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** How "dark brown" a pixel is, 0..1. `lMax` / `sMax` cap lightness and
 *  saturation so faces, bellies and saturated accents stay untouched. */
function brownWeight(h, s, l, lMax, sMax) {
  const hueW = smooth(2, 10, h) * (1 - smooth(42, 52, h));
  const satW = smooth(0.14, 0.28, s) * (1 - smooth(sMax - 0.08, sMax + 0.07, s));
  return hueW * satW * (1 - smooth(lMax - 0.08, lMax + 0.04, l));
}

// Target colours measured on the 3D thumbnails (slot-thumbnail.ts).
const RECIPES = [
  // Fur → neutral charcoal (3D #383838 / #484848). Wristbands are s ≥ 0.9.
  { name: 'sergei', col: 2, row: 1, lMax: 0.46, sMax: 0.78,
    to: (h, s, l) => hslToRgb(230, 0.05, Math.min(1, l * 1.02)) },
  // Shell → dark olive (3D #384828 / #485838).
  { name: 'shelly', col: 3, row: 1, lMax: 0.40, sMax: 2,
    to: (h, s, l) => hslToRgb(86, Math.min(0.5, s * 0.7), l * 1.05) },
];

const { data, info } = await sharp(MASTER).raw().toBuffer({ resolveWithObject: true });
const { width, channels } = info;

/** Visit every opaque pixel of a recipe's tile with its brown weight. */
function forEachTilePixel(r, visit) {
  for (let y = r.row * CELL; y < (r.row + 1) * CELL; y++) {
    for (let x = r.col * CELL; x < (r.col + 1) * CELL; x++) {
      const i = (y * width + x) * channels;
      if (data[i + 3] < 8) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const w = brownWeight(h, s, l, r.lMax, r.sMax);
      if (w > 0) visit(i, w, h, s, l);
    }
  }
}

let changed = false;
for (const r of RECIPES) {
  let brown = 0;
  forEachTilePixel(r, (_i, w) => { if (w > 0.5) brown++; });
  if (brown < ALREADY_DONE) {
    console.log(`[recolor-hud] ${r.name}: already recoloured (${brown} brown px), skipped`);
    continue;
  }
  forEachTilePixel(r, (i, w, h, s, l) => {
    const t = r.to(h, s, l);
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 - w) + t[c] * w);
  });
  changed = true;
  console.log(`[recolor-hud] ${r.name}: ${brown} px recoloured`);
}

if (changed) {
  await sharp(data, { raw: info }).png().toFile(MASTER);
  await sharp(MASTER).webp({ quality: 90 }).toFile(WEBP);
  console.log(`[recolor-hud] wrote ${MASTER} and ${WEBP}`);
} else {
  console.log('[recolor-hud] nothing to do');
}
