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
 * The board is drawn through a cropped viewBox rather than the full 0..100
 * square — posts sit inside a margin, and showing that margin wastes a fifth
 * of a phone screen. These two numbers have to match `VIEW` in core/board.ts,
 * or the harness taps somewhere the player would not.
 */
const VIEW_AT = 8;
const VIEW_SIDE = 84;

export async function pointMapper(page: Page): Promise<(p: [number, number]) => { x: number; y: number }> {
  const box = await page.locator('.board-svg').first().boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const side = Math.min(box.width, box.height);
  const ox = box.x + (box.width - side) / 2;
  const oy = box.y + (box.height - side) / 2;
  return (p) => ({
    x: ox + ((p[0] - VIEW_AT) / VIEW_SIDE) * side,
    y: oy + ((p[1] - VIEW_AT) / VIEW_SIDE) * side,
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
 * Hunt the shipped boards for a turn the player can actually make.
 *
 * A test that hard-codes three post numbers is a test that breaks the next
 * time the boards are rebuilt, and worse, one that stops testing what it
 * claims to. So the turn is found by looking.
 *
 * It has to be a move a THUMB could make, not just a shape the geometry
 * allows: a string can only be started at one of its pinned ends, so the route
 * runs along the board's own answer as far as some post and then turns off it
 * by the angle we are after. That is why this returns a whole path rather than
 * three posts.
 */
async function turnBetween(
  page: Page, lo: number, hi: number,
): Promise<{ board: Board; turn: number[] }> {
  const boards: [string, number][] = [
    ['classic', 20], ['classic', 6], ['classic', 35], ['classic', 50],
    ['classic', 12], ['classic', 44], ['classic', 55], ['classic', 28],
    ['classic', 60], ['classic', 3],
  ];
  for (const [mode, n] of boards) {
    const board = await openBoard(page, mode, n);
    const turn = await page.evaluate(
      ([low, high]) => {
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
        for (let k = 1; k < answer.length; k++) {
          const prev = answer[k - 1];
          const head = answer[k];
          const sofar = answer.slice(0, k + 1);
          for (let q = 0; q < P.length; q++) {
            if (sofar.includes(q) || !t.runIsLegal(head, q)) continue;
            const a = angle(P[prev], P[head], P[q]);
            if (a >= low && a < high) return [...sofar, q];
          }
        }
        return null;
      },
      [lo, hi] as const,
    );
    if (turn) return { board, turn };
  }
  throw new Error(`no shipped board offers a turn between ${lo} and ${hi} degrees`);
}

/** A turn between `lo` and `hi` degrees that the rule allows. */
export async function findTurn(
  page: Page, lo: number, hi: number,
): Promise<{ board: Board; turn: number[] }> {
  return turnBetween(page, lo, hi);
}

/** A turn tight enough that the string would lie on itself. */
export async function findFold(page: Page): Promise<{ board: Board; turn: number[] }> {
  return turnBetween(page, 1, 28.9);
}
