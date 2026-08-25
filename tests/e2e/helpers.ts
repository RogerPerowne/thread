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
  await page.waitForSelector('.board');
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
  const box = await page.locator('.board').first().boundingBox();
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
