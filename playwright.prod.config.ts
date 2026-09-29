import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The same smoke suite (tests/*.spec.ts) against the PRODUCTION bundle:
// `vite build` + `vite preview` instead of the dev server. It catches what
// only breaks after minification, tree-shaking or chunk splitting — the
// dev server never runs that code (DISTRIBUCIÓN, carril punto 8).
//
// VITE_SERVER_URL is set on purpose: production only exposes window.__game
// (which the portal tests read) when the build has a server URL
// (src/main.ts). The address is a dead port: the smoke never goes online.
// The bundle goes to .tmp/dist-prod so dist/ never carries that fake URL.
//
//   npm run test:smoke:prod
const PORT = 4174;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite build --outDir .tmp/dist-prod --emptyOutDir && npx vite preview --outDir .tmp/dist-prod --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_SERVER_URL: 'ws://127.0.0.1:9' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
