/**
 * Where Shape Up's boards come from.
 *
 * Answer first. A filled grid is built — one of every shape in every row and
 * every column — and the clues are then READ OFF it. Every clue the grid could
 * carry is generated, and then they are taken away one at a time for as long
 * as exactly one filling still fits.
 *
 * That last step is the whole design. A generator that scatters clues and
 * hopes produces boards that are either trivially over-clued or have four
 * answers; taking clues away from a complete set, and stopping the moment the
 * board stops being unique, produces a MINIMAL clue set — one where every
 * clue that is left is load-bearing, because removing any of them was tried
 * and put back.
 */

import { search, isUnique, analyse, allClues, arrangements, type Reading } from './solve.js';
import { sightLine, type Board } from './model.js';
import { makeRng, type Rng } from '../../platform/rng.js';
import type { Band } from '../../platform/types.js';

export type Recipe = {
  readonly w: number;
  readonly h: number;
  readonly shapes: number;
};

/**
 * A filled grid: one of every shape in every row and every column.
 *
 * Built row by row from the arrangements, backtracking when a column runs out
 * of room. It is a partial Latin square with blanks, and for the sizes here
 * the search finds one in a handful of attempts.
 */
export function fill(recipe: Recipe, rng: Rng): number[] | null {
  const { w, h, shapes } = recipe;
  if (shapes > w || shapes > h) return null;
  /*
   * The board has to be square, and it is arithmetic rather than taste.
   *
   * Every row holds one of each shape, so a board with h rows carries
   * shapes * h marks. Every column holds one of each too, so it carries
   * shapes * w. Both count the same marks, so w must equal h — a five by four
   * would need fifteen marks and twelve at the same time. Refused here rather
   * than searched for: left to the backtracker a rectangle is forty thousand
   * draws that were never going to work.
   */
  if (w !== h) return null;
  const stock = arrangements(w, shapes);
  const grid = new Array<number>(w * h).fill(0);
  const inCol: Uint8Array[] = [];
  for (let c = 0; c < w; c++) inCol.push(new Uint8Array(shapes + 1));

  const go = (r: number): boolean => {
    if (r === h) {
      for (let c = 0; c < w; c++) {
        for (let s = 1; s <= shapes; s++) if (inCol[c][s] !== 1) return false;
      }
      return true;
    }
    const order = rng.shuffle(stock.slice());
    for (const row of order) {
      let ok = true;
      for (let c = 0; c < w && ok; c++) if (row[c] > 0 && inCol[c][row[c]] > 0) ok = false;
      if (!ok) continue;
      for (let c = 0; c < w; c++) {
        grid[r * w + c] = row[c];
        if (row[c] > 0) inCol[c][row[c]]++;
      }
      const left = h - r - 1;
      let feasible = true;
      for (let c = 0; c < w && feasible; c++) {
        let missing = 0;
        for (let s = 1; s <= shapes; s++) if (inCol[c][s] === 0) missing++;
        if (missing > left) feasible = false;
      }
      if (feasible && go(r + 1)) return true;
      for (let c = 0; c < w; c++) {
        if (row[c] > 0) inCol[c][row[c]]--;
        grid[r * w + c] = 0;
      }
    }
    return false;
  };

  return go(0) ? grid : null;
}

/**
 * How hard a board is to think about, as one number.
 *
 * Same shape of measure as One to Nine's, and for the same reason: it counts
 * the deduction rather than the search. `opening` is how much the lines allow
 * between them before anything is crossed out, `entry` is the tightest single
 * line — the way in — and a board that crossing-out never finishes is in a
 * class of its own, because from there the only way on is to try something.
 */
export function scoreOf(r: Reading): number {
  return Math.log2(Math.max(1, r.opening)) * 6
    + Math.log2(Math.max(1, r.entry)) * 5
    + r.rounds * 2
    + (r.byReason ? 0 : 40);
}

/*
 * Cut at the quartiles of the shipped spread, so each of the four names covers
 * about a quarter of the ladder and every one of them means something. Read
 * off the 500 boards this ladder actually makes — min 70, q1 96, median 123,
 * q3 146, max 172 — rather than from taste. scripts/build-shape.ts prints the
 * spread on every run, so if the score ever changes these are re-measured
 * rather than nudged.
 */
