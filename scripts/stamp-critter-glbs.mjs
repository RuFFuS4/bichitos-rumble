#!/usr/bin/env node
// ---------------------------------------------------------------------------
// stamp-critter-glbs — cache-busting version on every critter GLB URL
// ---------------------------------------------------------------------------
//
// vercel.json serves /models/ with max-age=86400 + stale-while-revalidate
// (a week), unversioned, while the JS in /assets is hashed and immutable.
// So the day a GLB changes together with code that depends on it (its Run
// clip and RUN_GAIT, a renamed clip…), a returning player can get the new
// JS with the OLD GLB from cache — e.g. the old Kowalski Run played at the
// new stride skates ×3. Putting the file's content hash in the URL
// (`./models/critters/<id>.glb?v=<hash8>`) makes JS and GLB travel
// together: the URL only changes when the bytes do.
//
// Usage:
//   node scripts/stamp-critter-glbs.mjs          # rewrite the ?v= in src/roster.ts
//   node scripts/stamp-critter-glbs.mjs --check  # exit 1 if any ?v= is stale
//
// scripts/critter-recipe.mjs runs it after writing a GLB; after any other
// edit of public/models/critters/*.glb, run it by hand.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROSTER = resolve(ROOT, 'src/roster.ts');
const check = process.argv.includes('--check');

const hashOf = (id) =>
  createHash('sha256').update(readFileSync(resolve(ROOT, 'public/models/critters', `${id}.glb`))).digest('hex').slice(0, 8);

const src = readFileSync(ROSTER, 'utf8');
const stale = [];
const next = src.replace(
  /glbPath: '\.\/models\/critters\/([\w-]+)\.glb(?:\?v=([0-9a-f]+))?'/g,
  (_, id, current) => {
    const hash = hashOf(id);
    if (current !== hash) stale.push(`${id} (${current ?? 'sin versión'} → ${hash})`);
    return `glbPath: './models/critters/${id}.glb?v=${hash}'`;
  },
);

if (check) {
  if (stale.length) {
    console.error(`Versión de GLB desfasada en src/roster.ts: ${stale.join(', ')}\n→ node scripts/stamp-critter-glbs.mjs`);
    process.exit(1);
  }
  console.log('Versiones de GLB al día.');
} else if (stale.length) {
  writeFileSync(ROSTER, next);
  console.log(`src/roster.ts: ${stale.join(', ')}`);
} else {
  console.log('Nada que cambiar.');
}
