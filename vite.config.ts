import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two HTML entries: the normal game (index) and the internal dev/balance
// tool (tools). Both are built to /dist; tools.html is never linked from
// the game UI, so it's only reachable by deliberately typing the URL.
// Vercel serves static files before rewrites, so /tools.html resolves
// to the built file even though vercel.json rewrites everything else to
// index.html.
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
    },
  },
});
