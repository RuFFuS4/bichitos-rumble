// ---------------------------------------------------------------------------
// Copy Bichitos Rumble game assets into mesh2motion's static/ folder
// ---------------------------------------------------------------------------
//
// Runs on `npm install`, `npm run dev` and `npm run build` (via the pre*
// hooks in package.json). Makes the 9 critter GLBs available at
// /animations/models/critters/<id>.glb so BichitosRosterPicker.ts can
// fetch them the same way in both dev (5174) and production.
//
// Overhead: ~few MB duplicated in static/models/critters/ during dev.
// The files are copied on every run (no smart diffing) — 9 small GLBs,
// negligible cost. The static/models/critters/ folder is git-ignored so
// we don't duplicate in the repo.
// ---------------------------------------------------------------------------

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve('../public/models/critters');
const dst = resolve('static/models/critters');

async function main() {
  if (!existsSync(src)) {
    console.warn(`[copy-game-assets] source folder missing, skipping: ${src}`);
    return;
  }

  // Clean the destination first so removed critters don't linger.
  if (existsSync(dst)) {
    await rm(dst, { recursive: true, force: true });
  }
  await mkdir(dst, { recursive: true });
  await cp(src, dst, { recursive: true });
  console.log(`[copy-game-assets] ${src} → ${dst}`);
}

main().catch((err) => {
  console.error('[copy-game-assets] failed:', err);
  process.exit(1);
});
