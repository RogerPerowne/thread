import type { Page } from '@playwright/test';

/**
 * Every helper here drives the game through REAL pointer events. Solving a
 * board by calling into the app would prove the rules work and nothing at all
 * about whether the game is PLAYABLE, and those are different questions. The
 * window hook is read-only: it says where the posts are, as a player's eyes
 * would.
 */

export type Strand = { from: number; to: number; color: string };

export type Board = {
  id: string;
  mode: 'classic' | 'coloured' | 'grid';
  posts: [number, number][];
  blocks: { x: number; y: number; w: number; h: number }[];
  strands: Strand[];
  solution: number[][];
};

export async function gotoApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => Boolean((window as never as { __thread?: unknown }).__thread));
}

/** Open one board and read it back. */
export async function openBoard(page: Page, mode: string, n: number): Promise<Board> {
  const want = `#/p/${mode}/${n}`;
  // A goto that only changes the fragment is a same-document navigation and
  // would not re-run the app, so returning to the board we are on needs a real
  // reload.
  if (page.url().endsWith(want)) await page.reload();
  else await page.goto(`/${want}`);
  await page.waitForFunction(() => Boolean((window as never as { __thread?: unknown }).__thread));
  await page.waitForSelector('.board-svg');
  return readBoard(page);
}

/** The board's own record of itself, straight off the read-only hook. */
export async function readBoard(page: Page): Promise<Board> {
  return page.evaluate(
    () => (window as never as { __thread: { board(): unknown } }).__thread.board() as never,
  );
}

export async function solvedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as never as { __thread: { solved(): string[] } }).__thread.solved());
}

/**
 * Board space to viewport pixels, via the SVG's own square.
 *
 * The window is read off the drawn element rather than copied from the source.
 * It used to be two constants here that had to match `VIEW` in core/board.ts,
 * with a comment saying so — and the moment the window became each board's own
 * extent, constants like that would have had the harness tapping somewhere no
 * player ever taps, while still passing. Asking the page where it is looking
 * is the only version that cannot drift.
 */
export async function pointMapper(page: Page): Promise<(p: [number, number]) => { x: number; y: number }> {
  const svg = page.locator('.board-svg').first();
  const box = await svg.boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const vb = (await svg.getAttribute('viewBox'))?.split(/\s+/).map(Number);
  if (!vb || vb.length !== 4) throw new Error('the board has no viewBox');
  const [vx, vy, vw] = vb;
  const side = Math.min(box.width, box.height);
  const ox = box.x + (box.width - side) / 2;
  const oy = box.y + (box.height - side) / 2;
  return (p) => ({
    x: ox + ((p[0] - vx) / vw) * side,
    y: oy + ((p[1] - vy) / vw) * side,
  });
}

/**
 * Lay one string the way a thumb would: press its first post, sweep through
 * every post in turn, let go. The sweep is stepped so the app sees a run of
 * moves rather than one jump, which is what a real drag looks like.
 */
export async function dragStrand(
  page: Page, board: Board, path: number[], steps = 3,
): Promise<void> {
  const at = await pointMapper(page);
  const first = at(board.posts[path[0]]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < path.length; i++) {
    const from = at(board.posts[path[i - 1]]);
    const to = at(board.posts[path[i]]);
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    }
  }
  await page.mouse.up();
}

/** Lay every string of the board's own answer. */
export async function solveByDragging(page: Page, board: Board): Promise<void> {
  for (const path of board.solution) await dragStrand(page, board, path);
}

export async function isSolved(page: Page): Promise<boolean> {
  return page.locator('.screen.play.won').count().then((n) => n > 0);
}

/**
 * The tightest turn any shipped board will let a thumb make.
 *
 * A test that hard-codes three post numbers breaks the next time the boards
 * are built, and worse, quietly stops testing what it claims to. So the turn
 * is found by looking — and it has to be a move a THUMB could make, not just a
 * shape the geometry allows: a string can only be started at one of its pinned
 * ends, so the route runs along the board's own answer as far as some post and
 * then turns off it. That is why this returns a whole path.
 */
export async function findTightestTurn(
  page: Page,
): Promise<{ board: Board; turn: number[]; degrees: number }> {
  let best: { board: Board; turn: number[]; degrees: number } | null = null;
  for (const n of [20, 6, 35, 50, 12, 44, 55, 28, 60, 3]) {
    const board = await openBoard(page, 'classic', n);
    const found = await page.evaluate(() => {
      const t = (window as never as {
        __thread: {
          board(): { posts: [number, number][]; solution: number[][] };
          runIsLegal(a: number, b: number): boolean;
        };
      }).__thread;
      const bd = t.board();
      const P = bd.posts;
      const answer = bd.solution[0];
      const angle = (p: number[], m: number[], q: number[]) => {
        const ax = p[0] - m[0], ay = p[1] - m[1], bx = q[0] - m[0], by = q[1] - m[1];
        const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
        return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      };
      let tightest: { turn: number[]; degrees: number } | null = null;
      for (let k = 1; k < answer.length; k++) {
        const prev = answer[k - 1];
        const head = answer[k];
        const sofar = answer.slice(0, k + 1);
        for (let q = 0; q < P.length; q++) {
          if (sofar.includes(q) || !t.runIsLegal(head, q)) continue;
          const a = angle(P[prev], P[head], P[q]);
          if (!tightest || a < tightest.degrees) tightest = { turn: [...sofar, q], degrees: a };
        }
      }
      return tightest;
    });
    if (found && (!best || found.degrees < best.degrees)) {
      best = { board, turn: found.turn, degrees: found.degrees };
    }
    if (best && best.degrees < 40) break;
  }
  if (!best) throw new Error('no shipped board offers a turn off its own answer');
  // Re-open the board the winner came from, so the caller can drive it.
  best.board = await openBoard(page, 'classic', Number(best.board.id.split('-')[1]));
  return best;
}
