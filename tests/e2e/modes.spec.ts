import { test, expect } from '@playwright/test';
import { gotoApp, openLevel, solveByTapping, isSolved, readCurrent, pointMapper, tap } from './helpers.js';

/**
 * The four modes that ask something other than "copy this shape". These check
 * the things a player would notice: that the board says what it wants, that it
 * does not give the answer away, and that the rule is really enforced.
 */

test('a shadow level shows the region and not the order', async ({ page }) => {
  const level = await openLevel(page, 'shadow', 's-1-1');
  expect(level.id).toBe('s-1-1');
  const ghost = page.locator('.target-ghost').first();
  await expect(ghost).toBeVisible();
  // Filled, but with no outline to trace.
  expect(Number(await ghost.getAttribute('stroke-opacity'))).toBe(0);
  expect(Number(await ghost.getAttribute('fill-opacity'))).toBeGreaterThan(0);
  await expect(page.locator('.hud .ask')).toContainText('order is not');
});

test('a par level counts pegs down, and refuses a wasteful loop', async ({ page }) => {
  const level = await openLevel(page, 'par', 'p-1-1');
  const ask = page.locator('.hud .ask');
  await expect(ask).toContainText('pegs');

  // Thread the answer but stop at a spare peg on the way: same region, one
  // move more than the level allows.
  const sol = level.threads[0].sol;
  const spare = level.pegs.findIndex((_, i) => !sol.includes(i));
  expect(spare).toBeGreaterThanOrEqual(0);
  await solveByTapping(page, { ...level, threads: [{ ...level.threads[0], sol: [sol[0], spare, ...sol.slice(1)] }] });
  expect(await isSolved(page)).toBe(false);
  await expect(page.locator('.matchbadge')).toContainText('Too many pegs');

  // And the intended order wins.
  await openLevel(page, 'par', 'p-1-1');
  await solveByTapping(page, level);
  expect(await isSolved(page)).toBe(true);
});

test('a corral marks what goes in and what stays out, and never draws the answer', async ({ page }) => {
  const level = await openLevel(page, 'corral', 'k-1-1');
  await expect(page.locator('.hud .ask')).toContainText('Fence in');
  await expect(page.locator('.peg-mark').first()).toBeVisible();
  // The target region is not drawn at all: shading the fence's own region
  // would hand over the answer, so BOTH the edge and the fill stay at nothing.
  const ghost = page.locator('.target-ghost').first();
  expect(Number(await ghost.getAttribute('stroke-opacity'))).toBe(0);
  expect(Number(await ghost.getAttribute('fill-opacity'))).toBe(0);
  await solveByTapping(page, level);
  expect(await isSolved(page), `${level.id} was not solved`).toBe(true);
});

test('a corral counts marks rather than a percentage', async ({ page }) => {
  const base = await openLevel(page, 'corral', 'k-1-2');
  const sol = base.threads[0].sol;
  /*
   * A corral asks for a rule, not a picture, so more than one fence satisfies
   * it: dropping some pegs still solves the level. Walk the single-peg drops
   * until one of them genuinely fails, and read the badge from that one.
   */
  let badge = '';
  for (let drop = 0; drop < sol.length && !/\d+ of \d+/.test(badge); drop++) {
    const level = await openLevel(page, 'corral', 'k-1-2');
    const sub = sol.filter((_, i) => i !== drop);
    await solveByTapping(page, { ...level, threads: [{ ...level.threads[0], sol: sub }] });
    if (await isSolved(page)) continue;
    badge = (await page.locator('.matchbadge').textContent()) ?? '';
  }
  // A rule level has no picture to be near, so a percentage there would be a
  // number about nothing. It counts the marks it got on the right side.
  expect(badge).toMatch(/\d+ of \d+/);
});

test('a wire board draws its lattice and its numbers, and follows the wires', async ({ page }) => {
  const level = await openLevel(page, 'wire', 'q-1-1');
  expect(await page.locator('.wire').count()).toBeGreaterThan(8);
  expect(await page.locator('.clue').count()).toBeGreaterThan(2);
  await expect(page.locator('.hud .ask')).toContainText('how many of its cell');
  // Same as a corral: the loop's region is the answer, so it is not shaded.
  const ghost = page.locator('.target-ghost').first();
  expect(Number(await ghost.getAttribute('fill-opacity'))).toBe(0);
  expect(Number(await ghost.getAttribute('stroke-opacity'))).toBe(0);

  // A move off the wires is refused, by name. Take the pair from the board's
  // own wire list rather than assuming how the lattice is numbered.
  const wired = (a: number, b: number) =>
    level.wires.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  let pair: [number, number] | null = null;
  for (let a = 0; a < level.pegs.length && !pair; a++) {
    for (let b = a + 1; b < level.pegs.length && !pair; b++) if (!wired(a, b)) pair = [a, b];
  }
  expect(pair, 'every pair of pegs is wired — nothing to refuse').not.toBeNull();
  const at = await pointMapper(page);
  await tap(page, at(level.pegs[pair![0]]));
  await tap(page, at(level.pegs[pair![1]]));
  await expect(page.locator('.toast')).toContainText('follows the wires');

  await openLevel(page, 'wire', 'q-1-1');
  await solveByTapping(page, level);
  expect(await isSolved(page), `${level.id} was not solved`).toBe(true);
});

test('a clue dims once it is satisfied', async ({ page }) => {
  const level = await openLevel(page, 'wire', 'q-1-1');
  const before = await page.locator('.clue').evaluateAll(
    (ns) => ns.map((n) => n.getAttribute('opacity')),
  );
  await solveByTapping(page, level);
  const after = await page.locator('.clue').evaluateAll(
    (ns) => ns.map((n) => n.getAttribute('opacity')),
  );
  expect(after).not.toEqual(before);
  // Every clue is met by the answer, so every one of them has stepped back.
  expect(after.every((o) => o === '0.3')).toBe(true);
});

test('every new mode appears on the home screen with its own colour', async ({ page }) => {
  await gotoApp(page);
  for (const id of ['shadow', 'par', 'corral', 'wire']) {
    const card = page.locator(`[data-card="${id}"]`);
    await expect(card).toBeVisible();
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  }
  const seen = await readCurrent(page).catch(() => null);
  void seen;
});
