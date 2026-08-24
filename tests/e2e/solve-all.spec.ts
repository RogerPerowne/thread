import { test, expect } from '@playwright/test';
import { gotoApp, openLevel, solveByTapping, solveByDragging, isSolved, readCurrent } from './helpers.js';

/**
 * The acceptance test: every level that ships is solved through real pointer
 * events. Solving via internal APIs would not catch interaction bugs, and
 * interaction bugs are the ones that make a level feel impossible.
 */

type Ids = { classic: string[]; weave: string[]; assess: string[] };

async function allIds(page: import('@playwright/test').Page): Promise<Ids> {
  await gotoApp(page);
  return page.evaluate(() => (window as never as { __thread: { levelIds(): Ids } }).__thread.levelIds());
}

// Split the campaign across a few test cases so a failure names a chapter
// rather than "everything", and so the suite parallelises.
const SHARDS = 6;

for (let shard = 0; shard < SHARDS; shard++) {
  test(`every classic level is solvable by hand — shard ${shard + 1}/${SHARDS}`, async ({ page }) => {
    const ids = await allIds(page);
    const mine = ids.classic.filter((_, i) => i % SHARDS === shard);
    expect(mine.length).toBeGreaterThan(0);

    for (const id of mine) {
      const level = await openLevel(page, 'classic', id);
      await solveByTapping(page, level);
      const solved = await isSolved(page);
      if (!solved) {
        const c = await readCurrent(page);
        throw new Error(`${id} was not solved by the natural gesture (best match ${c.lastMiss ?? 'n/a'})`);
      }
    }
  });
}

test('every weave level is solvable by hand', async ({ page }) => {
  const ids = await allIds(page);
  for (const id of ids.weave) {
    const level = await openLevel(page, 'weave', id);
    await solveByTapping(page, level);
    expect(await isSolved(page), `${id} was not solved`).toBe(true);
  }
});

test('every assessment item is solvable by hand', async ({ page }) => {
  const ids = await allIds(page);
  for (const id of ids.assess) {
    const level = await openLevel(page, 'classic', id);
    await solveByTapping(page, level);
    expect(await isSolved(page), `${id} was not solved`).toBe(true);
  }
});

test('the first level of every classic chapter is solvable by DRAGGING', async ({ page }) => {
  const ids = await allIds(page);
  // ids are c-<chapter>-<n>; take the first of each chapter.
  const firsts = ids.classic.filter((id) => /-1$/.test(id));
  expect(firsts.length).toBeGreaterThanOrEqual(10);

  for (const id of firsts) {
    const level = await openLevel(page, 'classic', id);
    await solveByDragging(page, level);
    if (!(await isSolved(page))) {
      // A weave still needs its crossings set after the loops are laid.
      if (level.weave) {
        await solveByTapping(page, level);
      }
    }
    expect(await isSolved(page), `${id} was not solved by dragging`).toBe(true);
  }
});