export function bandOf(score: number): Band {
  if (score < 98) return 'gentle';
  if (score < 125) return 'steady';
  if (score < 139) return 'tricky';
  return 'severe';
}

/** How long one chapter may spend looking, before it ships what it has. */
const CHAPTER_MS = Number(process.env.CHAPTER_MS ?? 300_000);

export type Made = Board & { readonly reading: Reading; readonly nodes: number };

/**
 * One board, or null if this draw did not produce a sound one.
 *
 * The clues come off the answer, then go away one at a time in a random order
 * for as long as the board still has exactly one filling. What is left is
 * minimal: every clue on the finished board was removed once, found to cost
 * uniqueness, and put back.
 */
export function makeShape(recipe: Recipe, rng: Rng): Made | null {
  const answer = fill(recipe, rng);
  if (!answer) return null;

  const full: Board = { ...recipe, clues: [], answer };

  /*
   * At most one clue per edge position.
   *
   * The puzzle this is drawn from marks each place round the outside once, and
   * so does this — two arrows pointing along the same line from the same end
   * would sit on top of each other, and stacking them outwards would make the
   * gutter grow with the deepest pile on any board.
   *
   * So each slot holds a first or a second, drawn here. Both readings of a
   * line are still available to the board, on the two ends: what a slot gives
   * up is the OTHER depth from its own end, not the deduction, because the kth
   * shape from the left is the (shapes + 1 - k)th from the right.
   */
  const bySlot = new Map<string, ReturnType<typeof allClues>>();
  for (const clue of allClues(full)) {
    const key = `${clue.side}:${clue.line}`;
    const had = bySlot.get(key);
    if (had) had.push(clue);
    else bySlot.set(key, [clue]);
  }
  let clues = rng.shuffle([...bySlot.values()].map((list) => rng.pick(list)));

  // A board with every clue on it is unique by construction, but check, so a
  // recipe that cannot be pinned down at all fails here rather than silently.
  if (!isUnique(search({ ...full, clues }, 2))) return null;

  /*
   * A clue goes only when the search PROVED the board is still unique without
   * it. A search that ran out of budget found one answer and stopped looking,
   * which is a different thing entirely — treating the two the same is how a
   * generator removes the clue that was holding the board together.
   */
  for (let i = 0; i < clues.length; i++) {
    const without = clues.filter((_, k) => k !== i);
    if (isUnique(search({ ...full, clues: without }, 2))) {
      clues = without;
      i--;
    }
  }

  const board: Board = { ...recipe, clues, answer };
  const found = search(board, 2);
  if (!isUnique(found)) return null;
  return { ...board, reading: analyse(board), nodes: found.nodes };
}

export type Chapter = {
  readonly name: string;
  readonly count: number;
  readonly recipe: Recipe;
};

/**
 * The ladder: seventeen chapters over eleven recipes.
 *
 * Two levers, and they pull in different directions. More shapes in a line
 * means fewer blanks and a tighter puzzle; a bigger board with the same
 * shapes means more blanks and more room for them to hide in.
 *
 * Eleven recipes and not seventeen, because the board has to be square (see
 * `fill`) and five shapes is all the glyph set holds — four sizes by three
 * shape counts, less the one that does not fit, is every recipe there is. So
 * six of them are used twice, and the two chapters that share a recipe SPLIT
 * ITS POOL BY MEASURED SCORE: the first takes the easier half, the second the
 * harder. That keeps the ladder climbing where the recipes have run out,
 * without anybody inventing a difficulty window by eye.
 */
