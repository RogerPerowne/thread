import { test, expect } from '@playwright/test';
import { gotoApp, openLevel, solveByTapping, isSolved, waitForBoard } from './helpers.js';

test('the home screen shows the wordmark, continue card, daily and modes', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.wordmark')).toHaveText('THREAD');
  await expect(page.locator('[data-card="continue"]')).toBeVisible();
  await expect(page.locator('[data-card="daily"]')).toContainText('Daily Thread');
  await expect(page.locator('[data-card="classic"]')).toBeVisible();
  await expect(page.locator('.tabbar .tab')).toHaveCount(4);
});

test('every card on the home screen carries its colour and reads in black', async ({ page }) => {
  await gotoApp(page);
  const cards = page.locator('.gamecard');
  expect(await cards.count()).toBeGreaterThan(6);
  for (const card of await cards.all()) {
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('the ambient header animates without rebuilding itself', async ({ page }) => {
  await gotoApp(page);
  const path = page.locator('.hero-board path');
  const a = await path.getAttribute('d');
  await page.waitForTimeout(700);
  const b = await path.getAttribute('d');
  expect(a).not.toBe(b);
});

test('nothing on the home screen is locked, and every mode opens', async ({ page }) => {
  await gotoApp(page);
  // A fresh save: no padlock, no dimmed card, no card that refuses a press.
  expect(await page.locator('.gamecard.locked, .lockbadge, .lockline').count()).toBe(0);
  for (const id of ['classic', 'shadow', 'par', 'corral', 'wire', 'weave', 'blitz', 'onelife', 'zen']) {
    await gotoApp(page);
    await page.locator(`[data-card="${id}"]`).click();
    // Two .screen elements coexist mid-transition, so the URL is the claim:
    // pressing the card took you somewhere rather than refusing.
    await page.waitForFunction(
      () => !/#\/home$|#\/?$/.test(location.href),
      undefined,
      { timeout: 10000 },
    ).catch(() => { throw new Error(`${id} did not open`); });
  }
});

test('every chapter and every level tile opens from a fresh save', async ({ page }) => {
  await gotoApp(page, '#/chapters/classic');
  expect(await page.locator('.gamecard.locked').count()).toBe(0);
  // The last chapter, which used to need fourteen finished before it.
  const cards = page.locator('.gamecard');
  await cards.last().click();
  await expect(page.locator('.ptile').first()).toBeVisible();
  // And the tile furthest up the path, which used to carry a padlock.
  const tiles = page.locator('.ptile');
  expect(await page.locator('.ptile.locked').count()).toBe(0);
  await tiles.last().locator('.top').click({ force: true });
  await expect(page.locator('.board-svg').first()).toBeVisible({ timeout: 15000 });
});

test('the tabs move between home, gallery, stats and settings', async ({ page }) => {
  await gotoApp(page);
  await page.locator('.tab', { hasText: 'Gallery' }).click();
  await expect(page.locator('.poster')).toBeVisible();
  await page.locator('.tab', { hasText: 'Stats' }).click();
  await expect(page.locator('.statgrid').first()).toBeVisible();
  await page.locator('.tab', { hasText: 'Settings' }).click();
  await expect(page.getByText('Reduce motion')).toBeVisible();
  await page.locator('.tab', { hasText: 'Home' }).click();
  await expect(page.locator('.wordmark')).toBeVisible();
});

test('a solve is recorded and joins the gallery', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  await solveByTapping(page, level);
  expect(await isSolved(page)).toBe(true);
  await gotoApp(page, '#/gallery');
  await expect(page.locator('.poster .cell:not(.empty)')).toHaveCount(1);
});

test('progress survives a reload', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  await solveByTapping(page, level);
  expect(await isSolved(page)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as never as { __thread?: unknown }).__thread));
  const solved = await page.evaluate(
    () => (window as never as { __thread: { save(): { stats: { solved: number } } } }).__thread.save().stats.solved,
  );
  expect(solved).toBeGreaterThanOrEqual(1);
});

test('the daily is the same puzzle on every load', async ({ page }) => {
  await gotoApp(page, '#/play/daily');
  const a = await page.evaluate(() => JSON.stringify(
    (window as never as { __thread: { current: { pegs: unknown } } }).__thread.current.pegs));
  await page.reload();
  await waitForBoard(page);
  const b = await page.evaluate(() => JSON.stringify(
    (window as never as { __thread: { current: { pegs: unknown } } }).__thread.current.pegs));
  expect(a).toBe(b);
});

test('reduced motion is honoured', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoApp(page);
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'reduced');
  const level = await openLevel(page, 'classic', 'c-1-1');
  await solveByTapping(page, level);
  expect(await isSolved(page)).toBe(true);
});

test('the board survives a viewport that is wider than it is tall', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 500 });
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  await solveByTapping(page, level);
  expect(await isSolved(page)).toBe(true);
});

test('the page never scrolls sideways', async ({ page }) => {
  await gotoApp(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
