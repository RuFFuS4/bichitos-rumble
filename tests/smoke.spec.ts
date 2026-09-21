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

import { test, expect, type Page } from '@playwright/test';

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

  // Our own site keeps the Vibe Jam exit portal (the ?portal=0 test below
  // is only meaningful if this one sees it).
  expect(await countPortalRings(page)).toBe(1);
});

// Kill switch of the Vibe Jam portal (src/portal.ts). Outside our own site
// (itch embed, Steam) nobody would notice it coming back, so it lives here.
// `?ref=itch` is what the itch.io wrapper passes to the production build.
for (const query of ['?portal=0', '?ref=itch']) {
  test(`${query} → match without portals or portal legend`, async ({ page }) => {
    await page.goto('/' + query);
    await page.keyboard.press('Enter');
    await expect(page.locator('#character-select')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Space');
    await expect(page.locator('#ability-bar-container .ability-slot'))
      .toHaveCount(3, { timeout: 15_000 });

    await expect(page.locator('body')).toHaveClass(/\bportal-off\b/);
    await expect(page.locator('#portal-legend')).toBeHidden();
    expect(await countPortalRings(page)).toBe(0);
  });
}

/** Portal rings in the scene: the only tori of radius 1.2 / tube 0.12
 *  (ability VFX use tori too). Needs the dev-mode `window.__game`. */
function countPortalRings(page: Page): Promise<number> {
  type Geo = { type: string; parameters?: { radius?: number; tube?: number } };
  type Scene = { traverse(cb: (o: { geometry?: Geo }) => void): void };
  return page.evaluate(() => {
    let n = 0;
    (window as unknown as { __game: { scene: Scene } }).__game.scene.traverse((o) => {
      const g = o.geometry;
      if (g?.type === 'TorusGeometry' && g.parameters?.radius === 1.2 && g.parameters?.tube === 0.12) n++;
    });
    return n;
  });
}
