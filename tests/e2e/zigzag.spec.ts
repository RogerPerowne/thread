import { test, expect } from '@playwright/test';
import {
  gotoApp, openPuzzle, puzzleIds, zigBoard, zigMapper, drawLine, isSolved,
  noteOf, control,
} from './helpers.js';

const CHUNK = 15;
for (let from = 0; from < 45; from += CHUNK) {
  test(`zigzag boards ${from + 1} to ${from + CHUNK} are drawable`, async ({ page }) => {
    await gotoApp(page);
    const ids = await puzzleIds(page, 'zigzag');
    for (const id of ids.slice(from, from + CHUNK)) {
      await openPuzzle(page, 'zigzag', id);
      const zig = await zigBoard(page);
      await drawLine(page, zig.answer);
      expect(await isSolved(page), `${id} was not solved`).toBe(true);
    }
  });
}

test('the line will not step somewhere the numbers forbid', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[0]);
  const zig = await zigBoard(page);

  // A neighbour of the start that carries the wrong number. Nothing should
  // happen — and nothing happening is exactly what a missed touch looks like,
  // so the cell has to flinch.
  const wrong = await page.evaluate(() => {
    const z = (window.__puzzles.board() as { zig: { w: number; h: number; cells: number[]; sequence: number[]; start: number } }).zig;
    const x = z.start % z.w;
    const y = Math.floor(z.start / z.w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= z.w || ny >= z.h) continue;
        const c = ny * z.w + nx;
        if (z.cells[c] !== z.sequence[1]) return c;
      }
    }
    return -1;
  });
  expect(wrong, 'this board has no wrong neighbour to try').toBeGreaterThanOrEqual(0);

  await drawLine(page, [zig.start, wrong]);
  const path = await page.evaluate(() => (window.__puzzles.board() as { path(): number[] }).path());
  expect(path).toEqual([zig.start]);
});

test('drawing back over the cell before takes the step off', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[0]);
  const zig = await zigBoard(page);
  const at = await zigMapper(page);

  const first = at(zig.answer[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const c of zig.answer.slice(1, 5)) {
    const p = at(c);
    await page.mouse.move(p.x, p.y, { steps: 3 });
  }
  const back = at(zig.answer[3]);
  await page.mouse.move(back.x, back.y, { steps: 3 });
  await page.mouse.up();
  const path = await page.evaluate(() => (window.__puzzles.board() as { path(): number[] }).path());
  expect(path).toEqual(zig.answer.slice(0, 4));
});

test('an unfinished line is never shown as a broken one', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[0]);
  const zig = await zigBoard(page);
  await drawLine(page, zig.answer.slice(0, 4));
  await expect(noteOf(page)).not.toHaveClass(/bad/);
  await expect(noteOf(page)).toContainText('to go');
});

test('a half-drawn line comes back after a reload', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[1]);
  const zig = await zigBoard(page);
  await drawLine(page, zig.answer.slice(0, 6));
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('.zig-svg');
  const back = await page.evaluate(() => (window.__puzzles.board() as { path(): number[] }).path());
  expect(back).toEqual(zig.answer.slice(0, 6));
});

test('restart clears the line', async ({ page }) => {
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[0]);
  const zig = await zigBoard(page);
  await drawLine(page, zig.answer.slice(0, 5));
  await control(page, 'Restart').click();
  await page.locator('.sheet .btn', { hasText: 'Clear the board' }).click();
  const path = await page.evaluate(() => (window.__puzzles.board() as { path(): number[] }).path());
  expect(path).toEqual([]);
});

test('the line can be grabbed anywhere and drawn on from there', async ({ page }) => {
  /*
   * Thread's gesture, in Thread's words: put a finger on the seventh cell of a
   * line twenty long and the thirteen after it come away, and you carry on
   * drawing from where your finger is. Otherwise it is thirteen taps of undo
   * to change your mind about one corner.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[19]);
  const zig = await zigBoard(page);
  const path = () => page.evaluate(() => (window.__puzzles.board() as { path(): number[] }).path());

  const run = zig.answer.slice(0, 12);
  await drawLine(page, run);
  expect(await path()).toHaveLength(12);

  // A press on a cell the line already runs through takes it back to there.
  const at = await zigMapper(page);
  const grab = at(run[4]);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await path()).toHaveLength(5);

  // And the same press, held, carries straight on drawing — one gesture.
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  const on = at(run[5]);
  await page.mouse.move(on.x, on.y, { steps: 4 });
  await page.mouse.up();
  expect(await path()).toHaveLength(6);
});

test('a stretch taken back winds off rather than vanishing', async ({ page }) => {
  /*
   * A line that simply stops being there reads as a bug, and on a board you
   * are still dragging across it is easy to miss entirely. The recoil is the
   * only thing that says the game heard you.
   */
  await gotoApp(page);
  const ids = await puzzleIds(page, 'zigzag');
  await openPuzzle(page, 'zigzag', ids[19]);
  const zig = await zigBoard(page);
  const run = zig.answer.slice(0, 10);
  await drawLine(page, run);

  const at = await zigMapper(page);
  const grab = at(run[3]);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // Caught mid-flight: the animation is 320ms and this looks well inside it.
  await expect(page.locator('.zig-recoil.go')).not.toHaveCount(0);
  await page.mouse.up();
});
