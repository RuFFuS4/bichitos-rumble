// ---------------------------------------------------------------------------
// Dev server «foto fija» — for long captures while you keep editing
// ---------------------------------------------------------------------------
//
// Same config as the game, but it does NOT watch files and has no HMR: a
// page opened here keeps the code it loaded, so a half-hour batch or
// ability-shots run against this port survives edits to src/ on the normal
// dev server (whose HMR would reload the page and abort the run). It is
// also a free "before" to compare against. Own dependency cache, so the two
// servers never optimise into the same folder.
//
//   npx vite --config scripts/vite.snapshot.config.mjs --port 5182 --strictPort
//
// Restart it to pick up new code.
// ---------------------------------------------------------------------------

import base from '../vite.config.ts';

export default {
  ...base,
  cacheDir: 'node_modules/.vite-snapshot',
  server: { ...(base.server ?? {}), watch: { ignored: ['**/*'] }, hmr: false },
};
