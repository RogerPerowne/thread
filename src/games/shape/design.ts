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
 * Cut from the measured spread rather than from taste. Over a sample of every
 * size shipped, four by four lands at 68-76, five by five at 90-121, six by
 * six at 119-152 and seven by seven at about 151; the thresholds sit between
 * those groups. scripts/build-shape.ts prints the spread on every run, so if
 * the score ever changes these are re-measured rather than nudged.
 */
export function bandOf(score: number): Band {
  if (score < 80) return 'gentle';
  if (score < 115) return 'steady';
  if (score < 145) return 'tricky';
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

  /*
   * At most one clue per edge position.
   *
   * The puzzle this is drawn from marks each place round the outside once, and
   * so does this — two arrows pointing along the same line from the same end
   * would sit on top of each other, and stacking them outwards would make the
   * gutter grow with the deepest pile on any board. Which depth that one clue
   * says is drawn here, and it is the interesting choice: a clue about the
   * third shape in tells you more than one about the first, and gives less.
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
  { name: 'Room to Hide', count: 8, recipe: { w: 5, h: 5, shapes: 3 }, from: 0, to: 105 },
  { name: 'Deeper In', count: 8, recipe: { w: 5, h: 5, shapes: 3 }, from: 105, to: 999 },
  { name: 'Four Shapes', count: 8, recipe: { w: 5, h: 5, shapes: 4 }, from: 0, to: 105 },
  { name: 'One Blank', count: 8, recipe: { w: 5, h: 5, shapes: 4 }, from: 105, to: 999 },
  { name: 'Six by Six', count: 8, recipe: { w: 6, h: 6, shapes: 4 }, from: 0, to: 138 },
  { name: 'Two Blanks', count: 8, recipe: { w: 6, h: 6, shapes: 4 }, from: 138, to: 999 },
  { name: 'Five Shapes', count: 6, recipe: { w: 6, h: 6, shapes: 5 }, from: 0, to: 999 },
  { name: 'Seven Across', count: 4, recipe: { w: 7, h: 7, shapes: 5 }, from: 0, to: 999 },
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
