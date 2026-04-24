// ---------------------------------------------------------------------------
// Smoke test — game loads + click-through to match start
// ---------------------------------------------------------------------------
//
// This is NOT a comprehensive E2E suite. It's the "does the game still
// boot" canary — catches regressions where a refactor breaks the title
// screen, the character-select flow, or surfaces a console error before
// gameplay even starts. Runs in ~15 seconds on Chromium headless.
//
// Run:
//   npm run test:smoke
//
// First time only (installs the Chromium binary, ~120 MB):
//   npx playwright install chromium
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';

test('title → vs Bots → match starts without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });

  // Title screen
  await page.goto('/');
  await expect(page.locator('#title-screen .game-title')).toContainText('BICHITOS');
  await expect(page.locator('#title-screen .game-title')).toContainText('RUMBLE');
  // Author signature should be visible (post-2026-04-21 polish).
  await expect(page.locator('.title-signature')).toBeVisible();

  // Pick "vs Bots" (preselected) and confirm with ENTER.
  await expect(page.locator('#btn-vs-bots.selected')).toBeVisible();
  await page.keyboard.press('Enter');

  // Character-select should appear.
  await expect(page.locator('#character-select')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#critter-grid .critter-slot.selected')).toBeVisible();

  // Confirm the preselected critter with SPACE.
  await page.keyboard.press('Space');

  // Countdown overlay appears, then the match starts. We don't poll for
  // the "playing" state directly — instead we wait for the ability HUD
  // to render its three slots, which is a solid proxy for "match is up
  // and Critter.update is ticking".
  await expect(page.locator('#ability-bar-container .ability-slot'))
    .toHaveCount(3, { timeout: 15_000 });

  // No errors along the way.
  expect(errors, `Console/page errors surfaced:\n${errors.join('\n')}`).toEqual([]);
});
