import { test, expect } from '@playwright/test';
import {
  gotoApp, openBoard, solveByDragging, dragStrand, isSolved, pointMapper,
  findTightestTurn,
} from './helpers.js';

const MODES = ['classic', 'coloured', 'grid'] as const;

test('home is the masthead and one card per mode', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.wordmark')).toHaveText('THREAD');
  await expect(page.locator('.gamecard')).toHaveCount(3);
  for (const m of MODES) await expect(page.locator(`[data-card="${m}"]`)).toBeVisible();
});

test('a mode opens its chapters, and a chapter opens its path', async ({ page }) => {
  await gotoApp(page);
  await page.locator('[data-card="classic"]').click();
  await expect(page.locator('.gamecard')).toHaveCount(6);
  await page.locator('[data-card="chapter-1"]').click();
  // The path screen draws one isometric tile per level.
  await expect(page.locator('.ptile')).toHaveCount(10);
});

test('the chapters get bigger as you go', async ({ page }) => {
  await gotoApp(page, '#/p/classic/1');
  const first = await page.evaluate(
    () => (window as never as { __thread: { board(): { posts: unknown[] } } }).__thread.board().posts.length,
  );
  await page.goto('/#/p/classic/60');
  await page.waitForSelector('.board-svg');
  const last = await page.evaluate(
    () => (window as never as { __thread: { board(): { posts: unknown[] } } }).__thread.board().posts.length,
  );
  expect(last).toBeGreaterThan(first * 2);
});

/*
 * Every shipped board, solved by real drags, a chapter at a time.
 *
 * A chapter each rather than a mode each: eighty grid boards of up to twelve
 * strings is several minutes of pointer events in one test, and a test that
 * fails by timing out tells you nothing about which board broke.
 */
const CHAPTERS: Record<string, number> = { classic: 6, coloured: 5, grid: 8 };
const PER_CHAPTER = 10;

for (const mode of MODES) {
  for (let chapter = 1; chapter <= CHAPTERS[mode]; chapter++) {
    test(`every ${mode} board in chapter ${chapter} is solvable by dragging`, async ({ page }) => {
      const first = (chapter - 1) * PER_CHAPTER + 1;
      for (let n = first; n < first + PER_CHAPTER; n++) {
        const board = await openBoard(page, mode, n);
        await solveByDragging(page, board);
        expect(await isSolved(page), `${mode} ${n} (${board.id}) was not solved`).toBe(true);
      }
    });
  }
}

test('every shipped board can be reached and solved', async ({ page }) => {
  // The per-chapter tests cover the boards; this covers the count, so a
  // chapter quietly losing boards cannot pass by not being looked at.
  await gotoApp(page);
  const counts = await page.evaluate(
    () => (window as never as { __thread: { counts(): Record<string, number> } }).__thread.counts(),
  );
  for (const mode of MODES) {
    expect(counts[mode], `${mode} has the wrong number of boards`)
      .toBe(CHAPTERS[mode] * PER_CHAPTER);
  }
});

test('an unfinished board is never shown as a broken one', async ({ page }) => {
  const board = await openBoard(page, 'coloured', 1);
  const note = page.locator('.hud .ask');

  /*
   * Half a string laid, nothing wrong with it. This used to go red and say
   * "each string has to join its own two ends" — true, and true of every board
   * from the moment it opens until the moment it is solved, so the board was
   * red for the whole game and the warning could never be seen to go. That is
   * what "warnings don't disappear" looks like from the player's chair.
   */
  await dragStrand(page, board, board.solution[0].slice(0, 2));
  await expect(note).not.toHaveClass(/bad/);
  expect((await note.textContent()) ?? '').toMatch(/to go|Join/);

  await solveByDragging(page, board);
  await expect(note).toHaveText('Solved');
  await expect(note).not.toHaveClass(/bad/);
});

test('the string may go back on itself as sharply as it likes', async ({ page }) => {
  /*
   * A turn used to be refused for being under 55 degrees, then under 29. Both
   * were rules against something a string round a nail is entitled to do, and
   * both produced a warning the player could not act on because the picture
   * looked fine. There is no angle rule left: the tightest turn each board
   * allows is whatever its own geometry allows, and it is never a fault.
   */
  const found = await findTightestTurn(page);
  expect(found.degrees, 'no board offers a turn under 55 degrees to try').toBeLessThan(55);
  await dragStrand(page, found.board, found.turn);
  const note = page.locator('.hud .ask');
  await expect(note).not.toHaveClass(/bad/);
});