export const LADDER: readonly Chapter[] = [
  { name: 'Four in Four', count: 30, recipe: { w: 4, h: 4, shapes: 4 } },
  { name: 'Three Shapes', count: 30, recipe: { w: 4, h: 4, shapes: 3 } },
  { name: 'Five in Five', count: 30, recipe: { w: 5, h: 5, shapes: 5 } },
  { name: 'Four Shapes', count: 30, recipe: { w: 5, h: 5, shapes: 4 } },
  { name: 'Room to Hide', count: 30, recipe: { w: 5, h: 5, shapes: 3 } },
  { name: 'Deeper In', count: 30, recipe: { w: 5, h: 5, shapes: 3 } },
  { name: 'Five Shapes', count: 30, recipe: { w: 6, h: 6, shapes: 5 } },
  { name: 'One Blank', count: 30, recipe: { w: 5, h: 5, shapes: 4 } },
  { name: 'Six by Six', count: 30, recipe: { w: 6, h: 6, shapes: 3 } },
  { name: 'Three in Six', count: 30, recipe: { w: 6, h: 6, shapes: 3 } },
  { name: 'Two Blanks', count: 30, recipe: { w: 6, h: 6, shapes: 4 } },
  { name: 'Seven Across', count: 30, recipe: { w: 7, h: 7, shapes: 3 } },
  { name: 'Four in Six', count: 30, recipe: { w: 6, h: 6, shapes: 4 } },
  { name: 'Five in Six', count: 30, recipe: { w: 6, h: 6, shapes: 5 } },
  { name: 'Forty-Nine', count: 30, recipe: { w: 7, h: 7, shapes: 4 } },
  { name: 'Seven Square', count: 30, recipe: { w: 7, h: 7, shapes: 5 } },
  { name: 'The Last Shapes', count: 20, recipe: { w: 7, h: 7, shapes: 5 } },
];

export type Built = Board & {
  readonly id: string;
  readonly band: Band;
  readonly score: number;
  readonly chapter: number;
};

export function buildShape(seed = 'shape-1', onProgress?: (msg: string) => void): Built[] {
  const out: Built[] = [];
  let no = 0;

  /*
   * One pool per RECIPE, cut into chapters afterwards.
   *
   * Chapters that share a recipe have to divide its difficulty between them,
   * and the only honest way to do that is to make all of their boards first,
   * sort the lot by measured score, and hand the easy end to the earlier
   * chapter. Filling each chapter separately against a score window would need
   * somebody to have picked the window, and a window picked before the boards
   * exist is a guess wearing a number.
   */
  const key = (r: Recipe) => `${r.w}x${r.h}x${r.shapes}`;
  const wanted = new Map<string, { recipe: Recipe; count: number }>();
  for (const chapter of LADDER) {
    const k = key(chapter.recipe);
    const had = wanted.get(k);
    if (had) wanted.set(k, { recipe: had.recipe, count: had.count + chapter.count });
    else wanted.set(k, { recipe: chapter.recipe, count: chapter.count });
  }

  const pools = new Map<string, Omit<Built, 'id' | 'chapter'>[]>();
  for (const [k, { recipe, count }] of wanted) {
    const rng = makeRng(`${seed}:${k}`);
    const seen = new Set<string>();
    const pool: Omit<Built, 'id' | 'chapter'>[] = [];
    let tries = 0;
    const until = Date.now() + CHAPTER_MS;
    while (pool.length < count && tries < 40_000 && Date.now() < until) {
      tries++;
      const board = makeShape(recipe, rng);
      if (!board) continue;
      const score = scoreOf(board.reading);
      const print = board.clues
        .map((c) => `${c.side}${c.line}${c.shape}${c.depth}`)
        .sort()
        .join('|');
      if (seen.has(print)) continue;
      seen.add(print);
      pool.push({
        w: board.w,
        h: board.h,
        shapes: board.shapes,
        clues: board.clues,
        answer: board.answer,
        band: bandOf(score),
        score: Math.round(score * 10) / 10,
      });
    }
    pool.sort((a, b) => a.score - b.score);
    pools.set(k, pool);
    onProgress?.(`${k}: ${pool.length}/${count} in ${tries} draws`);
  }

  LADDER.forEach((chapter, ci) => {
    const pool = pools.get(key(chapter.recipe)) ?? [];
    const taken = pool.splice(0, chapter.count);
    for (const b of taken) out.push({ ...b, chapter: ci + 1, id: `shape-${++no}` });
  });

  return out;
}

/** For the gate: the clues a finished board carries, as sight lines. */
export function clueLines(board: Board): number[][] {
  return board.clues.map((c) => sightLine(board, c.side, c.line));
}
