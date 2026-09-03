import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, ladderSpread, hexBoard, hexMapper, dragTile, tapTileInto,
  solveHex, isSolved, noteOf, control,
} from './helpers.js';

/**
 * A spread of the ladder, filled by real drags.
 *
 * A board solved by calling into the session would prove the matching rule
 * works and nothing at all about whether nineteen tiles can be moved with a
 * thumb, and those are different questions.
 */
test.describe('every board can be filled', () => {
  for (const chunk of [0, 1]) {
    test(`hexagony, half ${chunk + 1} of the ladder`, async ({ page }) => {
      await gotoApp(page);
      const all = await ladderSpread(page, 'hex');
      const ids = chunk === 0 ? all.slice(0, Math.ceil(all.length / 2)) : all.slice(Math.ceil(all.length / 2));
      for (const id of ids) {
        await openPuzzle(page, 'hex', id);
        const board = await hexBoard(page);
        await solveHex(page, board);
        expect(await isSolved(page), `${id} was not solved`).toBe(true);
      }
    });
  }
});

test('a tile can be moved four ways and they all mean what they look like', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'hex');
  await openPuzzle(page, 'hex', ids[0]);
  const placed = () => page.evaluate(
    () => (window.__puzzles.board() as { placed(): number[] }).placed(),
  );

  // 1. Drag from the tray into a space.
  await dragTile(page, 2, 0);
  expect((await placed())[0]).toBe(2);

  // 2. Tap the tile, then tap the space.
  await tapTileInto(page, 3, 1);
  expect((await placed())[1]).toBe(3);

  // 3. Drag one laid tile onto another: a swap, because nothing else it could
  //    mean is any use.
  await dragTile(page, 2, 1);
  expect((await placed()).slice(0, 2)).toEqual([3, 2]);

  // 4. Drag a tile off the board: it goes back to the tray.
  const at = await hexMapper(page);
  const from = await page.evaluate(
    () => (window.__puzzles.board() as { space(a: number): { x: number; y: number } }).space(0),
  );
  const p = at(from.x, from.y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 4, p.y + 140, { steps: 4 });
  await page.mouse.up();
  expect((await placed())[0]).toBe(-1);
});

test('a clash is shown only where two tiles actually disagree', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'hex');
  await openPuzzle(page, 'hex', ids[0]);
  const board = await hexBoard(page);

  /*
   * The right tile in the first space, and then every other tile tried in the
   * second until one of them disagrees. Which tiles clash is the board's own
   * business, so the harness asks the board rather than working it out from a
   * copy of the matching rule.
   */
  await dragTile(page, board.answer[0], 0);
  let found = false;
  for (let t = 0; t < board.tiles.length && !found; t++) {
    if (t === board.answer[0] || t === board.answer[1]) continue;
    await dragTile(page, t, 1);
    found = (await page.locator('.hex-clash.on').count()) > 0;
  }
  expect(found, 'no two tiles on this board disagree anywhere').toBe(true);
  await expect(noteOf(page)).toContainText('do not match');

  /* And it goes the moment the right tile arrives. */
  await dragTile(page, board.answer[1], 1);
  expect(await page.locator('.hex-clash.on').count()).toBe(0);
  await expect(noteOf(page)).not.toContainText('do not match');
});

test('the hint names a space and lights it up', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'hex');
  await openPuzzle(page, 'hex', ids[20]);
  /* One press lights the space up; a second says why it is that one. A hint
     that answered on the first press would be a quit button. */
  await control(page, 'Hint').click();
  await expect(noteOf(page)).toContainText('Look here');
  expect(await page.locator('.hex-hole.lookhere').count()).toBeGreaterThan(0);
  await control(page, 'Hint').click();
  await expect(noteOf(page)).toContainText(/space/i);
});

test('a board comes back exactly as it was left', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'hex');
  await openPuzzle(page, 'hex', ids[3]);
  const board = await hexBoard(page);
  await dragTile(page, board.answer[0], 0);
  await dragTile(page, board.answer[1], 1);
  /* The save is debounced, so give it the moment it asks for. */
  await page.waitForTimeout(600);

  await openPuzzle(page, 'hex', ids[3]);
  const placed = await page.evaluate(
    () => (window.__puzzles.board() as { placed(): number[] }).placed(),
  );
  expect(placed.slice(0, 2)).toEqual([board.answer[0], board.answer[1]]);
});
