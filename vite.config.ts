import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two HTML entries: the normal game (index) and the internal dev/balance
// tool (tools). Both are built to /dist; tools.html is never linked from
// the game UI, so it's only reachable by deliberately typing the URL.
// Vercel serves static files before rewrites, so /tools.html resolves
// to the built file even though vercel.json rewrites everything else to
// index.html.
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
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        tools: resolve(__dirname, 'tools.html'),
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
