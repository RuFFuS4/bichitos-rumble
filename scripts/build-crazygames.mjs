#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-crazygames — the CrazyGames build (H5, docs/H5_CRAZYGAMES.md)
// ---------------------------------------------------------------------------
//
//   node scripts/build-crazygames.mjs      (or npm run build:crazygames)
//
// tsc, then `vite build --mode crazygames` into .tmp/crazygames/dist (never
// dist/, which is the own site's), then clean-dist-raw and the payload
// budget with --crazygames: no root-absolute URLs (404 under CG's subpath),
// no online server, no Sentry, at most 1500 files.
//
// .env.crazygames declares VITE_SERVER_URL and VITE_SENTRY_DSN empty, but a
// variable already set in the shell would win over it, so they are dropped
// from the environment here. The zip for CG's upload comes with F1.
// ---------------------------------------------------------------------------

import { execSync } from 'node:child_process';

const OUT = '.tmp/crazygames/dist';
const env = { ...process.env };
delete env.VITE_SERVER_URL;
delete env.VITE_SENTRY_DSN;

const run = (cmd) => {
  console.log(`[build-crazygames] ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env });
};

try {
  run('npx tsc --noEmit');
  run(`npx vite build --mode crazygames --outDir ${OUT} --emptyOutDir`);
  run(`node scripts/clean-dist-raw.mjs ${OUT}`);
  run(`node scripts/check-payload-budget.mjs ${OUT} --crazygames`);
} catch {
  console.error(`[build-crazygames] FAIL (the build, if any, stays in ${OUT} to inspect)`);
  process.exit(1);
}
console.log(`[build-crazygames] OK → ${OUT}`);
