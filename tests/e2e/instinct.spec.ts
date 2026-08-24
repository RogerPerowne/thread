import { test, expect } from '@playwright/test';
import { gotoApp, openLevel, pointMapper, tap, drag, isSolved, readCurrent } from './helpers.js';

/**
 * Instinct tests, in the browser this time. These assert that the OBVIOUS
 * gesture works — the question the prototype never asked.
 */

test('drag around the pegs and let go — it closes', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  await drag(page, level.threads[0].sol.map((p) => at(level.pegs[p])));
  expect(await isSolved(page)).toBe(true);
});

test('tap the loose end twice — it closes', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;
  for (const p of sol) await tap(page, at(level.pegs[p]));
  expect(await isSolved(page)).toBe(false);
  await tap(page, at(level.pegs[sol[sol.length - 1]]));
  expect(await isSolved(page)).toBe(true);
});

test('return to the start peg on a non-crossing level — it closes', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;
  for (const p of sol) await tap(page, at(level.pegs[p]));
  await tap(page, at(level.pegs[sol[0]]));
  expect(await isSolved(page)).toBe(true);
});

test('a finger that is not quite on the peg still hits it', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;
  // Offset every tap by a couple of board units — a real thumb, not a cursor.
  for (const p of sol) {
    const q = at(level.pegs[p]);
    await tap(page, { x: q.x + 7, y: q.y - 6 });
  }
  const last = at(level.pegs[sol[sol.length - 1]]);
  await tap(page, { x: last.x + 7, y: last.y - 6 });
  expect(await isSolved(page)).toBe(true);
});

test('there is no Tie off button anywhere', async ({ page }) => {
  await gotoApp(page);
  await openLevel(page, 'classic', 'c-1-1');
  const text = (await page.locator('body').innerText()).toLowerCase();
  expect(text).not.toContain('tie off');
  await expect(page.getByRole('button', { name: /tie ?off/i })).toHaveCount(0);
});

test('a wrong loop shows how close it was, not just "wrong"', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;
  // Drop a peg: nearly right, and the badge must say so as a percentage.
  const wrong = sol.slice(0, -1);
  for (const p of wrong) await tap(page, at(level.pegs[p]));
  await tap(page, at(level.pegs[wrong[wrong.length - 1]]));
  // The substantive point: a number, not the word "wrong".
  await expect(page.locator('.matchbadge')).toHaveText(/\d+%/);
  await expect(page.locator('.matchbadge')).toHaveClass(/show/);
  const c = await readCurrent(page);
  expect(c.lastMiss).toBeGreaterThan(0);
  expect(c.lastMiss).toBeLessThan(0.995);
  expect(c.solved).toBe(false);
});

test('undo takes back exactly one peg', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;
  for (const p of sol) await tap(page, at(level.pegs[p]));
  await page.getByRole('button', { name: 'Undo' }).click();
  // The loop is now one peg short, so tying it off must NOT win.
  await tap(page, at(level.pegs[sol[sol.length - 2]]));
  expect(await isSolved(page)).toBe(false);
});

test('keyboard play solves a level without a pointer at all', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const sol = level.threads[0].sol;
  for (const peg of sol) {
    await page.locator(`.peg[data-peg="${peg}"]`).focus();
    await page.keyboard.press('Enter');
  }
  await page.locator(`.peg[data-peg="${sol[sol.length - 1]}"]`).focus();
  await page.keyboard.press('Enter');
  expect(await isSolved(page)).toBe(true);
});
