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
    open: true,
  },
  build: {
    outDir: '../../public/animations',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'src/index.html'),
        create:   resolve(__dirname, 'src/create.html'),
        retarget: resolve(__dirname, 'src/retarget/index.html'),
      },
    },
  },
  plugins: [glsl()],
});
