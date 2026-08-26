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

// ---------------------------------------------------------------------------
// One to Nine
// ---------------------------------------------------------------------------

export type NineBoard = {
  n: number;
  rowTargets: number[];
  colTargets: number[];
  answer: number[];
};

type NineHandle = {
  nine: NineBoard;
  cells(): number[];
  slot(digit: number): { x: number; y: number };
  cellBox(cell: number): { x: number; y: number; size: number };
  view: { W: number; H: number; ox: number; oy: number };
};

export async function nineBoard(page: Page): Promise<NineBoard> {
  return page.evaluate(() => (window.__puzzles.board() as NineHandle).nine as never);
}

/**
 * Board space to viewport pixels, through the board's own window.
 *
 * Read off the element rather than copied: the board publishes the viewBox it
 * actually drew with, so a change to the layout moves the harness with it
 * instead of silently making it tap somewhere no player taps.
 */
export async function nineMapper(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  const box = await page.locator('.nine-svg').boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const v = await page.evaluate(() => (window.__puzzles.board() as NineHandle).view);
  const side = Math.min(box.width / v.W, box.height / v.H);
  const left = box.x + (box.width - side * v.W) / 2;
  const top = box.y + (box.height - side * v.H) / 2;
  return (x, y) => ({ x: left + (x - v.ox) * side, y: top + (y - v.oy) * side });
}

/** Drag one digit from wherever it is into a cell, the way a thumb would. */
export async function dragDigit(page: Page, digit: number, cell: number): Promise<void> {
  const at = await nineMapper(page);
  const where = await page.evaluate((d) => {
    const h = window.__puzzles.board() as NineHandle;
    const on = h.cells().indexOf(d);
    if (on >= 0) {
      const b = h.cellBox(on);
      return { x: b.x + b.size / 2, y: b.y + b.size / 2 };
    }
    const s = h.slot(d);
    return { x: s.x + 9.5, y: s.y + 9.5 };
  }, digit);
  const box = await page.evaluate((c) => (window.__puzzles.board() as NineHandle).cellBox(c), cell);

  const from = at(where.x, where.y);
  const to = at(box.x + box.size / 2, box.y + box.size / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let s = 1; s <= 4; s++) {
    await page.mouse.move(from.x + (to.x - from.x) * (s / 4), from.y + (to.y - from.y) * (s / 4));
  }
  await page.mouse.up();
}

export async function solveNine(page: Page, board: NineBoard): Promise<void> {
  for (let i = 0; i < board.answer.length; i++) await dragDigit(page, board.answer[i], i);
}

// ---------------------------------------------------------------------------
// Shape Up
// ---------------------------------------------------------------------------

export type ShapeBoard = {
  w: number;
  h: number;
  shapes: number;
  clues: { side: string; line: number; shape: number; depth: number }[];
  answer: number[];
};

type ShapeHandle = {
  shape: ShapeBoard;
  cells(): number[];
  cellBox(cell: number): { x: number; y: number; size: number };
  chipBox(pick: number): { x: number; y: number; size: number };
  picked(): number;
  view: { W: number; H: number };
};

export async function shapeBoard(page: Page): Promise<ShapeBoard> {
  return page.evaluate(() => (window.__puzzles.board() as ShapeHandle).shape as never);
}

export async function shapeMapper(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  const box = await page.locator('.shape-svg').boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const v = await page.evaluate(() => (window.__puzzles.board() as ShapeHandle).view);
  const side = Math.min(box.width / v.W, box.height / v.H);
  const left = box.x + (box.width - side * v.W) / 2;
  const top = box.y + (box.height - side * v.H) / 2;
  return (x, y) => ({ x: left + x * side, y: top + y * side });
}

const tap = async (page: Page, q: { x: number; y: number }): Promise<void> => {
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.up();
};

/** Choose a mark from the palette. `pick` is 0 for empty and 1 up for a shape. */
export async function pickMark(page: Page, pick: number): Promise<void> {
  const at = await shapeMapper(page);
  const chip = await page.evaluate((k) => (window.__puzzles.board() as ShapeHandle).chipBox(k), pick);
  await tap(page, at(chip.x + chip.size / 2, chip.y + chip.size / 2));
}

/**
 * Put a mark in a cell the way a thumb would: choose it from the palette, then
 * tap the cell. Where the chip is is read off the board rather than worked out
 * here, so a change to the layout moves the harness with it.
 */
