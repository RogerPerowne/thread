import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, isolateBoard, tapWall, dragWalls, solveIsolate,
  isSolved, noteOf, control,
} from './helpers.js';

/**
 * Every shipped board, walled in by real presses, in chunks.
 *
 * A board solved by calling into the session would prove the rules work and
 * nothing at all about whether a line between two cells can be hit with a
 * thumb, and those are different questions.
 */
test.describe('every board can be walled in', () => {
  for (const chunk of [0, 1, 2, 3]) {
    test(`isolate boards ${chunk * 12 + 1} to ${chunk * 12 + 12}`, async ({ page }) => {
      await gotoApp(page);
      const ids = (await puzzleIds(page, 'isolate')).slice(chunk * 12, chunk * 12 + 12);
      for (const id of ids) {
        await openPuzzle(page, 'isolate', id);
        const board = await isolateBoard(page);
        await solveIsolate(page, board);
        expect(await isSolved(page), `${id} was not solved`).toBe(true);
      }
    });
  }
});

test('a press draws a wall and a second press takes it off', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'isolate');
  await openPuzzle(page, 'isolate', ids[0]);
  const board = await isolateBoard(page);
  const walls = () => page.evaluate(
    () => (window.__puzzles.board() as { walls(): number[] }).walls(),
  );

  const spare = board.answer.find((e) => !board.given.includes(e))!;
  expect(await walls()).toEqual([...board.given].sort((a, b) => a - b));
  await tapWall(page, spare);
  expect(await walls()).toContain(spare);
  await tapWall(page, spare);
  expect(await walls()).not.toContain(spare);
});

test('the board&apos;s own walls cannot be rubbed out', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'isolate');
  const boards = await Promise.all(ids.slice(0, 12).map(async (id) => {
    await openPuzzle(page, 'isolate', id);
    return { id, board: await isolateBoard(page) };
  }));
  const withWalls = boards.find((b) => b.board.given.length > 0);
  test.skip(!withWalls, 'no board in the first dozen came with a wall');
  await openPuzzle(page, 'isolate', withWalls!.id);
  await tapWall(page, withWalls!.board.given[0]);
  const walls = await page.evaluate(
    () => (window.__puzzles.board() as { walls(): number[] }).walls(),
  );
  expect(walls).toContain(withWalls!.board.given[0]);
});

test('a drag draws a run of walls, and a drag back takes them off', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'isolate');
  await openPuzzle(page, 'isolate', ids[6]);
  const board = await isolateBoard(page);
  const walls = () => page.evaluate(
    () => (window.__puzzles.board() as { walls(): number[] }).walls(),
  );

  const run = board.answer.filter((e) => !board.given.includes(e)).slice(0, 3);
  await dragWalls(page, run);
  for (const edge of run) expect(await walls()).toContain(edge);

  /* The line the drag starts on says what the whole drag does, so the same
     sweep again rubs the whole run out rather than changing its mind. */
  await dragWalls(page, run);
  for (const edge of run) expect(await walls()).not.toContain(edge);
});

test('an untouched board is never shown as a broken one', async ({ page }) => {
  /*
   * The rule every game here shares. On an untouched board the whole grid is
   * one room holding every circle, and a board that says so is a board in red
   * before the player has done anything.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'isolate');
  await openPuzzle(page, 'isolate', ids[20]);
  await expect(noteOf(page)).not.toHaveClass(/bad/);
  expect(await page.locator('.iso-cell.wrong').count()).toBe(0);
});

test('the hint names a line and lights the two cells it is between', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'isolate');
  await openPuzzle(page, 'isolate', ids[10]);
  await control(page, 'Hint').click();
  await expect(noteOf(page)).toContainText('Look here');
  expect(await page.locator('.iso-cell.lookhere').count()).toBeGreaterThan(0);
  await control(page, 'Hint').click();
  await expect(noteOf(page)).toContainText(/room|circles|number|wall|cross/i);
});

test('a half-walled board comes back after a reload', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'isolate');
  await openPuzzle(page, 'isolate', ids[4]);
  const board = await isolateBoard(page);
  const spare = board.answer.filter((e) => !board.given.includes(e)).slice(0, 2);
  for (const edge of spare) await tapWall(page, edge);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.iso-svg');
  const back = await page.evaluate(
    () => (window.__puzzles.board() as { walls(): number[] }).walls(),
  );
  for (const edge of spare) expect(back).toContain(edge);
});
