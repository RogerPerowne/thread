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

import { search, analyse, allClues, arrangements, type Reading } from './solve.js';
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
 * Cut from the measured spread rather than from taste; scripts/build-shape.ts
 * prints it on every run.
 */
export function bandOf(score: number): Band {
  if (score < 58) return 'gentle';
  if (score < 70) return 'steady';
  if (score < 84) return 'tricky';
  return 'severe';
}

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
  let clues = rng.shuffle(allClues(full));

  // A board with every clue on it is unique by construction, but check, so a
  // recipe that cannot be pinned down at all fails here rather than silently.
  if (search({ ...full, clues }, 2).count !== 1) return null;

  for (let i = 0; i < clues.length; i++) {
    const without = clues.filter((_, k) => k !== i);
    if (search({ ...full, clues: without }, 2).count === 1) {
      clues = without;
      i--;
    }
  }

  const board: Board = { ...recipe, clues, answer };
  const found = search(board, 2);
  if (found.count !== 1) return null;
  return { ...board, reading: analyse(board), nodes: found.nodes };
}

export type Chapter = {
  readonly name: string;
  readonly count: number;
  readonly recipe: Recipe;
  readonly from: number;
  readonly to: number;
};

/**
 * The ladder.
 *
 * Two levers, and they pull in different directions. More shapes in a line
 * means fewer blanks and a tighter puzzle; a bigger board with the same
 * shapes means more blanks and more room for them to hide in. The chapters
 * walk both, and the score window inside each keeps the order honest.
 */
export const LADDER: readonly Chapter[] = [
  { name: 'Three Shapes', count: 8, recipe: { w: 4, h: 4, shapes: 3 }, from: 0, to: 999 },
  { name: 'Room to Hide', count: 8, recipe: { w: 5, h: 5, shapes: 3 }, from: 0, to: 62 },
  { name: 'Deeper In', count: 8, recipe: { w: 5, h: 5, shapes: 3 }, from: 62, to: 999 },
  { name: 'Four Shapes', count: 8, recipe: { w: 5, h: 5, shapes: 4 }, from: 0, to: 999 },
  { name: 'Six by Six', count: 8, recipe: { w: 6, h: 6, shapes: 4 }, from: 0, to: 72 },
  { name: 'Two Blanks', count: 8, recipe: { w: 6, h: 6, shapes: 4 }, from: 72, to: 999 },
  { name: 'Five Shapes', count: 6, recipe: { w: 6, h: 6, shapes: 5 }, from: 0, to: 999 },
  { name: 'Seven by Seven', count: 6, recipe: { w: 7, h: 7, shapes: 5 }, from: 0, to: 999 },
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

  LADDER.forEach((chapter, ci) => {
    const rng = makeRng(`${seed}:${ci}`);
    const seen = new Set<string>();
    let made = 0;
    let tries = 0;
    while (made < chapter.count && tries < 4000) {
      tries++;
      const board = makeShape(chapter.recipe, rng);
      if (!board) continue;
      const score = scoreOf(board.reading);
      if (score < chapter.from || score >= chapter.to) continue;

      const key = board.clues
        .map((c) => `${c.side}${c.line}${c.shape}${c.depth}`)
        .sort()
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      no++;
      made++;
      out.push({
        w: board.w,
        h: board.h,
        shapes: board.shapes,
        clues: board.clues,
        answer: board.answer,
        id: `shape-${no}`,
        band: bandOf(score),
        score: Math.round(score * 10) / 10,
        chapter: ci + 1,
      });
    }
    onProgress?.(`${chapter.name}: ${made}/${chapter.count} in ${tries} draws`);
  });

  return out;
}

/** For the gate: the clues a finished board carries, as sight lines. */
export function clueLines(board: Board): number[][] {
  return board.clues.map((c) => sightLine(board, c.side, c.line));
}
