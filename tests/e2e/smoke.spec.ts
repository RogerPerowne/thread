import { test, expect } from '@playwright/test';
import { gotoApp, openLevel, solveByTapping, isSolved } from './helpers.js';

test('the home screen shows the wordmark, continue card, daily and modes', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.wordmark')).toHaveText('THREAD');
  await expect(page.locator('.continue')).toBeVisible();
  await expect(page.locator('.strip')).toContainText('Daily Thread');
  await expect(page.locator('.modecard').first()).toBeVisible();
  await expect(page.locator('.tabbar .tab')).toHaveCount(4);
});

test('the ambient header animates without rebuilding itself', async ({ page }) => {
  await gotoApp(page);
  const path = page.locator('.hero-board path');
  const a = await path.getAttribute('d');
  await page.waitForTimeout(700);
  const b = await path.getAttribute('d');
  expect(a).not.toBe(b);
});

test('locked modes state their unlock condition plainly', async ({ page }) => {
  await gotoApp(page);
  const locked = page.locator('.modecard.locked').first();
  await expect(locked).toBeVisible();
  await expect(locked.locator('.lockline')).toContainText(/Solve|Perfect|Finish/);
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
  await page.waitForFunction(() => Boolean(
    (window as never as { __thread?: { current?: unknown } }).__thread?.current));
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
