// ---------------------------------------------------------------------------
// Mesh2Motion vite config — adapted for Bichitos Rumble integration
// ---------------------------------------------------------------------------
//
// Changes vs upstream:
//   - `base: '/animations/'` so built assets resolve under the
//     /animations/ path on the deployed site.
//   - `outDir: '../../public/animations'` so the build lands directly
//     inside the parent's `public/` folder. Vite of the main game then
//     copies it into the final `dist/animations/` as part of its normal
//     public → dist pass. Net: the whole animation lab ships at
//     /animations/* when Vercel serves the main dist.
//   - Dropped the Cloudflare-specific `process.env` defines — we don't
//     deploy to Cloudflare Pages in this project.
//   - Dev server uses port 5174 so you can run the game (5173) and the
//     animation tool in parallel.
//   - ONLY `create.html` is a build entry. Upstream ships three entries
//     (Explore/marketing, Create/use-your-model, Retarget/use-your-rigged-
//     model). We only want the second one — it's our single workflow.
//     Dropping Explore also means the Vercel rewrite `/animations →
//     /animations/create.html` actually fires (otherwise Vercel serves
//     the static index.html first and never reaches the rewrite).
// ---------------------------------------------------------------------------

import { resolve } from 'path';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  root: 'src/',
  publicDir: '../static/',
  base: '/animations/',
  server: {
    host: true,
    port: 5174,
    open: '/create.html',
  },
  build: {
    outDir: '../../public/animations',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        create: resolve(__dirname, 'src/create.html'),
      },
    },
  },
  plugins: [glsl()],
});