test('the string can be grabbed in the middle, and the rest joins back on', async ({ page }) => {
  const board = await openBoard(page, 'classic', 20);
  const path = board.solution[0];
  await solveByDragging(page, board);
  expect(await isSolved(page)).toBe(true);

  // Grab a post in the middle of the string and pull it off its route. What
  // was past it should still be there, not wiped.
  const at = await pointMapper(page);
  const mid = Math.floor(path.length / 2);
  const from = at(board.posts[path[mid]]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 4, { steps: 3 });
  await page.mouse.up();
  // Letting go where we started puts the string back exactly as it was, tail
  // and all, rather than leaving half a string behind.
  await expect(page.locator('.hud .num')).toContainText(`${board.posts.length} of ${board.posts.length}`);
});

test('dragging back over the last post takes it back', async ({ page }) => {
  const board = await openBoard(page, 'classic', 1);
  const path = board.solution[0];
  await dragStrand(page, board, path.slice(0, 4));
  await expect(page.locator('.hud .num')).toContainText('4 of');
  await dragStrand(page, board, [path[3], path[2]]);
  await expect(page.locator('.hud .num')).toContainText('3 of');
});

test('Clear empties the board and Undo puts it back', async ({ page }) => {
  const board = await openBoard(page, 'classic', 2);
  await dragStrand(page, board, board.solution[0].slice(0, 5));
  await expect(page.locator('.hud .num')).toContainText('5 of');
  await page.locator('.pill', { hasText: 'Clear' }).click();
  await expect(page.locator('.hud .num')).toContainText('0 of');
  await page.locator('.pill', { hasText: 'Undo' }).click();
  await expect(page.locator('.hud .num')).toContainText('5 of');
});

