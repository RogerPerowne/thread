import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers.js';

/** Put a few levels of chapter 5 away so the path has all three tile states. */
async function seed(page: import('@playwright/test').Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const raw: Record<string, unknown> = { v: 3, levels: {}, stats: { solved: 40 } };
    const levels = raw.levels as Record<string, unknown>;
    for (let i = 1; i <= 6; i++) {
      levels[`c-5-${i}`] = { stars: 3, best: 1, attempts: 1, bestSimilarity: 1 };
    }
    localStorage.setItem('thread.save', JSON.stringify(raw));
  });
  await page.goto('/#/levels/classic/5');
  await page.reload();
  await page.waitForSelector('.pathsvg');
  await page.waitForTimeout(500);
}

test('pressing a tile flies the camera to it and lands on the level', async ({ page }) => {
  await seed(page);

  const face = page.locator('.ptile.next .top');
  const before = await face.boundingBox();
  expect(before).not.toBeNull();

  await page.locator('.ptile.next').click({ force: true });

  // Mid-flight the tile is still on screen — it is the thing being flown to,
  // not something that disappears while a new screen loads.
  await page.waitForTimeout(260);
  const mid = await face.boundingBox();
  expect(mid).not.toBeNull();
  expect(mid!.x + mid!.width).toBeGreaterThan(0);
  expect(mid!.x).toBeLessThan(390);
  expect(mid!.width).toBeGreaterThan(before!.width);

  // The card takes its place, square and centred.
  const card = page.locator('.entercard');
  await expect(card).toBeVisible();
  await page.waitForTimeout(300);
  const cb = (await card.boundingBox())!;
  expect(Math.abs(cb.width - cb.height)).toBeLessThan(3);
  await expect(card).toContainText('Level 7');

  // And it becomes the board.
  await page.waitForSelector('.boardsurface', { timeout: 5000 });
  await page.waitForTimeout(600);
  expect(page.url()).toContain('/play/classic/c-5-7');
  await expect(page.locator('.entercard')).toHaveCount(0);
  const shell = page.locator('.playwrap');
  await expect(shell).toBeVisible();
  expect(await shell.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('reduced motion goes straight to the level', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await seed(page);
  await page.locator('.ptile.next').click({ force: true });
  await page.waitForSelector('.boardsurface', { timeout: 3000 });
  await expect(page.locator('.entercard')).toHaveCount(0);
  await ctx.close();
});

test('leaving the chapter mid-flight does not strand the card', async ({ page }) => {
  await seed(page);
  await page.locator('.ptile.next').click({ force: true });
  await page.waitForTimeout(150);
  await page.goto('/#/home');
  await page.waitForTimeout(400);
  await expect(page.locator('.entercard')).toHaveCount(0);
});
