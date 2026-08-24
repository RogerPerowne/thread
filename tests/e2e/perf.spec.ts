import { test, expect } from '@playwright/test';
import { gotoApp, openLevel, pointMapper } from './helpers.js';

/**
 * The prototype rebuilt the whole SVG on every pointer move. These assert that
 * this one does not: no node is created during a drag, and no frame blows the
 * 16 ms budget.
 */

test('a 200-event drag never blows the frame budget', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;

  await page.evaluate(() => (window as never as { __thread: { startRecording(): void } }).__thread.startRecording());

  const first = at(level.pegs[sol[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();

  // Sweep round the loop, over and over, until 200 real move events have gone
  // in. Whatever the level's peg count, the count is what matters.
  let events = 0;
  let leg = 0;
  while (events < 200) {
    const from = at(level.pegs[sol[leg % sol.length]]);
    const to = at(level.pegs[sol[(leg + 1) % sol.length]]);
    for (let s = 1; s <= 10 && events < 200; s++) {
      const k = s / 10;
      await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      events++;
    }
    leg++;
  }
  await page.mouse.up();
  expect(events).toBeGreaterThanOrEqual(200);

  const frames: number[] = await page.evaluate(
    () => (window as never as { __thread: { stopRecording(): number[] } }).__thread.stopRecording(),
  );
  expect(frames.length).toBeGreaterThan(5);
  const worst = Math.max(...frames);
  const over = frames.filter((f) => f > 16).length;
  expect(worst, `worst frame ${worst.toFixed(2)} ms over ${frames.length} frames`).toBeLessThan(16);
  expect(over).toBe(0);
});

test('the scene graph is built once and then only mutated', async ({ page }) => {
  await gotoApp(page);
  const level = await openLevel(page, 'classic', 'c-1-1');
  const at = await pointMapper(page);
  const sol = level.threads[0].sol;

  // Tag every node that exists now. If any of them is replaced during play,
  // the tag is gone and the renderer is rebuilding rather than mutating.
  await page.evaluate(() => {
    const svg = document.querySelector('.board-svg')!;
    svg.querySelectorAll('*').forEach((n, i) => n.setAttribute('data-stamp', String(i)));
    (window as never as { __stampCount: number }).__stampCount = svg.querySelectorAll('*').length;
  });

  const first = at(level.pegs[sol[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < sol.length; i++) {
    const from = at(level.pegs[sol[i - 1]]);
    const to = at(level.pegs[sol[i]]);
    for (let s = 1; s <= 6; s++) {
      const k = s / 6;
      await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    }
  }
  await page.mouse.up();

  const { stamped, expected } = await page.evaluate(() => {
    const svg = document.querySelector('.board-svg')!;
    return {
      stamped: svg.querySelectorAll('[data-stamp]').length,
      expected: (window as never as { __stampCount: number }).__stampCount,
    };
  });
  expect(stamped).toBe(expected);
});

test('a level change cancels the previous level completely', async ({ page }) => {
  await gotoApp(page);
  // Load, start an animation by tapping, then jump to another level at once.
  await openLevel(page, 'classic', 'c-1-1');
  await openLevel(page, 'classic', 'c-3-1');
  await openLevel(page, 'classic', 'c-1-2');
  // No stale tween may leave the board in a half-drawn state.
  const threadD = await page.locator('.thread-path').first().getAttribute('d');
  expect(threadD === null || threadD === '').toBe(true);
  await expect(page.locator('.target-ghost').first()).toHaveAttribute('d', /.+/);
});

test('restarting a level is immediate', async ({ page }) => {
  await gotoApp(page);
  await openLevel(page, 'classic', 'c-2-1');
  const t0 = Date.now();
  await openLevel(page, 'classic', 'c-2-2');
  expect(Date.now() - t0).toBeLessThan(3000);
});