test('a solve is remembered across a reload', async ({ page }) => {
  const board = await openBoard(page, 'grid', 1);
  await solveByDragging(page, board);
  expect(await isSolved(page)).toBe(true);
  await page.goto('/#/c/grid/1');
  await page.waitForSelector('.ptile');
  await expect(page.locator('.ptile.done')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.ptile.done')).toHaveCount(1);
});

test('the board can be played with the keyboard alone', async ({ page }) => {
  await openBoard(page, 'classic', 1);
  await page.locator('.board-svg').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hud .num')).toContainText('1 of');
});

test('the board never draws outside its own surface', async ({ page }) => {
  /*
   * The top and bottom rows were being shaved off. The window was a fixed
   * 8..92, and posts are shaken off their lattice by up to 3.5 — so they
   * reach 7.35, and around a pinned one there is another ring of DRAW_R on
   * top of that. Rather than assert the numbers, this asks the browser what
   * it actually painted and where the surface actually is.
   */
  for (const [mode, n] of [['classic', 51], ['coloured', 1], ['grid', 44]] as const) {
    await openBoard(page, mode, n);
    const bleed = await page.evaluate(() => {
      const svg = document.querySelector('.board-svg') as SVGSVGElement;
      const r = svg.getBoundingClientRect();
      let worst = 0;
      for (const el of svg.querySelectorAll('circle, rect, path')) {
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        worst = Math.max(worst, r.top - b.top, b.bottom - r.bottom,
          r.left - b.left, b.right - r.right);
      }
      return worst;
    });
    expect(bleed, `${mode} ${n} paints outside its surface`).toBeLessThanOrEqual(0.5);
  }
});

test('a fast sweep does not skip posts', async ({ page }) => {
  /*
   * One pointer move per post, with no interpolation from the harness — which
   * is what a quick finger looks like, and what used to lose the posts in
   * between. The whole answer has to go down in a single gesture.
   */
  const board = await openBoard(page, 'classic', 51);
  const at = await pointMapper(page);
  const path = board.solution[0];
  const first = at(board.posts[path[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of path.slice(1)) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y);
  }
  await page.mouse.up();
  expect(await isSolved(page), 'a coarse sweep of the answer did not solve it').toBe(true);
});

test('going back several posts takes them off, and shows them going', async ({ page }) => {
  const board = await openBoard(page, 'classic', 51);
  const at = await pointMapper(page);
  const path = board.solution[0];
  const first = at(board.posts[path[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of path.slice(1, 8)) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y, { steps: 4 });
  }
  await expect(page.locator('.hud .num')).toContainText(`8 of ${board.posts.length}`);

  // Straight back to the third post, skipping four. Reversing over every post
  // in turn is precision a thumb on a moving board cannot deliver.
  const back = at(board.posts[path[2]]);
  await page.mouse.move(back.x, back.y, { steps: 3 });
  const recoiling = await page.locator('.recoil.go').count();
  await page.mouse.up();
  await expect(page.locator('.hud .num')).toContainText(`3 of ${board.posts.length}`);
  expect(recoiling, 'nothing was drawn coming back off').toBeGreaterThan(0);
});

test('a post there is no way to reach says so', async ({ page }) => {
  const board = await openBoard(page, 'classic', 51);
  const at = await pointMapper(page);
  const found = await page.evaluate(() => {
    const t = (window as never as {
      __thread: {
        board(): { posts: [number, number][]; solution: number[][] };
        runIsLegal(a: number, b: number): boolean;
      };
    }).__thread;
    const bd = t.board();
    const sol = bd.solution[0];
    for (let k = 1; k < 6; k++) {
      for (let q = 0; q < bd.posts.length; q++) {
        if (sol.slice(0, k + 1).includes(q) || t.runIsLegal(sol[k], q)) continue;
        return { seq: sol.slice(0, k + 1), q };
      }
    }
    return null;
  });
  expect(found, 'this board has no unreachable post to try').not.toBeNull();

  const first = at(board.posts[found!.seq[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of found!.seq.slice(1)) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y, { steps: 4 });
  }
  const target = at(board.posts[found!.q]);
  await page.mouse.move(target.x, target.y, { steps: 6 });
  // The string you have laid pulses — nothing happening is exactly what a
  // missed touch looks like, so it has to be told apart from one.
  await expect(page.locator('.post.refused')).toHaveCount(found!.seq.length);
  await page.mouse.up();
});

test('an overlap warning goes when the overlap does', async ({ page }) => {
  /*
   * The warning was right and the player could not act on it. Dragging the
   * offending run off worked, and then letting go laid it straight back —
   * everything past the point you grabbed used to wait in a hidden tail and
   * rejoin on release whether or not it still fitted. There is no tail now,
   * and this is the test that says so.
   */
  const board = await openBoard(page, 'coloured', 3);
  const at = await pointMapper(page);
  const drag = async (seq: number[]) => {
    const f = at(board.posts[seq[0]]);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    for (const p of seq.slice(1)) {
      const q = at(board.posts[p]);
      await page.mouse.move(q.x, q.y, { steps: 6 });
    }
    await page.mouse.up();
  };
  const note = page.locator('.hud .ask');

  await drag(board.solution[0]);
  const cross = await page.evaluate(() => {
    const t = (window as never as {
      __thread: {
        board(): { posts: [number, number][]; solution: number[][] };
        runIsLegal(a: number, b: number): boolean;
        runsTouch(a: number, b: number, x: number, y: number): boolean;
      };
    }).__thread;
    const bd = t.board();
    const other = bd.solution[0];
    const start = bd.solution[1][0];
    const hits = (a: number, b: number) => other.some(
      (p, i) => i + 1 < other.length && t.runsTouch(a, b, p, other[i + 1]),
    );
    for (let q = 0; q < bd.posts.length; q++) {
      if (other.includes(q) || q === start || !t.runIsLegal(start, q)) continue;
      if (!hits(start, q)) continue;
      // And one more post past it, so the bad run sits in the middle of the
      // string and what follows it becomes the waiting tail.
      for (let r = 0; r < bd.posts.length; r++) {
        if (other.includes(r) || r === q || r === start || !t.runIsLegal(q, r)) continue;
        return [start, q, r];
      }
      return [start, q];
    }
    return null;
  });
  expect(cross, 'this board offers no way to cross the other string').not.toBeNull();
  await drag(cross!);
  await expect(note).toHaveClass(/bad/);
  await expect(note).toContainText('lying on each other');

  // Take the bad run back off by pointing at the post before it. Nothing may
  // put it back: what is on screen is the whole state, so letting go cannot
  // quietly re-lay the run that was the problem.
  const home = at(board.posts[cross![0]]);
  await page.mouse.move(home.x, home.y);
  await page.mouse.down();
  await page.mouse.up();

  await expect(note).not.toHaveClass(/bad/);
  await expect(page.locator('.clash[opacity="1"]')).toHaveCount(0);
});

test('a board can be solved by tapping alone', async ({ page }) => {
  /*
   * Dragging is fast, and it is also a hand held over the board you are trying
   * to read — on a thirty-post board, held for a long time. Tapping has to be
   * a real way to play, not a fallback, or the game is only playable in the
   * one posture.
   */
  const board = await openBoard(page, 'classic', 20);
  const at = await pointMapper(page);
  for (const p of board.solution[0]) {
    const q = at(board.posts[p]);
    await page.mouse.move(q.x, q.y);
    await page.mouse.down();
    await page.mouse.up();
  }
  expect(await isSolved(page), 'tapping the answer post by post did not solve it').toBe(true);
});

test('tapping a post already on the string winds back to it', async ({ page }) => {
  const board = await openBoard(page, 'classic', 20);
  const at = await pointMapper(page);
  const path = board.solution[0];
  await dragStrand(page, board, path.slice(0, 7));
  await expect(page.locator('.hud .num')).toContainText(`7 of ${board.posts.length}`);

  // Going back is the same gesture as going forward, so it is one tap.
  const back = at(board.posts[path[2]]);
  await page.mouse.move(back.x, back.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('.hud .num')).toContainText(`3 of ${board.posts.length}`);
});

test('pressing and letting go without moving changes nothing', async ({ page }) => {
  /*
   * A press has to be harmless, or a player cannot poke at the board — and
   * poking at it without fear is most of what makes one of these hard to put
   * down. Pressing the middle of a string used to take everything past it off
   * the board and hold it in a hidden tail.
   */
  const board = await openBoard(page, 'classic', 20);
  const at = await pointMapper(page);
  const path = board.solution[0];
  await dragStrand(page, board, path);
  const before = await page.locator('.hud .num').textContent();

  const mid = at(board.posts[path[Math.floor(path.length / 2)]]);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 1, mid.y + 1);
  await page.mouse.up();
  expect(await page.locator('.hud .num').textContent()).toBe(before);
});

