import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, threadBoard, threadMapper, dragStrand,
  solveThread, isSolved, noteOf, control,
} from './helpers.js';

/*
 * Every shipped board, solved by real drags, in chunks.
 *
 * A hundred and ninety boards in one test is several minutes of pointer events
 * and a failure that tells you nothing about which board broke.
 */
const CHUNK = 20;
for (let from = 0; from < 190; from += CHUNK) {
  test(`thread boards ${from + 1} to ${from + CHUNK} are solvable by dragging`, async ({ page }) => {
    await gotoApp(page);
    const ids = await puzzleIds(page, 'thread');
    for (const id of ids.slice(from, from + CHUNK)) {
      await openPuzzle(page, 'thread', id);
      const board = await threadBoard(page);
      await solveThread(page, board);
      expect(await isSolved(page), `${id} was not solved`).toBe(true);
    }
  });
}

test('an unfinished board is never shown as a broken one', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[40]);
  const board = await threadBoard(page);

  /*
   * Half a string laid, nothing wrong with it. This used to go red and say
   * "each string has to join its own two ends" — true, and true of every board
   * from the moment it opens until the moment it is solved, so the board was
   * red for the whole game and the warning could never be seen to go.
   */
  await dragStrand(page, board, board.solution[0].slice(0, 2));
  await expect(noteOf(page)).not.toHaveClass(/bad/);

  await solveThread(page, board);
  await expect(noteOf(page)).toHaveText('Solved');
});

test('a fast sweep does not skip posts', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[50]);
  const board = await threadBoard(page);
  const at = await threadMapper(page);

  // One pointer move per post, no interpolation — which is what a quick finger
  // looks like, and what used to lose the posts in between.
  for (const path of board.solution) {
    const first = at(board.posts[path[0]]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of path.slice(1)) {
      const q = at(board.posts[p]);
      await page.mouse.move(q.x, q.y);
    }
    await page.mouse.up();
  }
  expect(await isSolved(page), 'a coarse sweep of the answer did not solve it').toBe(true);
});

test('going back several posts takes them off, and shows them going', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[50]);
  const board = await threadBoard(page);
  const at = await threadMapper(page);
  const path = board.solution[0];

  const first = at(board.posts[path[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of path.slice(1, 8)) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y, { steps: 4 });
  }
  const laid = await page.evaluate(
    () => (window.__puzzles.board() as { paths(): number[][] }).paths()[0].length,
  );
  expect(laid).toBe(8);

  // Straight back to the third post, skipping four. Reversing over every post
  // in turn is precision a thumb on a moving board cannot deliver.
  const back = at(board.posts[path[2]]);
  await page.mouse.move(back.x, back.y, { steps: 3 });
  const recoiling = await page.locator('.recoil.go').count();
  await page.mouse.up();
  const after = await page.evaluate(
    () => (window.__puzzles.board() as { paths(): number[][] }).paths()[0].length,
  );
  expect(after).toBe(3);
  expect(recoiling, 'nothing was drawn coming back off').toBeGreaterThan(0);
});

test('a board can be solved by tapping alone', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[19]);
  const board = await threadBoard(page);
  const at = await threadMapper(page);
  for (const strand of board.solution) {
    for (const p of strand) {
      const q = at(board.posts[p]);
      await page.mouse.move(q.x, q.y);
      await page.mouse.down();
      await page.mouse.up();
    }
  }
  expect(await isSolved(page), 'tapping the answer post by post did not solve it').toBe(true);
});

test('the board never draws outside its own surface', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  for (const id of [ids[50], ids[35], ids[55]]) {
    await openPuzzle(page, 'thread', id);
    const bleed = await page.evaluate(() => {
      const svg = document.querySelector('.board-svg') as SVGSVGElement;
      const r = svg.getBoundingClientRect();
      let worst = 0;
      for (const el of svg.querySelectorAll('circle, rect, path')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        worst = Math.max(worst, r.top - b.top, b.bottom - r.bottom,
          r.left - b.left, b.right - r.right);
      }
      return worst;
    });
    expect(bleed, `${id} paints outside its surface`).toBeLessThanOrEqual(0.5);
  }
});

