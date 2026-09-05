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

  /* Back from a board goes to the chapter it is in, and back again to the
     path — the way the player came, one step at a time. */
  await page.locator('.gamebar .icon').first().click();
  await expect(page).toHaveURL(/#\/g\/[a-z-]+\/c\/\d+$/);
  await expect(page.locator('.levelgrid')).toBeVisible();

  await page.locator('.gamebar .icon').first().click();
  await expect(page).toHaveURL(/#\/g\/[a-z-]+$/);
  await expect(page.locator('.ptiles-over .ptile').first()).toBeVisible();

  await page.locator('.gamebar .icon').first().click();
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
});

test('the path carries a game\'s chapters, one tile each', async ({ page }) => {
  await gotoApp(page);
  const games = await page.evaluate(() => window.__puzzles.games());
  for (const g of games) {
    await page.goto(`/#/g/${g}`);
    await page.waitForSelector('.pathsvg');
    const chapters = await page.evaluate((id) => window.__puzzles.chapters(id), g);

    /*
     * One tile per CHAPTER, not one per puzzle. Five hundred tiles on a
     * meander is a scroll bar with pictures on it; seventeen is a path.
     */
    await expect(page.locator('.ptiles-over .ptile')).toHaveCount(chapters.length);
    const onPath = await page.evaluate(
      () => [...document.querySelectorAll('.ptiles-over .ptile')]
        .map((t) => Number(t.getAttribute('data-chapter'))),
    );
    // The path climbs, and it is drawn from its foot upward, so the order it
    // is written in is the ladder's own order.
    expect(onPath).toEqual(chapters.map((_, i) => i));

    /*
     * The rail has one mark per chapter — it is a map of the path, so a mark
     * with nothing to jump to is a jump to nowhere.
     */
    await expect(page.locator('.chaprail .mark')).toHaveCount(chapters.length);
    /* And the ruled bands are gone: a chapter that IS a tile does not also
       need a heading announcing it. */
    await expect(page.locator('.pband')).toHaveCount(0);
  }
});

test('the path runs off the top of the screen, and comes out of a cave at the foot', async ({ page }) => {
  /*
   * At the top the ribbon never ends on screen: it is drawn well past the last
   * chapter and the scroll stops early, so at the limit the drawing is still
   * crossing the edge of the view — cut by the edge of the phone rather than
   * by anything of ours. At the foot it ends on a picture instead: the road
   * comes out of a cave, and scrolled all the way down the cave's mouth is in
   * view, whole, with its rim inside the box. Measured at both limits,
   * because "it looks fine on mine" is exactly the claim that was wrong the
   * first time.
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
  const mouth = await page.evaluate(() => {
    const scroll = document.querySelector('.pathscroll') as HTMLElement;
    const m = document.querySelector('.cave .face.dark') as SVGPathElement;
    const s = scroll.getBoundingClientRect();
    const d = m.getBoundingClientRect();
    return { top: d.top, bottom: d.bottom, viewTop: s.top, viewBottom: s.bottom, height: d.height };
  });
  expect(mouth.height, 'the cave has no mouth').toBeGreaterThan(8);
  expect(mouth.top, 'the cave mouth is above the view').toBeGreaterThan(mouth.viewTop);
  expect(mouth.bottom, 'the cave mouth is cut off by the foot of the view').toBeLessThan(mouth.viewBottom);

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

test('the rail names the chapter you are actually looking at', async ({ page }) => {
  /*
   * At either limit of the scroll the view is clamped, so a chapter's band
   * cannot sit where a jump would have put it — and a reading line taken from
   * where the band WOULD have been ends up on the wrong side of it and names
   * the chapter you have just left. Both ends are checked, because that is
   * where the two lines come apart.
   */
  await gotoApp(page, '#/g/thread');
  const chapters = await page.locator('.chaprail .mark').count();
  const named = async (): Promise<number> => {
    const t = await page.locator('.chaprail').getAttribute('aria-valuenow');
    return Number(t);
  };
  const scrollTo = async (where: 'top' | 'bottom') => {
    await page.evaluate((w) => {
      const s = document.querySelector('.pathscroll') as HTMLElement;
      s.scrollTop = w === 'top' ? 0 : s.scrollHeight;
    }, where);
    await page.waitForTimeout(120);
  };

  // The path climbs, so its top is the last chapter and its foot is the first.
  await scrollTo('top');
  expect(await named()).toBe(chapters);
  await scrollTo('bottom');
  expect(await named()).toBe(1);
});

test('an unknown route lands somewhere real rather than on nothing', async ({ page }) => {
  await gotoApp(page, '#/g/nosuchgame/nosuchpuzzle');
  await expect(page.locator('.masthead .wordmark')).toBeVisible();
});

test('every game answers the Hint button, and escalates rather than telling', async ({ page }) => {
  /*
   * The one part of a puzzle that can lie without anybody noticing: nothing
   * checks a hint, and a player who follows a wrong one blames themselves.
   * What is checked here is the shell's half of the contract — that every game
   * has something to say, that it lights something up before it says it, and
   * that pressing again says more rather than repeating.
   */
  await gotoApp(page);
  const games = await page.evaluate(() => window.__puzzles.games());
  expect(games.length).toBeGreaterThan(4);

  for (const game of games) {
    const id = (await page.evaluate((g) => window.__puzzles.puzzles(g), game))[0];
    await page.goto(`/#/g/${game}/${id}`);
    await page.waitForSelector('.stage svg');

    const hint = page.locator('.controls .btn', { hasText: 'Hint' });
    await hint.click();
    const first = await page.locator('.note').textContent();
    expect(first, `${game} said nothing`).toBeTruthy();
    expect(
      await page.locator('.lookhere').count(),
      `${game} lit nothing up`,
    ).toBeGreaterThan(0);

    await hint.click();
    const second = await page.locator('.note').textContent();
    expect(second, `${game} repeated itself instead of escalating`).not.toBe(first);
    expect(second!.trim().length, `${game} said nothing on the second press`)
      .toBeGreaterThan(12);
  }
});
