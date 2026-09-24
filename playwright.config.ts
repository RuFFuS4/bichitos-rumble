import { defineConfig, devices } from '@playwright/test';

// Minimal Playwright config for the Bichitos Rumble smoke test. Uses the
// local Vite dev server (reuses an existing one if something is already
// listening on 5173). Chromium only — we just want to catch "the game
// doesn't even load" regressions; cross-browser compatibility is out of
// scope for the jam.
//
// First-time run inside a fresh checkout:
//   npm install
//   npx playwright install chromium   # ~120 MB, one-off per machine
//   npm run test:smoke
export default defineConfig({
  testDir: './tests',
  // Only *.spec.ts belongs to Playwright. Without this, the default
  // testMatch (*.@(spec|test).ts) would also swallow the Vitest sim
  // suite under tests/sim/**/*.test.ts (H4) and test:smoke would break.
  testMatch: '**/*.spec.ts',
  fullyParallel: false,  // only one test file, no need to parallelize
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    headless: true,
    // Toda instancia de pruebas nace MUDA (directiva de Rafa 2026-09-07):
    // una tanda abre muchas a la vez y cada una arrancaba su música.
    // Ver scripts/lib/headless-browser.mjs para los scripts que no pasan
    // por esta config (capturas, batch runner, campañas ad-hoc).
    launchOptions: { args: ['--mute-audio'] },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
