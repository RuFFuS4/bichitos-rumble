import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
// manualChunks: Three.js + Colyseus are the two big libraries and they
// have very different cache lifetimes (Three is rarely updated, Colyseus
// more often as server protocol evolves). Splitting them out lets the
// browser keep the Three chunk cached across deploys that only touch
// game logic, which is what Vite's chunkSizeWarningLimit warning is
// nudging us toward. The gameplay code stays in the shared chunk so a
// HUD tweak doesn't invalidate library caches.
export default defineConfig({
  base: './',
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
    rollupOptions: {
      input: {
        index:       resolve(__dirname, 'index.html'),
        tools:       resolve(__dirname, 'tools.html'),
        calibrate:   resolve(__dirname, 'calibrate.html'),
        animLab:     resolve(__dirname, 'anim-lab.html'),
        decorEditor: resolve(__dirname, 'decor-editor.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/colyseus.js/')) return 'colyseus';
          // Fall through → default chunking for everything else.
          return undefined;
        },
      },
    },
  },
});