test('every string on a board has a colour of its own', async ({ page }) => {
  /*
   * On a Coloured or Grid board the ends are the whole instruction. Two
   * strings the same colour is two strings nobody can pair up, and the biggest
   * lattice ships twelve of them — which is exactly why the palette is what
   * limits how large a lattice can get.
   */
  for (const [mode, n] of [['grid', 80], ['grid', 71], ['coloured', 50]] as const) {
    const board = await openBoard(page, mode, n);
    const inks = new Set(board.strands.map((s) => s.color));
    expect(inks.size, `${mode} ${n} has ${board.strands.length} strings sharing colours`)
      .toBe(board.strands.length);
    // And the ends have to actually wear it, not just carry it in the data.
    const painted = await page.evaluate(() => {
      const ends = [...document.querySelectorAll('.post.end')];
      return ends.map((e) => getComputedStyle(e).fill);
    });
    expect(new Set(painted).size).toBe(inks.size);
  }
});

test('a string can be built from both ends and joined in the middle', async ({ page }) => {
  /*
   * Working inwards from both pinned ends is how anyone actually solves a long
   * string, and with one path per strand it was impossible: starting at the
   * far end either did nothing or ran the string you were holding into
   * somebody else's anchor.
   */
  const board = await openBoard(page, 'coloured', 12);
  const answer = board.solution[0];
  const half = Math.floor(answer.length / 2);

  // From the start, part way.
  await dragStrand(page, board, answer.slice(0, half));
  // From the far end, backwards, until it reaches where the first part stops.
  await dragStrand(page, board, [...answer.slice(half - 1)].reverse());

  // Two pieces of one string, now joined: one drawn path, the whole answer.
  const drawn = await page.evaluate(
    () => [...document.querySelectorAll('.string')].map((p) => p.getAttribute('d')).filter(Boolean),
  );
  expect(drawn.length, 'the two halves did not become one string').toBe(1);
  await expect(page.locator('.hud .num')).toContainText(`${answer.length} of`);
});

test('changing a bit in the middle keeps the rest, and rejoins it', async ({ page }) => {
  /*
   * The distinction the player never has to make: a tap on a post ends the
   * string there, a DRAG from the same post keeps what is past it standing on
   * the board, ready to join back on. Nobody is asked which they meant — the
   * difference is whether they went anywhere.
   */
  const board = await openBoard(page, 'coloured', 20);
  const at = await pointMapper(page);
  const answer = board.solution[0];
  await dragStrand(page, board, answer);
  await expect(page.locator('.hud .num')).toContainText(`${answer.length} of`);

  // Grab the middle and pull it back off its route. What is past it must still
  // be on the board — two pieces now, not one string and a lost half.
  const mid = Math.floor(answer.length / 2);
  const from = at(board.posts[answer[mid]]);
  const away = at(board.posts[answer[mid - 1]]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(away.x, away.y, { steps: 8 });
  const pieces = () => page.evaluate(
    () => [...document.querySelectorAll('.string')].map((p) => p.getAttribute('d')).filter(Boolean).length,
  );
  expect(await pieces(), 'the far part of the string was thrown away').toBeGreaterThan(1);

  // Go back the way we came. Reaching the kept part is what joins them — the
  // same rule as everywhere else, so nothing snaps together behind your back.
  await page.mouse.move(from.x, from.y, { steps: 8 });
  const meet = at(board.posts[answer[mid + 1]]);
  await page.mouse.move(meet.x, meet.y, { steps: 8 });
  await page.mouse.up();
  expect(await pieces(), 'the two pieces did not join back up').toBe(1);
  await expect(page.locator('.hud .num')).toContainText(`${answer.length} of`);
});
