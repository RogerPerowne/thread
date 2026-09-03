import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, ladderSpread, shapeBoard, shapeMapper, markCell, dragCell,
  tapClue, pickMark, solveShape, isSolved, noteOf, control,
} from './helpers.js';

/**
 * A spread of the ladder, filled by real gestures.
 *
 * Each mark is a tap on a palette chip and a tap on a cell, which is the
 * gesture the game is actually played with. Calling into the session would
 * prove the rules work and nothing about whether the board can be filled with
 * a thumb.
 */
test.describe('every board can be filled', () => {
  for (const chunk of [0, 1]) {
    test(`shape up, half ${chunk + 1} of the ladder`, async ({ page }) => {
      await gotoApp(page);
      const all = await ladderSpread(page, 'shape');
      const ids = chunk === 0 ? all.slice(0, Math.ceil(all.length / 2)) : all.slice(Math.ceil(all.length / 2));
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

test('a drag never writes on the cells it crosses', async ({ page }) => {
  /*
   * A finger moving over a puzzle is nearly always a finger thinking. This
   * used to paint every cell the drag crossed, so a board could not tell
   * looking from writing; now a gesture puts down exactly one mark, where it
   * ends. Here a mark is dragged from its cell across two others, and the
   * two it crossed are exactly as they were.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const board = await shapeBoard(page);
  expect(board.w).toBeGreaterThanOrEqual(4);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  await markCell(page, 0, 2);
  await dragCell(page, 0, 3, [1, 2]);
  const after = await cells();
  expect(after[0], 'the moved mark is still where it came from').toBe(-1);
  expect(after[1], 'the drag wrote on a cell it crossed').toBe(-1);
  expect(after[2], 'the drag wrote on a cell it crossed').toBe(-1);
  expect(after[3], 'the mark did not land where it was dropped').toBe(2);

  /* And dragged off the grid, it is simply taken away. */
  const at = await shapeMapper(page);
  const box = await page.evaluate(
    () => (window.__puzzles.board() as { cellBox(c: number): { x: number; y: number; size: number } }).cellBox(3),
  );
  const from = at(box.x + box.size / 2, box.y + box.size / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const off = at(-6, box.y + box.size / 2);
  await page.mouse.move(off.x, off.y, { steps: 4 });
  await page.mouse.up();
  expect((await cells())[3]).toBe(-1);
});

test('a clue reads itself out when pressed', async ({ page }) => {
  /*
   * "2 ▲ ›" is a triangle with a count and an arrow. What it MEANS is a
   * sentence, and the board says the sentence when asked — with the cells
   * of the line lighting in the order the clue looks along them.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const board = await shapeBoard(page);
  const k = board.clues.findIndex((c) => c.depth === 2);
  expect(k).toBeGreaterThanOrEqual(0);
  await tapClue(page, k);
  await expect(noteOf(page)).toContainText('second shape');
  const line = await page.evaluate(
    (c) => (window.__puzzles.board() as { sight(side: string, line: number): number[] }).sight(c.side, c.line),
    board.clues[k],
  );
  await expect(page.locator('.shape-hole.read')).toHaveCount(line.length);
  /* Reading a clue changes nothing on the board, so nothing to undo. */
  await expect(control(page, 'Undo')).toBeDisabled();
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

test('a shape can be dragged straight from the palette onto a cell', async ({ page }) => {
  /*
   * One gesture from the row of chips to the board: press a chip, carry the
   * mark under the finger, let go over a cell. It is the same press and the
   * same release that a tap on the chip would have been, so nothing had to
   * decide which of the two it was at the start.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const at = await shapeMapper(page);
  const cells = () => page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );

  const chip = await page.evaluate(
    () => (window.__puzzles.board() as { chipBox(k: number): { x: number; y: number; size: number } }).chipBox(2),
  );
  const from = at(chip.x + chip.size / 2, chip.y + chip.size / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  /* The mark is under the finger from the press, not from the first move: the
     chip is chosen and picked up in one action. */
  await expect(page.locator('.shape-carry .shape-glyph')).toHaveCount(1);

  const boxes = await page.evaluate(
    (list) => list.map((c) => (window.__puzzles.board() as { cellBox(c: number): { x: number; y: number; size: number } }).cellBox(c)),
    [4, 5],
  );
  for (const box of boxes) {
    const q = at(box.x + box.size / 2, box.y + box.size / 2);
    await page.mouse.move(q.x, q.y, { steps: 4 });
  }
  await expect(page.locator('.shape-carry .shape-glyph')).toHaveCount(1);
  await page.mouse.up();

  const back = await cells();
  expect(back[4], 'the drag wrote on a cell it only crossed').toBe(-1);
  expect(back[5], 'the mark did not land where it was let go').toBe(2);
  /* And it is put down, not still being carried. */
  await expect(page.locator('.shape-carry .shape-glyph')).toHaveCount(0);
});

test('a line that takes its last shape says so and stays said', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const board = await shapeBoard(page);

  const doneLines = () => page.evaluate(
    () => (window.__puzzles.board() as { done(): string[] }).done(),
  );
  expect(await doneLines()).toEqual([]);

  /* The first row, and only the first row: its blanks are never drawn. */
  for (let c = 0; c < board.w; c++) {
    if (board.answer[c] > 0) await markCell(page, c, board.answer[c]);
  }
  expect(await doneLines(), 'a finished row is not finished').toContain('r0');
  await expect(page.locator('.shape-hole.settled')).toHaveCount(board.w);
});

test('the palette hands over the next shape when one is all placed', async ({ page }) => {
  /*
   * There are exactly `h` of each shape, one per row. Once they are all down
   * the chip in your hand has nothing left to give, so the board passes you
   * the next one rather than making you reach back for it.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[0]);
  const board = await shapeBoard(page);
  const picked = () => page.evaluate(
    () => (window.__puzzles.board() as { picked(): number }).picked(),
  );

  const cells = board.answer.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
  expect(cells).toHaveLength(board.h);
  for (const i of cells) await markCell(page, i, 1);

  expect(await picked(), 'the spent chip is still in hand').not.toBe(1);
  await expect(page.locator('.shape-chip.spent')).toHaveCount(1);
});

test('a board is solved by its shapes, with no blank ever drawn', async ({ page }) => {
  /*
   * The dot is the player's own notation. People put one where the deduction
   * needed it and nowhere else, so a board that waits for a dot in every
   * remaining cell is a board that makes you tidy up after winning.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'shape');
  await openPuzzle(page, 'shape', ids[3]);
  const board = await shapeBoard(page);

  for (const pick of [...new Set(board.answer.filter((v) => v > 0))].sort()) {
    const cells = board.answer.map((v, i) => (v === pick ? i : -1)).filter((i) => i >= 0);
    for (const i of cells) await markCell(page, i, pick);
  }
  await expect(page.locator('.shape-marks .shape-blank')).toHaveCount(0);
  expect(await isSolved(page), 'the shapes are all right and it is not solved').toBe(true);
});

test('a clue only goes red once the line can say so', async ({ page }) => {
  /*
   * The rule every game here shares. A clue about the second shape along
   * cannot be broken while the cells before it are undecided, and a board that
   * reddens on the first mark is a board whose red means nothing.
   */
  await gotoApp(page);
  /*
   * A board where the top-left cell is not what a FIRST-shape clue is looking
   * at, chosen rather than assumed. A clue about the first shape along can be
   * broken by the first mark, and correctly so — it is the clues about the
   * second that have to wait, and a board where the corner answers a first
   * would be testing the opposite of what this is about.
   */
  const id = await page.evaluate(() => {
    for (const pid of window.__puzzles.puzzles('shape')) {
      const d = window.__puzzles.puzzle('shape', pid)!.data as {
        clues: { side: string; line: number; depth: number }[];
      };
      const watched = d.clues.some(
        (c) => c.depth === 1 && c.line === 0 && (c.side === 'left' || c.side === 'top'),
      );
      if (!watched) return pid;
    }
    return null;
  });
  expect(id, 'no board leaves its corner unwatched by a first-shape clue').not.toBeNull();
  await openPuzzle(page, 'shape', id!);
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
