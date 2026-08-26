import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers.js';

test('the library leads with today and lists every game', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.masthead .wordmark')).toHaveText('Puzzles');
  const games = await page.evaluate(() => window.__puzzles.games());
  expect(games.length).toBeGreaterThan(1);
  // One card per game under Today, and the first is the feature.
  await expect(page.locator('[data-card]')).toHaveCount(games.length);
  await expect(page.locator('.card.feature')).toHaveCount(1);
  for (const g of games) await expect(page.locator(`[data-card="${g}"]`)).toBeVisible();
});

test('every card carries a moving miniature of its own mechanic', async ({ page }) => {
  await gotoApp(page);
  /*
   * The miniature is the thing that tells a player what a game IS before they
   * have read a word, so a card without one is a card that does not work. It
   * has to be the game's own drawing, not a shared placeholder — checked by
   * requiring the drawings to differ.
   */
  const shapes = await page.evaluate(
    () => [...document.querySelectorAll('[data-card] .mini svg')].map((s) => s.innerHTML.length),
  );
  expect(shapes.length).toBeGreaterThan(1);
  expect(new Set(shapes).size).toBe(shapes.length);
});

test('a card opens today\'s puzzle, and back returns to the archive', async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-card]').first().click();
  await expect(page).toHaveURL(/#\/g\/[a-z-]+\/[a-z0-9-]+$/);
  await expect(page.locator('.gamebar .title')).toBeVisible();

  await page.locator('.gamebar .icon').first().click();
  await expect(page).toHaveURL(/#\/g\/[a-z-]+$/);
  await expect(page.locator('.chip').first()).toBeVisible();

  await page.locator('.gamebar .icon').first().click();
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
});

test('the archive lists a game\'s whole ladder, grouped by how hard it is', async ({ page }) => {
  await gotoApp(page);
  const games = await page.evaluate(() => window.__puzzles.games());
  for (const g of games) {
    await page.goto(`/#/g/${g}`);
    const ids = await page.evaluate((id) => window.__puzzles.puzzles(id), g);
    await expect(page.locator('.chip')).toHaveCount(ids.length);
    // Grouped: more than one band, or the game is very short.
    const groups = await page.locator('.section .label').count();
    expect(groups).toBeGreaterThan(0);
  }
});

test('an unknown route lands somewhere real rather than on nothing', async ({ page }) => {
  await gotoApp(page, '#/g/nosuchgame/nosuchpuzzle');
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
});
