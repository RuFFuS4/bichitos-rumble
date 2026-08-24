// ---------------------------------------------------------------------------
// Vitest config — sim tests only (H4: "~20 tests Vitest del sim determinista")
// ---------------------------------------------------------------------------
//
// Deliberately does NOT extend vite.config.ts: the sim tests import pure
// logic modules (match-rng, pws-stats, server sim, abilities config) and
// need none of the game's HTML/ToolPatch plugins. Environment is plain
// 'node' — no jsdom, no browser. Playwright smoke lives in tests/*.spec.ts
// (playwright.config.ts testMatch) and never overlaps with this include.
//
// Run: npm run test:sim
// ---------------------------------------------------------------------------

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/sim/**/*.test.ts'],
  },
});
