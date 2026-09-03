import { test, expect } from '@playwright/test';
import { gotoApp, puzzleIds } from './helpers.js';

/**
 * The path carries chapters; a chapter carries its levels.
 *
 * Five hundred tiles on a meander is not a journey, it is a scroll bar with
 * pictures on it. So the path is seventeen chapter tiles — a length a thumb
 * can actually walk — and the thirty levels of one are a grid you take in at a
 * glance. These check the two screens hand over to each other properly, which
 * is the part no unit test can see.
 */
const GAMES = ['thread', 'zigzag', 'nine', 'shape', 'hex', 'isolate'];

test.describe('the path and its chapters', () => {
  for (const game of GAMES) {
    test(`${game} shows chapters on the path and levels inside one`, async ({ page }) => {
      await gotoApp(page);
      const total = (await puzzleIds(page, game)).length;
      await page.goto(`/#/g/${game}`);
      await page.waitForSelector('.pathsvg');

      const chapters = await page.evaluate((g) => window.__puzzles.chapters(g), game);
      /* One tile per chapter and not one per puzzle — the whole point. */
      await expect(page.locator('.ptiles-over .ptile')).toHaveCount(chapters.length);
      /* And the ruled bands the path used to carry are gone with them. */
      await expect(page.locator('.pband')).toHaveCount(0);
      expect(chapters.reduce((n, c) => n + c.length, 0)).toBe(total);

      /* Every chapter but the last is thirty long. */
      for (let i = 0; i < chapters.length - 1; i++) {
        expect(chapters[i].length, `${game} chapter ${i + 1}`).toBe(30);
      }

      await page.locator('.ptiles-over .ptile').first().click();
      await page.waitForSelector('.levelgrid');
      expect(page.url()).toContain(`/#/g/${game}/c/1`);
      await expect(page.locator('.level')).toHaveCount(chapters[0].length);

      /* A level opens its board, and Back comes here rather than to the path. */
      await page.locator('.level').nth(2).click();
      await page.waitForSelector('.stage svg');
      expect(page.url()).toContain(`/#/g/${game}/${chapters[0][2]}`);
      await page.locator('.gamebar .icon').first().click();
      await page.waitForSelector('.levelgrid');
      expect(page.url()).toContain(`/#/g/${game}/c/1`);
    });
  }
});

test('a level tile says its band by more than its colour', async ({ page }) => {
  /*
   * Colour is never the only carrier here. Every tile has its number on it and
   * its band in the name a screen reader reads, so the grid is usable by
   * somebody who cannot tell the four rungs apart at all.
   */
  await gotoApp(page);
  await page.goto('/#/g/shape/c/9');
  await page.waitForSelector('.levelgrid');
  const labels = await page.locator('.level').evaluateAll(
    (els) => els.map((e) => e.getAttribute('aria-label') ?? ''),
  );
  expect(labels).toHaveLength(30);
  for (const [i, label] of labels.entries()) {
    expect(label).toMatch(new RegExp(`^Level ${i + 1}, (Gentle|Steady|Tricky|Severe)`));
  }
  /* The tiles carry more than one rung between them, or the grid is saying
     nothing — the boards inside a chapter are sorted by measured score. */
  const rungs = await page.locator('.level').evaluateAll(
    (els) => new Set(els.map((e) => [...e.classList].find((c) => /^b[1-4]$/.test(c)))).size,
  );
  expect(rungs).toBeGreaterThan(1);
});

test('an unknown chapter lands somewhere real', async ({ page }) => {
  await gotoApp(page);
  await page.goto('/#/g/shape/c/99');
  await page.waitForSelector('.pathsvg');
  expect(page.url()).toMatch(/#\/g\/shape$/);
});
