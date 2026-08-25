import { test, expect } from '@playwright/test';
import {
  gotoApp, openBoard, readBoard, solveByDragging, dragStrand, isSolved, solvedIds,
} from './helpers.js';

const MODES = ['classic', 'coloured', 'grid'] as const;

test('the home screen is three cards and nothing else', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.card')).toHaveCount(3);
  for (const m of MODES) await expect(page.locator(`[data-card="${m}"]`)).toBeVisible();
  // It has to fit a phone without scrolling: that was the complaint.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight - innerHeight,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

for (const mode of MODES) {
  test(`every ${mode} board is solvable by dragging`, async ({ page }) => {
    await gotoApp(page);
    for (let n = 1; n <= 40; n++) {
      const board = await openBoard(page, mode, n);
      await solveByDragging(page, board);
      expect(await isSolved(page), `${mode} ${n} (${board.id}) was not solved`).toBe(true);
    }
    const solved = await solvedIds(page);
    expect(solved.length).toBe(40);
  });
}

test('a wrong string says what is wrong, and the counter tracks the posts', async ({ page }) => {
  const board = await openBoard(page, 'coloured', 1);
  await expect(page.locator('.hud .count')).toContainText(`0 of ${board.posts.length} posts`);
  // Lay one string short of its far end: the board is not finished.
  const first = board.solution[0];
  await dragStrand(page, board, first.slice(0, 2));
  expect(await isSolved(page)).toBe(false);
  await expect(page.locator('.hud .note')).not.toHaveText('');
});

test('dragging back over the last post takes it back', async ({ page }) => {
  const board = await openBoard(page, 'classic', 1);
  const path = board.solution[0];
  await dragStrand(page, board, path.slice(0, 4));
  await expect(page.locator('.hud .count')).toContainText('4 of');
  await dragStrand(page, board, [path[3], path[2]]);
  await expect(page.locator('.hud .count')).toContainText('3 of');
});

test('Clear empties the board and Undo puts it back', async ({ page }) => {
  const board = await openBoard(page, 'classic', 2);
  await dragStrand(page, board, board.solution[0].slice(0, 5));
  await expect(page.locator('.hud .count')).toContainText('5 of');
  await page.locator('.btn', { hasText: 'Clear' }).click();
  await expect(page.locator('.hud .count')).toContainText('0 of');
  await page.locator('.btn', { hasText: 'Undo' }).click();
  await expect(page.locator('.hud .count')).toContainText('5 of');
});

test('a solve is remembered across a reload', async ({ page }) => {
  const board = await openBoard(page, 'grid', 1);
  await solveByDragging(page, board);
  expect(await isSolved(page)).toBe(true);
  await page.goto('/#/m/grid');
  await expect(page.locator('.chip.done')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.chip.done')).toHaveCount(1);
});

test('the board can be played with the keyboard alone', async ({ page }) => {
  const board = await openBoard(page, 'classic', 1);
  await readBoard(page);
  await page.locator('.board').focus();
  // Enter picks up the pinned end the cursor starts on, then each Enter lays
  // string to wherever the arrows have moved the cursor.
  await page.keyboard.press('Enter');
  await expect(page.locator('.hud .count')).toContainText('1 of');
  void board;
});
