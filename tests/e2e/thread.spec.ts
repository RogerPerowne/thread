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
  await openPuzzle(page, 'thread', ids[70]);
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
  const path = board.solution[0];

  // One pointer move per post, no interpolation — which is what a quick finger
  // looks like, and what used to lose the posts in between.
  const first = at(board.posts[path[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of path.slice(1)) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();
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
    () => (window.__puzzles.board() as { pieces(): { posts: number[] }[] }).pieces()[0].posts.length,
  );
  expect(laid).toBe(8);

  // Straight back to the third post, skipping four. Reversing over every post
  // in turn is precision a thumb on a moving board cannot deliver.
  const back = at(board.posts[path[2]]);
  await page.mouse.move(back.x, back.y, { steps: 3 });
  const recoiling = await page.locator('.recoil.go').count();
  await page.mouse.up();
  const after = await page.evaluate(
    () => (window.__puzzles.board() as { pieces(): { posts: number[] }[] }).pieces()[0].posts.length,
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
  for (const p of board.solution[0]) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.mouse.up();
  }
  expect(await isSolved(page), 'tapping the answer post by post did not solve it').toBe(true);
});

test('the board never draws outside its own surface', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'thread');
  for (const id of [ids[50], ids[60], ids[150]]) {
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
    () => ((window.__puzzles.board() as { pieces(): { posts: number[] }[] }).pieces()[0]?.posts.length ?? 0),
  );
  expect(await posts()).toBe(4);
  await control(page, 'Undo').click();
  expect(await posts()).toBe(0);
  await control(page, 'Redo').click();
  expect(await posts()).toBe(4);
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
    () => ((window.__puzzles.board() as { pieces(): { posts: number[] }[] }).pieces()[0]?.posts.length ?? 0),
  );
  expect(back, 'the board did not come back as it was left').toBe(5);
});
