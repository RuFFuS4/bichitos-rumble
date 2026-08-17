import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// Short git sha baked into the bundle as the Sentry `release` id, so a
// production error report pins the exact deploy that produced it.
// Fallback 'dev' keeps builds working outside a git checkout (CI
// tarballs, fresh clones without history).
let buildCommit = 'dev';
try {
  buildCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
} catch { /* keep 'dev' */ }

// Five HTML entries: the normal game (index), the internal dev/balance
// tool (tools), the roster calibration lab (calibrate), the animation
// validation + override lab (anim-lab), and the in-arena decoration
// placement editor (decor-editor). All build to /dist; only index.html
// is linked from UI, the others are reachable by deliberately typing
// the URL. Vercel serves static files before
// rewrites, so `/tools.html`, `/calibrate.html` and `/anim-lab.html`
// resolve to the built files even though vercel.json rewrites
// everything else to index.html.
//
// codeSplitting (Vite 8 / Rolldown — antes manualChunks): Three.js +
// Colyseus are the two big libraries and they have very different cache
// lifetimes (Three is rarely updated, Colyseus more often as server
// protocol evolves). Splitting them out lets the browser keep the Three
// chunk cached across deploys that only touch game logic. The gameplay
// code stays in the shared chunk so a HUD tweak doesn't invalidate
// library caches.
export default defineConfig({
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  // H2 slice 4: @colyseus/sdk ahora solo entra por import dinámico, así
  // que el dev server no lo descubre hasta el primer click en Online y
  // dispara una re-optimización de deps CON RELOAD de página a mitad de
  // sesión (rompía el flujo del modal de nickname — cazado por el e2e).
  // Pre-bundlearlo elimina la recarga para dev y para los e2e.
  optimizeDeps: {
    include: ['@colyseus/sdk'],
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // Esbuild minifier is default; this switches to terser so we can
    // strip console.debug + console.log from the production bundle.
    // Ships with Vite, no extra dep. A noticeable perf + privacy win:
    // the engine (Critter / Portal / Badges / …) emits ~40 debug logs
    // per match; in prod those now vanish entirely. console.error and
    // console.warn stay in place so crashes + invariant violations
    // still surface in DevTools.
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_debugger: true,
        pure_funcs: ['console.debug', 'console.log'],
      },
    },
    rolldownOptions: {
      // H2 2026-08-18: production builds ship ONLY the game. The four
      // internal lab entries (tools/calibrate/anim-lab/decor-editor)
      // stay fully usable in dev (`npm run dev` serves them without
      // build inputs) and can be force-included in a build with
      // VITE_BUILD_TOOLS=1 (e.g. for a tooling-only deploy). Rationale:
      // they exposed internal tooling publicly and added weight.
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        ...(process.env.VITE_BUILD_TOOLS === '1' ? {
          tools:       resolve(import.meta.dirname, 'tools.html'),
          calibrate:   resolve(import.meta.dirname, 'calibrate.html'),
          animLab:     resolve(import.meta.dirname, 'anim-lab.html'),
          decorEditor: resolve(import.meta.dirname, 'decor-editor.html'),
        } : {}),
      },
      output: {
        codeSplitting: {
          groups: [
            { name: 'three',    test: /node_modules[\\/]three[\\/]/,       priority: 20 },
            // @colyseus/sdk + @colyseus/schema (client decode) since 0.17.
            { name: 'colyseus', test: /node_modules[\\/]@colyseus[\\/]/, priority: 20 },
          ],
          // Everything else falls through to Rolldown's default
          // automatic splitting (codeSplitting defaults stay on).
        },
      },
    },
  },
});
