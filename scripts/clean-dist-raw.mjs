#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scripts/clean-dist-raw.mjs — post-build cleanup
// ---------------------------------------------------------------------------
//
// Vite's static asset handling copies EVERYTHING under `public/` into the
// build output verbatim. We keep raw, pre-optimisation source assets
// (belt GLBs straight from the IA generator at ~100 MB each, arena prop
// raw GLBs, raw image masters) inside `public/<kind>/_raw/` because
// `optimize-*.mjs` scripts read from there and write the shipping
// versions next to them. Without this script, every `_raw/` directory
// gets bundled into `dist/` and shipped to the CDN — measured at
// 2.4 GB of dead weight on prod (1.2 GB belts raw + 1.2 GB arenas raw
// + 40 MB images raw at the time of writing).
//
// What this does:
//   - Recursively walks `dist/`.
//   - Removes any directory literally named `_raw`.
//   - Reports total bytes freed at the end.
//
// What it does NOT do:
//   - Touch `public/` (the raw masters stay where the scripts expect).
//   - Touch anything outside `dist/`.
//   - Make any decisions about which files SHOULD ship — only the
//     `_raw` directory convention triggers a delete.
//
// Wired in `package.json` as a `postbuild` hook so it runs after every
// `npm run build` (the same flow Vercel uses).
// ---------------------------------------------------------------------------

import { rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const TARGET_NAME = '_raw';

if (!existsSync(DIST)) {
  console.log(`[clean-dist-raw] no ${DIST}/ directory — nothing to do`);
  process.exit(0);
}

async function dirSize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const p = stack.pop();
    const st = await stat(p);
    if (st.isDirectory()) {
      const entries = await readdir(p);
      for (const e of entries) stack.push(join(p, e));
    } else {
      total += st.size;
    }
  }
  return total;
}

async function findRawDirs(root) {
  const found = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    let entries;
    try {
      entries = await readdir(p, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const child = join(p, e.name);
      if (e.name === TARGET_NAME) {
        found.push(child);
        // Don't descend into a found `_raw` — we'll wipe the whole tree.
        continue;
      }
      stack.push(child);
    }
  }
  return found;
}

const targets = await findRawDirs(DIST);
if (targets.length === 0) {
  console.log(`[clean-dist-raw] no ${TARGET_NAME}/ directories under ${DIST}/`);
  process.exit(0);
}

let freedBytes = 0;
for (const t of targets) {
  const size = await dirSize(t).catch(() => 0);
  freedBytes += size;
  await rm(t, { recursive: true, force: true });
  const mb = (size / (1024 * 1024)).toFixed(1);
  console.log(`[clean-dist-raw] removed ${t} (${mb} MB)`);
}
const totalMb = (freedBytes / (1024 * 1024)).toFixed(1);
console.log(`[clean-dist-raw] total freed: ${totalMb} MB`);
