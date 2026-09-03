/**
 * Where Hexagony's boards come from.
 *
 * Answer first, and here that is almost the whole of it. Lay the spaces out,
 * decide what number sits on every JOIN between two spaces, and the tiles fall
 * straight out: a tile's sector is whatever its join was given, and the
 * sectors on the outside — the ones touching nothing — are free, so they are
 * given numbers too, because a tile with three blank faces would say what it
 * is before you picked it up.
 *
 * A board built this way cannot be impossible: the arrangement it was read off
 * is a solution by construction. What has to be checked is that it is the
 * ONLY one, and that is where most candidates die — with few enough distinct
 * numbers, two tiles come out identical and can be swapped, and with too many
 * the puzzle solves itself.
 */

import { search, isUnique, analyse, type Reading } from './solve.js';
import { joinsOf, opposite, type Cell, type Hex } from './model.js';
import { makeRng, type Rng } from '../../platform/rng.js';
import type { Band } from '../../platform/types.js';

// --- layouts ---------------------------------------------------------------

/** Every space within `r` steps of the middle: 1, 7, 19, 37. */
export function flower(r: number): Cell[] {
  const out: Cell[] = [];
  for (let q = -r; q <= r; q++) {
    for (let s = Math.max(-r, -q - r); s <= Math.min(r, -q + r); s++) out.push([q, s]);
  }
  return out;
}

/** A leaning block, `w` across and `h` down. */
export function rhombus(w: number, h: number): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) out.push([q, r]);
  return out;
}

/** A triangle with `n` on its longest side. */
export function triangle(n: number): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < n; r++) for (let q = 0; q < n - r; q++) out.push([q, r]);
  return out;
}

export type Recipe = {
  readonly cells: Cell[];
  /** How many distinct numbers the sectors draw on. */
  readonly values: number;
  readonly name: string;
};

/**
 * How hard a board is to think about, as one number.
 *
 * `opening` is how many tile-and-space pairs are still open before anything is
 * crossed out — the size of the room you start in, and it grows with the
 * square of the board, so it is taken as a logarithm like the others.
 * `rounds` is how far the crossing-out has to be carried. And a board that
 * crossing-out never finishes is in a class of its own, because from there the
 * only way on is to try a tile and see.
 */
export function scoreOf(r: Reading): number {
  return Math.log2(Math.max(1, r.opening)) * 7
    + r.rounds * 3.5
    + r.stuck * 2
    + (r.byReason ? 0 : 40);
}

/*
 * The quartiles of the measured spread, pooled over the nine chapters —
 * fifty-three, sixty-one, seventy-nine — and nothing else. scripts/build-hex.ts
 * prints the spread on every run, so the cuts can be re-measured rather than
 * nudged if the score ever changes.
 */
export function bandOf(score: number): Band {
  if (score < 57) return 'gentle';
  if (score < 68) return 'steady';
  if (score < 83) return 'tricky';
  return 'severe';
}

export type Made = Hex & { readonly reading: Reading; readonly nodes: number };

/**
 * One board, or null if this draw did not produce a sound one.
 *
 * Two things are thrown away, and both matter. Two identical tiles can be
 * swapped wherever they sit, so a board with a repeated tile has at least two
 * answers before the solver even starts — cheaper to notice here. And a board
 * whose answer is not unique is not a puzzle.
 */
export function makeHex(recipe: Recipe, rng: Rng): Made | null {
  const { cells, values } = recipe;
  const n = cells.length;

  /* Sectors start unset, and every join fills two of them at once. */
  const tiles: number[][] = cells.map(() => new Array<number>(6).fill(0));
  const skeleton: Hex = { cells, tiles, answer: [], values };
  for (const j of joinsOf(skeleton)) {
    const v = 1 + rng.int(values);
    tiles[j.a][j.dir] = v;
    tiles[j.b][opposite(j.dir)] = v;
  }
  /* The outside faces touch nothing, so they are free — and given a number
     anyway, or a tile would announce which edge of the board it belongs on. */
  for (const tile of tiles) {
    for (let d = 0; d < 6; d++) if (tile[d] === 0) tile[d] = 1 + rng.int(values);
  }

  const key = (t: readonly number[]) => t.join(',');
  const seen = new Set<string>();
  for (const t of tiles) {
    if (seen.has(key(t))) return null;
    seen.add(key(t));
  }

  /*
   * The tiles are handed over shuffled. The answer is where each one came
   * from, followed through the shuffle — so `answer[space]` is a tile index
   * into the shuffled list, which is what the board and the gate both want.
   */
  const orderOf = rng.shuffle(tiles.map((_, i) => i));
  const shuffled = orderOf.map((i) => tiles[i]);
  const answer = new Array<number>(n).fill(-1);
  orderOf.forEach((from, to) => { answer[from] = to; });

  const hex: Hex = { cells, tiles: shuffled, answer, values };
  const found = search(hex, 2);
  if (!isUnique(found)) return null;

  return { ...hex, reading: analyse(hex), nodes: found.nodes };
}

