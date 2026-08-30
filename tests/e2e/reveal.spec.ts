import { test, expect } from '@playwright/test';
import { gotoApp, openPuzzle, puzzleIds, isSolved, noteOf, control } from './helpers.js';

/**
 * The way out of a board nobody can finish, on every game there is.
 *
 * The control belongs to the platform and knows nothing about any board, so
 * what is being checked here is the part the shell is responsible for: that it
 * asks first, that the answer arrives under the light rather than instead of
 * it, and — the one that matters — that a revealed board is not written down
 * as a solve. A Reveal that quietly kept a streak alive would be a streak that
 * means nothing.
 */
const GAMES = ['thread', 'zigzag', 'nine', 'shape', 'hex', 'isolate'];

const record = (page: import('@playwright/test').Page) => page.evaluate(
  () => JSON.parse(localStorage.getItem('puzzles.v1') ?? '{"games":{}}') as {
    games: Record<string, { done: Record<string, unknown>; going: Record<string, unknown> }>;
  },
);

test.describe('showing the answer', () => {
  for (const game of GAMES) {
    test(`${game} fills its board in and is not counted as solved`, async ({ page }) => {
      await gotoApp(page);
      const id = (await puzzleIds(page, game))[0];
      await openPuzzle(page, game, id);

      await control(page, 'Reveal').click();
      await expect(page.locator('.sheet')).toContainText('Cannot solve it?');
      await page.locator('.sheet .btn', { hasText: 'Show me the answer' }).click();

      /* The light crosses the board and the answer is written in under it. */
      await expect(noteOf(page)).toHaveText('The answer', { timeout: 5000 });
      await expect(page.locator('.sweep')).toHaveCount(0);

      /* Solved by the rules, and not by the record. `won` is the class the
         frame adds when it FINISHES a board, which this never does. */
      expect(await isSolved(page), `${game} counted a reveal as a solve`).toBe(false);
      const rec = (await record(page)).games[game] ?? { done: {}, going: {} };
      expect(Object.keys(rec.done), `${game} wrote a revealed board to the history`).toEqual([]);
      expect(Object.keys(rec.going), `${game} left the answer lying about as progress`).toEqual([]);

      /* The board is full: Reveal has nothing left to do and Next is offered. */
      await expect(control(page, 'Reveal')).toBeDisabled();
      await expect(control(page, 'Next')).toBeVisible();

      /* And it is not a one-way door: undo takes the answer back off and the
         board goes back to saying what is left to do, because it is. The
         record stays shut, though — a board that has been shown has been
         shown, and no amount of undoing unsees it. */
      await control(page, 'Undo').click();
      await expect(noteOf(page)).not.toHaveText('The answer');
      await expect(control(page, 'Reveal')).toBeEnabled();
      expect(Object.keys((await record(page)).games[game]?.done ?? {})).toEqual([]);
    });
  }
});

test('asking and then thinking better of it leaves the board alone', async ({ page }) => {
  await gotoApp(page);
  const id = (await puzzleIds(page, 'shape'))[0];
  await openPuzzle(page, 'shape', id);

  await control(page, 'Reveal').click();
  await page.locator('.sheet .btn', { hasText: 'Keep trying' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);

  const cells = await page.evaluate(
    () => (window.__puzzles.board() as { cells(): number[] }).cells(),
  );
  expect(cells.every((v) => v === -1), 'the board answered a question nobody asked').toBe(true);
  await expect(control(page, 'Reveal')).toBeEnabled();
});


test('the row of five keeps its words down to the narrowest phone but one', async ({ page }) => {
  /*
   * Five slots is one more than the row used to carry, so this is the place it
   * could have gone wrong. The slots are equal width, so what has to fit is
   * five of the widest button; below 319 the word would truncate rather than
   * shrink, and a whole glyph beats "Restar…". Only the 320 gets there.
   */
  const shape = async (w: number, h: number) => {
    await page.setViewportSize({ width: w, height: h });
    await gotoApp(page);
    const id = (await puzzleIds(page, 'shape'))[0];
    await openPuzzle(page, 'shape', id);
    return page.locator('.controls .btn:not([hidden])').evaluateAll((els) => els.map((e) => ({
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
      word: (e.querySelector('span') as HTMLElement | null)?.offsetParent !== null,
      glyph: (e.querySelector('svg') as SVGElement | null) !== null
        && getComputedStyle(e.querySelector('svg')!).display !== 'none',
      name: e.getAttribute('aria-label') ?? '',
    })));
  };

  for (const [w, h, words] of [[320, 568, false], [375, 667, true], [430, 932, true]] as const) {
    const btns = await shape(w, h);
    expect(btns, `${w}px has the wrong number of controls`).toHaveLength(5);
    const widths = new Set(btns.map((b) => Math.round(b.width)));
    expect(widths.size, `${w}px gives its controls different widths`).toBe(1);
    for (const b of btns) {
      expect(b.height, `${b.name} is under a thumb at ${w}px`).toBeGreaterThanOrEqual(44);
      expect(b.width, `${b.name} is under a thumb at ${w}px`).toBeGreaterThanOrEqual(44);
      /* One of the two, always. A button with neither is a blank square. */
      expect(b.word || b.glyph, `${b.name} says nothing at ${w}px`).toBe(true);
      expect(b.word, `${b.name} at ${w}px`).toBe(words);
      expect(b.glyph, `${b.name} at ${w}px`).toBe(!words);
      /* And a name for a screen reader either way. */
      expect(b.name.length).toBeGreaterThan(3);
    }
  }
});
