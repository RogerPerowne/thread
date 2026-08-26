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

test('the path runs off both edges of the screen and cannot be scrolled to its end', async ({ page }) => {
  /*
   * The ribbon never ends on screen. It is drawn well past both ends of the
   * ladder and the scroll stops early, so at either limit the drawing is still
   * crossing the edge of the view — cut by the edge of the phone rather than
   * by anything of ours. Measured at both limits, because "it looks fine on
   * mine" is exactly the claim that was wrong the first time.
   */
  await gotoApp(page, '#/g/thread');

  const edges = async (): Promise<{ top: number; bottom: number; viewTop: number; viewBottom: number }> =>
    page.evaluate(() => {
      const scroll = document.querySelector('.pathscroll') as HTMLElement;
      const svg = document.querySelector('.pathsvg') as SVGSVGElement;
      const s = scroll.getBoundingClientRect();
      const d = svg.getBoundingClientRect();
      return { top: d.top, bottom: d.bottom, viewTop: s.top, viewBottom: s.bottom };
    });

  await page.evaluate(() => { (document.querySelector('.pathscroll') as HTMLElement).scrollTop = 0; });
  const atTop = await edges();
  expect(atTop.top, 'the drawing stops short of the top of the view').toBeLessThan(atTop.viewTop);

  await page.evaluate(() => {
    const s = document.querySelector('.pathscroll') as HTMLElement;
    s.scrollTop = s.scrollHeight;
  });
  const atBottom = await edges();
  expect(atBottom.bottom, 'the drawing stops short of the bottom of the view')
    .toBeGreaterThan(atBottom.viewBottom);

  // And there is genuinely something to scroll.
  const room = await page.evaluate(() => {
    const s = document.querySelector('.pathscroll') as HTMLElement;
    return s.scrollHeight - s.clientHeight;
  });
  expect(room).toBeGreaterThan(0);
});

test('the path opens where the player is', async ({ page }) => {
  await gotoApp(page, '#/g/thread');
  /*
   * Nothing solved, so the tile you are up to is the first — at the FOOT of a
   * path that climbs. Opening at the top of the drawing would put a fresh
   * player a hundred and ninety levels from anything they can play.
   */
  const where = await page.evaluate(() => {
    const s = document.querySelector('.pathscroll') as HTMLElement;
    return s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight);
  });
  expect(where).toBeGreaterThan(0.9);
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
