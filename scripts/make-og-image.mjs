#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Generate public/og-image.png (1200×628) from a higher-resolution source
// ---------------------------------------------------------------------------
//
// Usage:
//   node scripts/make-og-image.mjs <source-image>
//   node scripts/make-og-image.mjs C:/Users/rafa_/Downloads/og-source.png
//   npm run og -- C:/Users/rafa_/Downloads/og-source.png
//
// Flags:
//   --out <path>    override output path (default public/og-image.png)
//   --fit <mode>    sharp fit mode (cover|contain|inside|outside|fill)
//                   defaults to "cover" (centre crop to 1200×628 ratio)
//
// Produces:
//   - 1200×628 PNG, under the 5 MB limit specified by the X/Twitter card
//     validator.
//   - If --fit=cover (default) the source is centre-cropped to the 1.91:1
//     ratio, preserving resolution. Good for hero images that already
//     centre their action in the middle third.
//   - Output is compressed with sharp's default PNG pipeline (lossless).
//
// This script has no dependency on the game runtime. Sharp is a dev-only
// dependency (already in package.json). Fails loudly with a usable error
// if the source doesn't exist or has unsupported dimensions.
// ---------------------------------------------------------------------------

import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';

const TARGET_WIDTH = 1200;
const TARGET_HEIGHT = 628;
const DEFAULT_OUT = resolve('public/og-image.png');

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  usage();
  process.exit(argv.length === 0 ? 1 : 0);
}

const src = argv[0];
let out = DEFAULT_OUT;
let fit = 'cover';
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out' && argv[i + 1]) { out = resolve(argv[++i]); }
  else if (a === '--fit' && argv[i + 1]) { fit = argv[++i]; }
  else { console.error(`Unknown flag: ${a}`); usage(); process.exit(1); }
}

async function main() {
  // Sanity check the source exists before firing sharp — gives a friendlier
  // error than sharp's "Input file is missing" under the hood.
  const info = await stat(src).catch(() => null);
  if (!info || !info.isFile()) {
    console.error(`Source not found: ${src}`);
    process.exit(1);
  }

  const srcSizeMB = (info.size / 1024 / 1024).toFixed(1);
  const srcMeta = await sharp(src).metadata();

  console.log(`\n  OG image generator`);
  console.log(`  Source : ${src}`);
  console.log(`           ${srcMeta.width}×${srcMeta.height} · ${srcMeta.format} · ${srcSizeMB} MB`);
  console.log(`  Target : ${out}`);
  console.log(`  Size   : ${TARGET_WIDTH}×${TARGET_HEIGHT} (ratio 1.91:1)`);
  console.log(`  Fit    : ${fit}\n`);

  await sharp(src)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, {
      fit,
      position: 'centre',
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9 })
    .toFile(out);

  const outInfo = await stat(out);
  const outMB = (outInfo.size / 1024 / 1024).toFixed(2);
  const underLimit = outInfo.size < 5 * 1024 * 1024;
  console.log(`  ✓ Wrote ${TARGET_WIDTH}×${TARGET_HEIGHT} PNG · ${outMB} MB`);
  console.log(`  ${underLimit ? '✓' : '⚠'} ${underLimit ? 'Under' : 'OVER'} the 5 MB X/Twitter card limit.\n`);
  if (!underLimit) {
    console.log(`  Tip: pass a smaller source, or switch to --fit=contain.`);
    process.exit(1);
  }
  console.log(`  Next: rebuild + redeploy. X caches cards up to 7 days —`);
  console.log(`        if you swap the image later, append ?v=2 to og:image URLs.`);
}

function usage() {
  console.log(`
Usage: node scripts/make-og-image.mjs <source-image> [flags]

Flags:
  --out <path>    override output (default public/og-image.png)
  --fit <mode>    cover|contain|inside|outside|fill (default cover)

Generates a 1200×628 PNG suitable for og:image / twitter:image.
`.trim());
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