test('undo takes back a gesture, and redo puts it on again', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[19]);
  const board = await threadBoard(page);
  await dragStrand(page, board, board.solution[0].slice(0, 4));

  const posts = () => page.evaluate(
    () => ((window.__puzzles.board() as { paths(): number[][] }).paths()[0]?.length ?? 0),
  );
  /*
   * The row of controls never changes shape. Hiding a control the moment it
   * becomes useful is what moves the other three sideways under a thumb that
   * was already reaching for one of them — so Redo is dimmed, never removed,
   * and the count is the same before a move, after one, and after undoing it.
   */
  const slots = () => page.locator('.controls .btn:visible').count();
  const width = async () => (await control(page, 'Restart').boundingBox())!.x;
  const wasSlots = await slots();
  const wasX = await width();

  expect(await posts()).toBe(4);
  expect(await slots()).toBe(wasSlots);
  await control(page, 'Undo').click();
  expect(await posts()).toBe(0);
  expect(await slots()).toBe(wasSlots);
  expect(await width()).toBe(wasX);
  await control(page, 'Redo').click();
  expect(await posts()).toBe(4);
  expect(await slots()).toBe(wasSlots);
  expect(await width()).toBe(wasX);
});

test('a half-finished board comes back after a reload', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[19]);
  const board = await threadBoard(page);
  await dragStrand(page, board, board.solution[0].slice(0, 5));
  // The frame writes on a short delay, so give it one.
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.board-svg');
  const back = await page.evaluate(
    () => ((window.__puzzles.board() as { paths(): number[][] }).paths()[0]?.length ?? 0),
  );
  expect(back, 'the board did not come back as it was left').toBe(5);
});

test('a strand can be told from its neighbour by colour alone', async ({ page }) => {
  /*
   * There used to be a NUMBER on every pinned end, because twelve inks cannot
   * be told apart: measured as colour difference, the worst pair of that set
   * came to 2.1 under a simulation of common colour blindness — the same ink
   * twice. The palette is six now, chosen for exactly this, and the worst pair
   * is 19 in ordinary vision, deuteranopia and protanopia alike. So the
   * numbers are gone, and this is the check that colour is carrying the job on
   * its own: every string's ends wear its colour, no two strings share one,
   * and there is no numeral anywhere on the board.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');

  for (const id of [ids[0], ids[30], ids[50]]) {
    await openPuzzle(page, 'thread', id);
    const board = await threadBoard(page);

    expect(await page.locator('.board-svg text').count(), 'the board is drawing type').toBe(0);

    const inks = new Set(board.strands.map((s) => s.color));
    expect(inks.size, `${id} uses one colour for two strings`).toBe(board.strands.length);

    /* And the ends are actually wearing it, rather than all being dark dots. */
    const worn = await page.evaluate(
      () => [...document.querySelectorAll('.post.end')]
        .map((el) => (el as SVGElement).style.getPropertyValue('--ink')),
    );
    expect(worn.length).toBe(board.strands.length * 2);
    expect(new Set(worn).size).toBe(board.strands.length);
  }
});

test('finishing a board offers the next one, and you can see it', async ({ page }) => {
  /*
   * The result sheet lives on the body, so it is outside the screen that set
   * `--accent` — and `.btn.accent` painted its background from that property
   * and its text from `--paper`. With the accent missing the primary button
   * was paper on paper: present, focusable, the right size, and invisible.
   * Nothing that measures position or counts elements catches that, so this
   * measures the two colours and demands they differ.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  await openPuzzle(page, 'thread', ids[0]);
  const board = await threadBoard(page);
  await solveThread(page, board);

  const next = page.locator('.sheet .btn', { hasText: 'Next puzzle' });
  await expect(next).toBeVisible();

  const paint = await next.evaluate((el) => {
    const cs = getComputedStyle(el);
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const bg = rgb(cs.backgroundColor);
    const fg = rgb(cs.color);
    const alpha = bg.length > 3 ? bg[3] : 1;
    const a = lum(bg);
    const b = lum(fg);
    return { alpha, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  expect(paint.alpha, 'the primary button has no background at all').toBe(1);
  expect(paint.ratio, 'the primary button is the same colour as its own label')
    .toBeGreaterThan(3);

  // And it goes where it says it goes.
  await next.click();
  await expect(page).toHaveURL(new RegExp(`#/g/thread/${ids[1]}$`));
  await expect(page.locator('.scrim')).toHaveCount(0);
});
