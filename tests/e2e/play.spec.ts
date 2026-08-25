import { test, expect } from '@playwright/test';
import {
  gotoApp, openBoard, solveByDragging, dragStrand, isSolved, solvedIds, pointMapper,
} from './helpers.js';

const MODES = ['classic', 'coloured', 'grid'] as const;
const PER_MODE: Record<string, number> = { classic: 60, coloured: 50, grid: 50 };

test('home is the masthead and one card per mode', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.wordmark')).toHaveText('THREAD');
  await expect(page.locator('.gamecard')).toHaveCount(3);
  for (const m of MODES) await expect(page.locator(`[data-card="${m}"]`)).toBeVisible();
});

test('a mode opens its chapters, and a chapter opens its path', async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-card="classic"]').click();
  await expect(page.locator('.gamecard')).toHaveCount(6);
  await page.locator('[data-card="chapter-1"]').click();
  // The path screen draws one isometric tile per level.
  await expect(page.locator('.ptile')).toHaveCount(10);
});

test('the chapters get bigger as you go', async ({ page }) => {
  await gotoApp(page, '#/p/classic/1');
  const first = await page.evaluate(
    () => (window as never as { __thread: { board(): { posts: unknown[] } } }).__thread.board().posts.length,
  );
  await page.goto('/#/p/classic/60');
  await page.waitForSelector('.board-svg');
  const last = await page.evaluate(
    () => (window as never as { __thread: { board(): { posts: unknown[] } } }).__thread.board().posts.length,
  );
  expect(last).toBeGreaterThan(first * 2);
});

for (const mode of MODES) {
  test(`every ${mode} board is solvable by dragging`, async ({ page }) => {
    await gotoApp(page);
    for (let n = 1; n <= PER_MODE[mode]; n++) {
      const board = await openBoard(page, mode, n);
      await solveByDragging(page, board);
      expect(await isSolved(page), `${mode} ${n} (${board.id}) was not solved`).toBe(true);
    }
    expect((await solvedIds(page)).length).toBe(PER_MODE[mode]);
  });
}

test('a warning appears the moment it is true and goes the moment it is not', async ({ page }) => {
  const board = await openBoard(page, 'coloured', 1);
  const note = page.locator('.hud .ask');

  // Lay a string that stops short: the board is unfinished, and says so.
  await dragStrand(page, board, board.solution[0].slice(0, 2));
  await expect(note).toHaveClass(/bad/);
  const warned = (await note.textContent()) ?? '';
  expect(warned.length).toBeGreaterThan(0);

  // Take it back off. The warning has to go with it — a warning that outlives
  // its cause teaches the wrong thing.
  await page.locator('.pill', { hasText: 'Clear' }).click();
  await expect(note).not.toHaveClass(/bad/);

  // And the whole answer clears it for good.
  await solveByDragging(page, board);
  await expect(note).toHaveText('Solved');
  await expect(note).not.toHaveClass(/bad/);
});

test('the string can be grabbed in the middle, and the rest joins back on', async ({ page }) => {
  const board = await openBoard(page, 'classic', 20);
  const path = board.solution[0];
  await solveByDragging(page, board);
  expect(await isSolved(page)).toBe(true);

  // Grab a post in the middle of the string and pull it off its route. What
  // was past it should still be there, not wiped.
  const at = await pointMapper(page);
  const mid = Math.floor(path.length / 2);
  const from = at(board.posts[path[mid]]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 4, { steps: 3 });
  await page.mouse.up();
  // Letting go where we started puts the string back exactly as it was, tail
  // and all, rather than leaving half a string behind.
  await expect(page.locator('.hud .num')).toContainText(`${board.posts.length} of ${board.posts.length}`);
});

test('dragging back over the last post takes it back', async ({ page }) => {
  const board = await openBoard(page, 'classic', 1);
  const path = board.solution[0];
  await dragStrand(page, board, path.slice(0, 4));
  await expect(page.locator('.hud .num')).toContainText('4 of');
  await dragStrand(page, board, [path[3], path[2]]);
  await expect(page.locator('.hud .num')).toContainText('3 of');
});

test('Clear empties the board and Undo puts it back', async ({ page }) => {
  const board = await openBoard(page, 'classic', 2);
  await dragStrand(page, board, board.solution[0].slice(0, 5));
  await expect(page.locator('.hud .num')).toContainText('5 of');
  await page.locator('.pill', { hasText: 'Clear' }).click();
  await expect(page.locator('.hud .num')).toContainText('0 of');
  await page.locator('.pill', { hasText: 'Undo' }).click();
  await expect(page.locator('.hud .num')).toContainText('5 of');
});

test('a solve is remembered across a reload', async ({ page }) => {
  const board = await openBoard(page, 'grid', 1);
  await solveByDragging(page, board);
  expect(await isSolved(page)).toBe(true);
  await page.goto('/#/c/grid/1');
  await page.waitForSelector('.ptile');
  await expect(page.locator('.ptile.done')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.ptile.done')).toHaveCount(1);
});

test('the board can be played with the keyboard alone', async ({ page }) => {
  await openBoard(page, 'classic', 1);
  await page.locator('.board-svg').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hud .num')).toContainText('1 of');
});
