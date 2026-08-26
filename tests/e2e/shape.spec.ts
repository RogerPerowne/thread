import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, shapeBoard, markCell, paintCells, pickMark,
  solveShape, isSolved, noteOf, control,
} from './helpers.js';

/**
 * Every shipped board, filled by real gestures, in chunks.
 *
 * Each mark is a tap on a palette chip and a tap on a cell, which is the
 * gesture the game is actually played with. Calling into the session would
 * prove the rules work and nothing about whether the board can be filled with
 * a thumb.
 */
test.describe('every board can be filled', () => {
  for (const chunk of [0, 1, 2, 3]) {
    test(`shape up boards ${chunk * 17 + 1} to ${chunk * 17 + 17}`, async ({ page }) => {
      await gotoApp(page);
      const ids = (await puzzleIds(page, 'shape')).slice(chunk * 17, chunk * 17 + 17);
      for (const id of ids) {
        await openPuzzle(page, 'shape', id);
        const board = await shapeBoard(page);
        await solveShape(page, board);
        expect(await isSolved(page), `${id} was not solved`).toBe(true);
      }
    });
  }
});

test('a chip is chosen once and then put down as often as you like', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  // Every cell starts undecided, which is not the same as empty.
  expect((await cells()).every((v) => v === -1)).toBe(true);

  await markCell(page, 0, 2);
  expect((await cells())[0]).toBe(2);

  /* The chip stays chosen: the second cell needs one tap, not two. */
  const at = await page.evaluate(
    () => (window.__puzzles.board() as { cellBox(c: number): { x: number; y: number; size: number } }).cellBox(1),
  );
  const box = await page.locator('.shape-svg').boundingBox();
  const v = await page.evaluate(() => (window.__puzzles.board() as { view: { W: number; H: number } }).view);
  const side = Math.min(box!.width / v.W, box!.height / v.H);
  const left = box!.x + (box!.width - side * v.W) / 2;
  const top = box!.y + (box!.height - side * v.H) / 2;
  await page.mouse.move(left + (at.x + at.size / 2) * side, top + (at.y + at.size / 2) * side);
  await page.mouse.down();
  await page.mouse.up();
  expect((await cells())[1]).toBe(2);

  /* Tapping a cell that already holds the chosen mark takes it off again, so
     rubbing out is the same gesture as writing. */
  await page.mouse.down();
  await page.mouse.up();
  expect((await cells())[1]).toBe(-1);

  /* "Empty" is a mark like any other — a decision, not a blank. */
  await markCell(page, 3, 0);
  expect((await cells())[3]).toBe(0);
  await expect(page.locator('.shape-marks .shape-blank')).toHaveCount(1);
});

test('a drag paints a run of cells with one mark', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const board = await shapeBoard(page);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  const row = [0, 1, 2].slice(0, board.w);
  await paintCells(page, row, 0);
  for (const i of row) expect((await cells())[i]).toBe(0);

  /* And a drag that starts on a cell already holding the mark rubs the whole
     run out, rather than changing its mind halfway along. */
  await paintCells(page, row, 0);
  for (const i of row) expect((await cells())[i]).toBe(-1);
});

test('the palette is where it was last time, and its chips fit a thumb', async ({ page }) => {
  /*
   * The biggest board on the narrowest phone, which is where the ring this
   * replaced went wrong: it was measured in board units, so it shrank as the
   * grid grew and came out at thirty-five pixels here. A chip is twenty-four
   * board units on a board 174 across, which is forty-four pixels at 320 —
   * and every smaller board makes it bigger.
   */
  await page.setViewportSize({ width: 320, height: 568 });
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[65]);

  const boxes = await page.locator('.shape-chip .shape-chipbg')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  expect(boxes.length).toBeGreaterThan(1);
  for (const b of boxes) {
    expect(b.width, 'a palette chip is under a thumb').toBeGreaterThanOrEqual(43.5);
  }

  /* Choosing a mark does not move anything: the chip is in the same place
     before and after, which is the whole advantage over a menu that opens
     where you happen to press. */
  const before = boxes.map((b) => Math.round(b.x));
  await pickMark(page, 1);
  const after = await page.locator('.shape-chip .shape-chipbg')
    .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().x)));
  expect(after).toEqual(before);
  await expect(page.locator('.shape-chip.on')).toHaveCount(1);
});

test('a clue only goes red once the line can say so', async ({ page }) => {
  /*
   * The rule every game here shares. A clue about the second shape along
   * cannot be broken while the cells before it are undecided, and a board that
   * reddens on the first mark is a board whose red means nothing.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[2]);
  const board = await shapeBoard(page);

  await markCell(page, 0, board.answer[0] === 1 ? 2 : 1);
  await expect(noteOf(page)).not.toHaveClass(/bad/);
  await expect(page.locator('.shape-clue.off')).toHaveCount(0);
});

test('a half-filled board comes back after a reload', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[4]);
  const board = await shapeBoard(page);
  await markCell(page, 0, board.answer[0]);
  await markCell(page, 1, board.answer[1]);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.shape-svg');
  const back = await page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );
  expect(back[0]).toBe(board.answer[0]);
  expect(back[1]).toBe(board.answer[1]);
});

test('restart clears the board', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const board = await shapeBoard(page);
  await markCell(page, 0, board.answer[0]);
  await control(page, 'Restart').click();
  await page.locator('.sheet .btn', { hasText: 'Clear the board' }).click();
  const back = await page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );
  expect(back.every((v) => v === -1)).toBe(true);
});
