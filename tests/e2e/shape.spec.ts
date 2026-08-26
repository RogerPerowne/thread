import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, shapeBoard, markCell, slideMark, solveShape,
  isSolved, noteOf, control,
} from './helpers.js';

/**
 * Every shipped board, filled by real gestures, in chunks.
 *
 * Each mark is a press on the cell and a slide onto the ring, which is the
 * gesture the game is actually played with. Calling into the session would
 * prove the rules work and nothing about whether a ring of five options can be
 * hit with a thumb.
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

test('the ring opens under the finger and puts what you slide onto', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  // Every cell starts undecided, which is not the same as empty.
  expect((await cells()).every((v) => v === -1)).toBe(true);

  // Press and slide onto a shape without letting go.
  await slideMark(page, 0, 2);
  expect((await cells())[0]).toBe(2);

  /*
   * The middle of the ring marks a cell empty — a decision, not a blank. It
   * cannot be reached by sliding, because it is where the finger already is,
   * so it is the one option that needs the press-then-tap way in.
   */
  await markCell(page, 1, 0);
  expect((await cells())[1]).toBe(0);
  await expect(page.locator('.shape-blank')).toHaveCount(1);
});

test('a press leaves the ring open to be tapped', async ({ page }) => {
  /*
   * Two ways in, and neither is wrong: a player who has met a radial menu
   * slides onto an option, and one who has not lifts their finger and looks.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);

  const box = await page.locator('.shape-svg').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.shape-ring.open')).toHaveCount(1);
  await expect(page.locator('.shape-opt')).not.toHaveCount(0);
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

test('an option on the ring is big enough for a thumb', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[65]);

  const box = await page.locator('.shape-svg').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  const widths = await page.locator('.shape-opt .shape-optbg')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  const opt = { width: Math.min(...widths) };
  /*
   * The biggest board on the narrowest phone, which is where this went wrong:
   * the ring used to be measured in board units, so it shrank as the grid
   * grew and came out at thirty-five pixels here. It is measured in pixels
   * now, so the option is the same size to a thumb whatever it sits on.
   */
  expect(opt!.width).toBeGreaterThanOrEqual(43.5);

  // And two of them never overlap, whatever the count of shapes.
  const boxes = await page.locator('.shape-opt .shape-optbg').evaluateAll(
    (els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({
      x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2,
    })),
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let k = i + 1; k < boxes.length; k++) {
      const gap = Math.hypot(boxes[i].x - boxes[k].x, boxes[i].y - boxes[k].y);
      expect(gap, 'two options on the ring overlap').toBeGreaterThan(boxes[i].r + boxes[k].r - 1);
    }
  }
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
