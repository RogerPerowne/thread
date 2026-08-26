import type { Page } from '@playwright/test';

/**
 * Every helper here drives the app through REAL pointer events. Solving a
 * board by calling into it would prove the rules work and nothing at all about
 * whether the game is PLAYABLE, and those are different questions.
 *
 * The read-only handles say where things are, as a player's eyes would. They
 * are read in the game's own terms rather than in board coordinates copied
 * into this file, because a copied constant is how a harness comes to tap
 * somewhere no player taps and still go green.
 */

type Handle = {
  games(): string[];
  puzzles(game: string): string[];
  puzzle(game: string, id: string): { id: string; band: string; data: unknown } | null;
  board(): unknown;
};

declare global {
  interface Window { __puzzles: Handle }
}

export async function gotoApp(page: Page, hash = '#/'): Promise<void> {
  await page.goto(`/${hash}`);
  await page.waitForFunction(() => Boolean(window.__puzzles));
}

/** Open one puzzle and wait for its board. */
export async function openPuzzle(page: Page, game: string, id: string): Promise<void> {
  const want = `#/g/${game}/${id}`;
  // A goto that only changes the fragment is a same-document navigation and
  // would not re-run the app, so returning to the puzzle we are on needs a
  // real reload.
  if (page.url().endsWith(want)) await page.reload();
  else await page.goto(`/${want}`);
  await page.waitForFunction(() => Boolean(window.__puzzles));
  await page.waitForSelector('.stage svg');
}

export async function puzzleIds(page: Page, game: string): Promise<string[]> {
  return page.evaluate((g) => window.__puzzles.puzzles(g), game);
}

export async function isSolved(page: Page): Promise<boolean> {
  return page.locator('.screen.play.won').count().then((n) => n > 0);
}

export function noteOf(page: Page) {
  return page.locator('.note');
}

/** A button in the control row, by its label. */
export function control(page: Page, label: string) {
  return page.locator('.controls .btn', { hasText: label });
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export type ThreadBoard = {
  id: string;
  posts: [number, number][];
  blocks: { x: number; y: number; w: number; h: number }[];
  strands: { from: number; to: number; color: string }[];
  solution: number[][];
};

export async function threadBoard(page: Page): Promise<ThreadBoard> {
  return page.evaluate(
    () => (window.__puzzles.board() as { board: ThreadBoard }).board as never,
  );
}

/**
 * Board space to viewport pixels, via the SVG's own window.
 *
 * Read off the element rather than copied from the source: each board has its
 * own window, so a pair of constants here would drift the moment a board's
 * extent changed, and drift silently.
 */
export async function threadMapper(page: Page): Promise<(p: [number, number]) => { x: number; y: number }> {
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

/** Lay one string the way a thumb would. */
export async function dragStrand(
  page: Page, board: ThreadBoard, path: number[], steps = 3,
): Promise<void> {
  const at = await threadMapper(page);
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

export async function solveThread(page: Page, board: ThreadBoard): Promise<void> {
  for (const path of board.solution) await dragStrand(page, board, path);
}

// ---------------------------------------------------------------------------
// Zigzag
// ---------------------------------------------------------------------------

export type ZigBoard = {
  w: number; h: number; cells: number[]; sequence: number[];
  start: number; finish: number; answer: number[];
};

export async function zigBoard(page: Page): Promise<ZigBoard> {
  return page.evaluate(() => (window.__puzzles.board() as { zig: ZigBoard }).zig as never);
}

export async function zigMapper(page: Page): Promise<(cell: number) => { x: number; y: number }> {
  const svg = page.locator('.zig-svg');
  const box = await svg.boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const zig = await zigBoard(page);
  const W = zig.w * 10 + 2;
  const H = zig.h * 10 + 2;
  const side = Math.min(box.width / W, box.height / H);
  const ox = box.x + (box.width - side * W) / 2 + side;
  const oy = box.y + (box.height - side * H) / 2 + side;
  return (cell) => ({
    x: ox + ((cell % zig.w) * 10 + 5) * side,
    y: oy + (Math.floor(cell / zig.w) * 10 + 5) * side,
  });
}

/** Draw a line the way a finger would. */
export async function drawLine(page: Page, cells: number[], steps = 3): Promise<void> {
  const at = await zigMapper(page);
  const first = at(cells[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const c of cells.slice(1)) {
    const p = at(c);
    await page.mouse.move(p.x, p.y, { steps });
  }
  await page.mouse.up();
}
