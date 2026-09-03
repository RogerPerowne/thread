import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, ladderSpread, nineBoard, nineMapper, dragDigit, solveNine,
  isSolved, noteOf, control,
} from './helpers.js';

/**
 * Every shipped board, solved by real drags, in chunks.
 *
 * A board solved by calling into the session would prove the arithmetic works
 * and nothing at all about whether nine tokens can be moved with a thumb, and
 * those are different questions.
 */
test.describe('every board can be filled', () => {
  for (const chunk of [0, 1]) {
    test(`one to nine, half ${chunk + 1} of the ladder`, async ({ page }) => {
      await gotoApp(page);
      const all = await ladderSpread(page, 'nine');
      const ids = chunk === 0 ? all.slice(0, Math.ceil(all.length / 2)) : all.slice(Math.ceil(all.length / 2));
      for (const id of ids) {
        await openPuzzle(page, 'nine', id);
        const board = await nineBoard(page);
        await solveNine(page, board);
        expect(await isSolved(page), `${id} was not solved`).toBe(true);
      }
    });
  }
});

test('a digit can be moved four different ways and they all mean what they look like', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[0]);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  // 1. Drag from the tray into a cell.
  await dragDigit(page, 5, 0);
  expect((await cells())[0]).toBe(5);

  // 2. Tap a token, then tap a cell.
  const at = await nineMapper(page);
  const tap = async (x: number, y: number) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  };
  const slot9 = await page.evaluate(
    () => (window.__puzzles.board() as { slot(d: number): { x: number; y: number } }).slot(9),
  );
  const box1 = await page.evaluate(
    () => (window.__puzzles.board() as { cellBox(c: number): { x: number; y: number; size: number } }).cellBox(1),
  );
  let p = at(slot9.x + 9.5, slot9.y + 9.5);
  await tap(p.x, p.y);
  p = at(box1.x + box1.size / 2, box1.y + box1.size / 2);
  await tap(p.x, p.y);
  expect((await cells()).slice(0, 2)).toEqual([5, 9]);

  // 3. Drag one placed digit onto another: a swap, because nothing else it
  //    could mean is useful.
  await dragDigit(page, 5, 1);
  expect((await cells()).slice(0, 2)).toEqual([9, 5]);

  // 4. Drag a digit off the board and it goes back to the tray.
  const trayPoint = at(30, 150);
  const box0 = await page.evaluate(
    () => (window.__puzzles.board() as { cellBox(c: number): { x: number; y: number; size: number } }).cellBox(0),
  );
  const from = at(box0.x + box0.size / 2, box0.y + box0.size / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(trayPoint.x, trayPoint.y);
  await page.mouse.up();
  expect((await cells())[0]).toBe(0);
});

test('a half-filled line is never shown as a wrong one', async ({ page }) => {
  /*
   * The rule Thread learned the hard way. Two digits of a row down and the
   * third missing is unfinished, not wrong — and a board that goes red on the
   * first digit is a board whose red means nothing.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[3]);
  const board = await nineBoard(page);

  await dragDigit(page, board.answer[0] === 1 ? 2 : 1, 0);
  await dragDigit(page, board.answer[0] === 1 ? 3 : (board.answer[1] === 2 ? 3 : 2), 1);
  await expect(noteOf(page)).not.toHaveClass(/bad/);
  await expect(page.locator('.nine-target.off')).toHaveCount(0);
});

test('a full line that does not come out says so, and stops when it is fixed', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[0]);
  const board = await nineBoard(page);

  /*
   * A row that is full and wrong. Which digits make it wrong is the game's
   * business, not the harness's — swapping two of the answer's own is not
   * enough, because `a x b + c` does not care which way round a and b go. So
   * the wrong row is found by trying and looking at what the board says, which
   * is also the only thing this test is actually about.
   */
  const marked = () => page.locator('.nine-target.off').count();
  const wrong = [1, 2, 3, 4].map((d) => [d, d % 9 + 1, (d + 4) % 9 + 1]);
  let ok = false;
  for (const trio of wrong) {
    if (new Set(trio).size !== 3) continue;
    for (let i = 0; i < 3; i++) await dragDigit(page, trio[i], i);
    if (await marked() > 0) { ok = true; break; }
  }
  expect(ok, 'no full-and-wrong first row could be built').toBe(true);

  // Put the real row in and the mark goes, immediately.
  for (let i = 0; i < 3; i++) await dragDigit(page, board.answer[i], i);
  await expect(page.locator('.nine-target.off')).toHaveCount(0);
  await expect(page.locator('.nine-target.out')).not.toHaveCount(0);
});

test('a cell answers the moment it is pressed, even mid-animation', async ({ page }) => {
  /*
   * A token slides to its place over a tenth of a second, and for that tenth
   * of a second the thing under the finger and the thing the board believes is
   * under the finger were different elements — so a press straight after a
   * move landed on the empty hole and did nothing. Hit-testing reads the model
   * now; this presses again with no pause at all.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[0]);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  await dragDigit(page, 5, 0);
  // No wait. Straight into moving it on.
  await dragDigit(page, 5, 4);
  expect((await cells())[0]).toBe(0);
  expect((await cells())[4]).toBe(5);
});

test('a token is big enough for a thumb on the narrowest phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[0]);
  const box = await page.locator('.nine-token').first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(43.5);
  expect(box!.height).toBeGreaterThanOrEqual(43.5);
});

test('a half-filled board comes back after a reload', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[5]);
  const board = await nineBoard(page);
  await dragDigit(page, board.answer[0], 0);
  await dragDigit(page, board.answer[4], 4);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.nine-svg');
  const back = await page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );
  expect(back[0]).toBe(board.answer[0]);
  expect(back[4]).toBe(board.answer[4]);
});

test('restart clears the board', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'nine');
  await openPuzzle(page, 'nine', ids[0]);
  const board = await nineBoard(page);
  await dragDigit(page, board.answer[0], 0);
  await control(page, 'Restart').click();
  await page.locator('.sheet .btn', { hasText: 'Clear the board' }).click();
  const back = await page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );
  expect(back.every((d) => d === 0)).toBe(true);
});