/** How long one chapter may spend looking, before it ships what it has. */
const CHAPTER_MS = Number(process.env.CHAPTER_MS ?? 300_000);

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
 * Two levers pulling against each other, and the second one runs backwards
 * from the guess. More spaces means more to place. But more distinct numbers
 * means each tile fits FEWER spaces, so a big board with a big alphabet is
 * easier than a big board with a small one — measured, not assumed: a
 * honeycomb on five numbers falls to deduction in none of a hundred draws,
 * and on eight numbers in two of five.
 *
 * So the chapters grow the board and let the alphabet grow with it, and the
 * two rungs that get harder without growing are the ones that take numbers
 * AWAY: the same seven spaces on four numbers instead of five, where two
 * tiles nearly repeat and the crossing-out has further to run.
 *
 * Every shipped board is one that crossing-out alone finishes. A board that
 * needs you to try a tile and see is not a harder puzzle of the same kind, it
 * is a different kind — so those are not laddered, they are dropped.
 */
export const LADDER: readonly Chapter[] = [
  { name: 'Four Tiles', count: 30, recipe: { cells: rhombus(2, 2), values: 3, name: '2 by 2' }, from: 0, to: 999 },
  { name: 'The Flower', count: 30, recipe: { cells: flower(1), values: 5, name: 'flower' }, from: 0, to: 999 },
  { name: 'A Fourth Number', count: 30, recipe: { cells: rhombus(3, 2), values: 4, name: '3 by 2' }, from: 0, to: 999 },
  { name: 'The Wedge', count: 30, recipe: { cells: triangle(3), values: 4, name: 'triangle' }, from: 0, to: 999 },
  { name: 'Crowded', count: 30, recipe: { cells: flower(1), values: 4, name: 'flower' }, from: 0, to: 999 },
  { name: 'Three Numbers', count: 30, recipe: { cells: triangle(3), values: 3, name: 'triangle' }, from: 0, to: 999 },
  { name: 'Six Tiles', count: 30, recipe: { cells: rhombus(3, 2), values: 3, name: '3 by 2' }, from: 0, to: 999 },
  { name: 'Five Numbers', count: 30, recipe: { cells: rhombus(3, 3), values: 5, name: '3 by 3' }, from: 0, to: 999 },
  { name: 'The Long Wedge', count: 30, recipe: { cells: triangle(4), values: 5, name: 'big triangle' }, from: 0, to: 999 },
  { name: 'Nine Spaces', count: 30, recipe: { cells: rhombus(3, 3), values: 4, name: '3 by 3' }, from: 0, to: 999 },
  { name: 'Six Numbers', count: 30, recipe: { cells: rhombus(4, 3), values: 6, name: '4 by 3' }, from: 0, to: 999 },
  { name: 'A Wider Field', count: 30, recipe: { cells: rhombus(4, 3), values: 5, name: '4 by 3' }, from: 0, to: 999 },
  { name: 'The Honeycomb', count: 30, recipe: { cells: flower(2), values: 8, name: 'honeycomb' }, from: 0, to: 999 },
  { name: 'Seven Numbers', count: 30, recipe: { cells: rhombus(5, 3), values: 7, name: '5 by 3' }, from: 0, to: 999 },
  { name: 'Fifteen', count: 30, recipe: { cells: rhombus(5, 3), values: 6, name: '5 by 3' }, from: 0, to: 999 },
  { name: 'Sixteen', count: 30, recipe: { cells: rhombus(4, 4), values: 6, name: '4 by 4' }, from: 0, to: 999 },
  { name: 'Twenty Spaces', count: 20, recipe: { cells: rhombus(5, 4), values: 7, name: '5 by 4' }, from: 0, to: 999 },
];

export type Built = Hex & {
  readonly id: string;
  readonly band: Band;
  readonly score: number;
  readonly chapter: number;
};

export function buildHex(seed = 'hex-1', onProgress?: (msg: string) => void): Built[] {
  const out: Built[] = [];
  let no = 0;

  /* Seeded by the recipe rather than by position — see One to Nine's note:
     the ladder is ordered by measuring it, so a chapter has to make the same
     boards wherever it ends up or the order will not settle. */
  const seenRecipe = new Map<string, number>();
  LADDER.forEach((chapter, ci) => {
    const key = `${chapter.recipe.name}|${chapter.recipe.values}`;
    const nth = seenRecipe.get(key) ?? 0;
    seenRecipe.set(key, nth + 1);
    const rng = makeRng(`${seed}:${key}:${nth}`);
    const seen = new Set<string>();
    const batch: Omit<Built, 'id'>[] = [];
    let tries = 0;
    const until = Date.now() + CHAPTER_MS;
    while (batch.length < chapter.count && tries < 200_000 && Date.now() < until) {
      tries++;
      const board = makeHex(chapter.recipe, rng);
      if (!board) continue;
      if (!board.reading.byReason) continue;
      const score = scoreOf(board.reading);

      const key = board.tiles.map((t) => t.join('')).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      batch.push({
        cells: board.cells,
        tiles: board.tiles,
        answer: board.answer,
        values: board.values,
        band: bandOf(score),
        score: Math.round(score * 10) / 10,
        chapter: ci + 1,
      });
    }
    /* Sorted inside the chapter, so its levels climb rather than arriving in
       whatever order the generator happened to find them. */
    batch.sort((a, b) => a.score - b.score);
    for (const b of batch) out.push({ ...b, id: `hex-${++no}` });
    onProgress?.(`${chapter.name}: ${batch.length}/${chapter.count} in ${tries} draws`);
  });

  return out;
}