export async function markCell(page: Page, cell: number, pick: number): Promise<void> {
  await pickMark(page, pick);
  const at = await shapeMapper(page);
  const box = await page.evaluate((c) => (window.__puzzles.board() as ShapeHandle).cellBox(c), cell);
  await tap(page, at(box.x + box.size / 2, box.y + box.size / 2));
}

/** The other way in: choose a mark and drag a run of cells with it. */
export async function paintCells(page: Page, cells: number[], pick: number): Promise<void> {
  await pickMark(page, pick);
  const at = await shapeMapper(page);
  const boxes = await page.evaluate(
    (list) => list.map((c) => (window.__puzzles.board() as ShapeHandle).cellBox(c)),
    cells,
  );
  const first = at(boxes[0].x + boxes[0].size / 2, boxes[0].y + boxes[0].size / 2);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const b of boxes.slice(1)) {
    const q = at(b.x + b.size / 2, b.y + b.size / 2);
    await page.mouse.move(q.x, q.y, { steps: 3 });
  }
  await page.mouse.up();
}

/**
 * Fill a whole board, one mark at a time.
 *
 * Grouped by mark rather than by cell, because that is how the palette is
 * meant to be used and it is a fair test of it: choose a shape once, then put
 * it everywhere it goes.
 */
export async function solveShape(page: Page, board: ShapeBoard): Promise<void> {
  const at = await shapeMapper(page);
  const picks = [...new Set(board.answer)].sort((a, b) => a - b);
  for (const pick of picks) {
    await pickMark(page, pick);
    const cells = board.answer
      .map((v, i) => (v === pick ? i : -1))
      .filter((i) => i >= 0);
    const boxes = await page.evaluate(
      (list) => list.map((c) => (window.__puzzles.board() as ShapeHandle).cellBox(c)),
      cells,
    );
    for (const b of boxes) await tap(page, at(b.x + b.size / 2, b.y + b.size / 2));
  }
}

// ---------------------------------------------------------------------------
// Hexagony
// ---------------------------------------------------------------------------

export type HexBoard = {
  cells: [number, number][];
  tiles: number[][];
  answer: number[];
  values: number;
};

type HexHandle = {
  hex: HexBoard;
  placed(): number[];
  space(at: number): { x: number; y: number };
  slot(tile: number): { x: number; y: number };
  radius: number;
  view: { W: number; H: number; ox: number; oy: number };
};

export async function hexBoard(page: Page): Promise<HexBoard> {
  return page.evaluate(() => (window.__puzzles.board() as HexHandle).hex as never);
}

export async function hexMapper(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  const box = await page.locator('.hex-svg').boundingBox();
  if (!box) throw new Error('the board is not on screen');
  const v = await page.evaluate(() => (window.__puzzles.board() as HexHandle).view);
  const side = Math.min(box.width / v.W, box.height / v.H);
  const left = box.x + (box.width - side * v.W) / 2;
  const top = box.y + (box.height - side * v.H) / 2;
  return (x, y) => ({ x: left + (x - v.ox) * side, y: top + (y - v.oy) * side });
}

/** Drag one tile from wherever it is into a space, the way a thumb would. */
export async function dragTile(page: Page, tile: number, at: number): Promise<void> {
  const map = await hexMapper(page);
  const where = await page.evaluate((t) => {
    const h = window.__puzzles.board() as HexHandle;
    const on = h.placed().indexOf(t);
    return on >= 0 ? h.space(on) : h.slot(t);
  }, tile);
  const target = await page.evaluate((a) => (window.__puzzles.board() as HexHandle).space(a), at);

  const from = map(where.x, where.y);
  const to = map(target.x, target.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let s = 1; s <= 4; s++) {
    await page.mouse.move(from.x + (to.x - from.x) * (s / 4), from.y + (to.y - from.y) * (s / 4));
  }
  await page.mouse.up();
}

/** Tap a tile, then tap a space: the other way of making the same move. */
export async function tapTileInto(page: Page, tile: number, at: number): Promise<void> {
  const map = await hexMapper(page);
  const where = await page.evaluate((t) => {
    const h = window.__puzzles.board() as HexHandle;
    const on = h.placed().indexOf(t);
    return on >= 0 ? h.space(on) : h.slot(t);
  }, tile);
  const target = await page.evaluate((a) => (window.__puzzles.board() as HexHandle).space(a), at);
  const from = map(where.x, where.y);
  const to = map(target.x, target.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(to.x, to.y);
  await page.mouse.down();
  await page.mouse.up();
}

export async function solveHex(page: Page, board: HexBoard): Promise<void> {
  for (let at = 0; at < board.answer.length; at++) await dragTile(page, board.answer[at], at);
}
