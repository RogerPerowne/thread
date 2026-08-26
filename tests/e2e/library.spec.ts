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

test('a card opens today\'s puzzle, and back returns to the path', async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-card]').first().click();
  await expect(page).toHaveURL(/#\/g\/[a-z-]+\/[a-z0-9-]+$/);
  await expect(page.locator('.gamebar .title')).toBeVisible();

  await page.locator('.gamebar .icon').first().click();
  await expect(page).toHaveURL(/#\/g\/[a-z-]+$/);
  await expect(page.locator('.ptile').first()).toBeVisible();

  await page.locator('.gamebar .icon').first().click();
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
});

test('the path carries a game\'s whole ladder, chapter by chapter', async ({ page }) => {
  await gotoApp(page);
  const games = await page.evaluate(() => window.__puzzles.games());
  for (const g of games) {
    await page.goto(`/#/g/${g}`);
    const ids = await page.evaluate((id) => window.__puzzles.puzzles(id), g);
    // Every puzzle is on the path exactly once, and in ladder order.
    await expect(page.locator('.ptile')).toHaveCount(ids.length);
    const onPath = await page.evaluate(
      () => [...document.querySelectorAll('.ptile')].map((t) => t.getAttribute('data-puzzle')),
    );
    // The path climbs, and it is drawn from its foot upward, so the order it
    // is written in is the ladder's own order.
    expect(onPath).toEqual([...ids]);

    /*
     * One band per chapter, and the rail has one mark for each — the rail is a
     * map of the path, so a mark with no band is a jump to nowhere.
     */
    const bands = await page.locator('.pband').count();
    expect(bands).toBeGreaterThan(0);
    await expect(page.locator('.chaprail .mark')).toHaveCount(bands);
  }
});

test('the path opens where the player is, and does not run past its own end', async ({ page }) => {
  await gotoApp(page, '#/g/thread');
  const box = await page.evaluate(() => {
    const scroll = document.querySelector('.pathscroll') as HTMLElement;
    const svg = document.querySelector('.pathsvg') as SVGSVGElement;
    return {
      top: scroll.scrollTop,
      height: scroll.scrollHeight,
      client: scroll.clientHeight,
      drawn: svg.getBoundingClientRect().height,
    };
  });
  /*
   * There is exactly as much to scroll as there is drawing. The ribbon runs
   * past the first tile and fades out inside that drawing, so the bottom of
   * the scroll is the end of the path and never a strip of nothing.
   */
  expect(Math.abs(box.height - box.drawn)).toBeLessThan(2);
  expect(box.height).toBeGreaterThan(box.client);
});

test('the rail swaps chapters', async ({ page }) => {
  await gotoApp(page, '#/g/thread');
  const rail = page.locator('.chaprail');
  const at = () => page.evaluate(() => (document.querySelector('.pathscroll') as HTMLElement).scrollTop);
  const before = await at();
  /*
   * A fresh player is at the foot of the path, which is the BOTTOM of a
   * drawing that climbs — so the top of the rail is the last chapter, and
   * jumping to it scrolls up rather than down.
   */
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.up();
  expect(await at()).toBeLessThan(before);
  await expect(page.locator('.chaprail .mark.on')).toHaveCount(1);

  // And back down again: the rail goes both ways.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95);
  await page.mouse.down();
  await page.mouse.up();
  expect(await at()).toBeGreaterThan(0);
});

test('an unknown route lands somewhere real rather than on nothing', async ({ page }) => {
  await gotoApp(page, '#/g/nosuchgame/nosuchpuzzle');
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
});
