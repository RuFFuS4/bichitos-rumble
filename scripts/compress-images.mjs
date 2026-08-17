// ---------------------------------------------------------------------------
// compress-images — H2 slice 2: la dieta de imágenes
// ---------------------------------------------------------------------------
//
// Convierte los PNG pesados de runtime a WebP (soporte universal en
// navegadores WebGL2) y deja los masters en `_raw/` (excluidos del dist
// por clean-dist-raw, conservados en git para regenerar):
//
//   · sprites HUD/ability  → .webp q90 (flat-color + alpha, ~8× menos)
//   · skyboxes + grounds   → .webp q80 (texturas, per-match lazy)
//   · og-image.png         → og-image.jpg q82 (<600 KB — límite real de
//     preview de WhatsApp; JPEG por compatibilidad máxima de scrapers)
//   · favicon-br.png       → PNG 192px palette (los favicons siguen en
//     PNG por compatibilidad; 632 KB → ~decenas de KB)
//
// Idempotente: si el .webp ya existe y el master está en _raw, salta.
// Uso: node scripts/compress-images.mjs
// ---------------------------------------------------------------------------

import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';

const jobs = [
  // [src, dst, transform]
  ['public/images/hud-icons.png', 'public/images/hud-icons.webp', (s) => s.webp({ quality: 90 })],
  ['public/images/ability-icons.png', 'public/images/ability-icons.webp', (s) => s.webp({ quality: 90 })],
  ...['jungle', 'frozen_tundra', 'desert_dunes', 'coral_beach', 'kitsune_shrine'].flatMap((pack) => [
    [`public/images/skyboxes/${pack}.png`, `public/images/skyboxes/${pack}.webp`, (s) => s.webp({ quality: 80 })],
    [`public/images/arena-ground/${pack}.png`, `public/images/arena-ground/${pack}.webp`, (s) => s.webp({ quality: 80 })],
  ]),
  ['public/og-image.png', 'public/og-image.jpg', (s) => s.jpeg({ quality: 82, mozjpeg: true })],
];

const mb = (n) => (n / 1048576).toFixed(2);
let before = 0, after = 0;

for (const [src, dst, tf] of jobs) {
  if (!existsSync(src)) {
    if (existsSync(dst)) { console.log(`[compress] ya hecho: ${dst}`); continue; }
    console.error(`[compress] FALTA ${src}`); process.exitCode = 1; continue;
  }
  const srcSize = (await stat(src)).size;
  await tf(sharp(src)).toFile(dst);
  const dstSize = (await stat(dst)).size;
  before += srcSize; after += dstSize;
  // Master → _raw/ junto al original (git lo conserva; dist lo excluye).
  const rawDir = join(dirname(src), '_raw');
  await mkdir(rawDir, { recursive: true });
  await rename(src, join(rawDir, basename(src)));
  console.log(`[compress] ${src} ${mb(srcSize)} MB → ${dst} ${mb(dstSize)} MB`);
}

// Favicon: PNG sigue siendo PNG (compat), pero 192px + palette.
const fav = 'public/favicon-br.png';
if (existsSync(fav)) {
  const srcSize = (await stat(fav)).size;
  if (srcSize > 100 * 1024) {
    const tmp = 'public/favicon-br.tmp.png';
    await sharp(fav).resize(192, 192, { fit: 'inside' }).png({ palette: true, compressionLevel: 9 }).toFile(tmp);
    const rawDir = 'public/_raw';
    await mkdir(rawDir, { recursive: true });
    await rename(fav, join(rawDir, 'favicon-br.png'));
    await rename(tmp, fav);
    const dstSize = (await stat(fav)).size;
    before += srcSize; after += dstSize;
    console.log(`[compress] ${fav} ${mb(srcSize)} MB → ${mb(dstSize)} MB (192px palette)`);
  } else {
    console.log('[compress] favicon ya compacto');
  }
}

console.log(`[compress] TOTAL: ${mb(before)} MB → ${mb(after)} MB (−${mb(before - after)} MB)`);
