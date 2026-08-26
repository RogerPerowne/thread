/**
 * Where Isolate's boards come from.
 *
 * Answer first, and here the answer is the rooms. Cut the grid into rooms of
 * two to a handful of cells, drop two circles in each, write its size on one
 * of them, and the walls fall out: every edge between two rooms is a wall. A
 * board built this way cannot be impossible, because the rooms existed before
 * the puzzle did.
 *
 * What has to be worked for is that it is the ONLY answer, and that it can be
 * REASONED to rather than searched for. Both are bought with clues, and the
 * order they are bought in is the design: a cross costs nothing on the page
 * and a drawn wall costs a whole edge of the drawing, so crosses are tried
 * first and walls only when no cross will do.
 */

import { analyse, search, scoreOf, type Reading } from './solve.js';
import {
  cellsOf, cornerCount, edgeCount, edgesAtCorner, judge, neighbours, type Board,
} from './model.js';
import { makeRng, type Rng } from '../../platform/rng.js';
import type { Band } from '../../platform/types.js';

export type Recipe = {
  readonly w: number;
  readonly h: number;
  /** The largest a room may be. Two is the smallest a room can be at all. */
  readonly biggest: number;
};

/**
 * Cut the grid into connected rooms of between two and `biggest` cells.
 *
 * Grown one at a time from the first cell nothing has claimed, which keeps
 * every room connected by construction. A room that cannot reach two cells —
 * a pocket left behind by the ones before it — is folded into a neighbour
 * instead, because a one-cell room cannot hold two circles and a board with
 * one in it is not a board.
 */
function carveRooms(w: number, h: number, biggest: number, rng: Rng): Int32Array | null {
  const n = w * h;
  const of = new Int32Array(n).fill(-1);
  let rooms = 0;

  for (let seed = 0; seed < n; seed++) {
    if (of[seed] >= 0) continue;
    const room = rooms++;
    const want = 2 + rng.int(biggest - 1);
    const mine = [seed];
    of[seed] = room;
    while (mine.length < want) {
      const edge: number[] = [];
      for (const cell of mine) {
        for (const other of neighbours(w, h, cell)) {
          if (of[other] < 0 && !edge.includes(other)) edge.push(other);
        }
      }
      if (edge.length === 0) break;
      const next = edge[rng.int(edge.length)];
      of[next] = room;
      mine.push(next);
    }
    if (mine.length >= 2) continue;

    /* A pocket. Fold it into whichever neighbour can still take it. */
    const hosts = neighbours(w, h, seed)
      .map((c) => of[c])
      .filter((r) => r >= 0 && r !== room);
    let placed = false;
    for (const host of rng.shuffle([...new Set(hosts)])) {
      let count = 0;
      for (let cell = 0; cell < n; cell++) if (of[cell] === host) count++;
      if (count + 1 > biggest) continue;
      of[seed] = host;
      placed = true;
      break;
    }
    if (!placed) return null;
    rooms--;
    for (let cell = 0; cell < n; cell++) if (of[cell] > room) of[cell]--;
  }
  return of;
}

export type Made = Board & { readonly reading: Reading; readonly nodes: number };

/**
 * One board, or null if this draw did not produce a sound one.
 *
 * The clue loop is the whole of it. Start with nothing given at all — no
 * crosses, no drawn walls — and while a second answer exists, take one thing
 * away from it: a corner the answer walls twice and the rival does not, or
 * failing that a wall the answer has and the rival has not. Then keep going
 * until the board can be reasoned out rather than searched out, because a
 * board with one answer that only a search can find is a maze wearing a
 * puzzle's clothes.
 */
export function makeIsolate(recipe: Recipe, rng: Rng): Made | null {
  const { w, h } = recipe;
  const n = w * h;
  const of = carveRooms(w, h, recipe.biggest, rng);
  if (!of) return null;

  const rooms: number[][] = [];
  for (let cell = 0; cell < n; cell++) {
    (rooms[of[cell]] ??= []).push(cell);
  }
  if (rooms.some((cells) => cells.length < 2)) return null;

  /* Two circles per room, and the size written on one of them. */
  const dots: number[] = [];
  const sizes: Record<number, number> = {};
  for (const cells of rooms) {
    const pick = rng.shuffle(cells.slice());
    dots.push(pick[0], pick[1]);
    sizes[pick[0]] = cells.length;
  }
  dots.sort((a, b) => a - b);

  const answer: number[] = [];
  for (let edge = 0; edge < edgeCount(w, h); edge++) {
    const [a, b] = cellsOf(w, h, edge);
    if (of[a] !== of[b]) answer.push(edge);
  }
  const isWall = new Set(answer);

  /* Every corner the answer walls at least twice: the crosses it may print. */
  const canCross: number[] = [];
  for (let corner = 0; corner < cornerCount(w, h); corner++) {
    if (edgesAtCorner(w, h, corner).filter((e) => isWall.has(e)).length >= 2) {
      canCross.push(corner);
    }
  }

  const crosses: number[] = [];
  const given: number[] = [];
  let nodes = 0;

  for (let round = 0; round < 80; round++) {
    const board: Board = { w, h, dots, sizes, crosses: [...crosses], given: [...given], answer };
    if (!judge(board, isWall).solved) return null;

    const found = search(board, 2);
    if (!found.exhausted) return null;
    if (found.count === 0) return null;
    nodes = found.nodes;

    if (found.count === 1) {
      const reading = analyse(board);
      if (reading.byReason) return thin(board, nodes, rng);
      /*
       * One answer, but only a search finds it. More clue is what makes a
       * board readable, so one more goes on and the whole thing is asked
       * again — a cross first, because a cross is the cheaper mark.
       */
      const spare = canCross.filter((c) => !crosses.includes(c));
      if (spare.length > 0) { crosses.push(spare[rng.int(spare.length)]); continue; }
      const spareWalls = answer.filter((e) => !given.includes(e));
      if (spareWalls.length === 0) return null;
      given.push(spareWalls[rng.int(spareWalls.length)]);
      continue;
    }

    /*
     * A rival, and something it was free to disagree about. A corner the
     * answer walls twice and the rival does not is the cheapest thing to take
     * away; failing that, a wall the answer has and the rival has not.
     *
     * The search hands back every answer it found up to the limit, and one of
     * them is usually the intended one — so the rival is the first that
     * differs. The walls are compared rather than the rooms, because the walls
     * are what is drawn and what a clue can take away.
     */
    const rival = found.all.find((sol) => sol.length !== answer.length
      || !answer.every((e) => sol.includes(e)));
    if (!rival) return null;
    const theirs = new Set(rival);
    const killer = canCross.find((corner) => !crosses.includes(corner)
      && edgesAtCorner(w, h, corner).filter((e) => theirs.has(e)).length < 2);
    if (killer !== undefined) { crosses.push(killer); continue; }
    const wall = answer.find((e) => !given.includes(e) && !theirs.has(e));
    if (wall === undefined) return null;
    given.push(wall);
  }
  return null;
}

/**
 * Take every clue back off that the board does not need.
 *
 * The loop above adds clues until the board reasons out, and it adds them
 * without knowing which one did the work — so by the time it stops, most of
 * them are paying for nothing. Each one is lifted in turn and put back only if
 * the board stops having one answer, or stops being reasonable without it.
 *
 * This is the difference between a board with a cross on every corner and a
 * board with three. A clue the player has to read and that rules nothing out
 * is worse than no clue at all: it is a promise that there was something to
 * see there.
 */
function thin(board: Board, nodes: number, rng: Rng): Made | null {
  let crosses = [...board.crosses];
  let given = [...board.given];

  const holds = (c: readonly number[], g: readonly number[]): Reading | null => {
    const trial: Board = { ...board, crosses: c, given: g };
    const found = search(trial, 2);
    if (!found.exhausted || found.count !== 1) return null;
    const reading = analyse(trial);
    return reading.byReason ? reading : null;
  };

  /* Drawn walls first: a wall is the most expensive thing on the page. */
  for (const edge of rng.shuffle([...given])) {
    const without = given.filter((e) => e !== edge);
    if (holds(crosses, without)) given = without;
  }
  for (const corner of rng.shuffle([...crosses])) {
    const without = crosses.filter((c) => c !== corner);
    if (holds(without, given)) crosses = without;
  }

  const reading = holds(crosses, given);
  if (!reading) return null;
  return { ...board, crosses, given, reading, nodes };
}

/*
 * The bands, cut from the quartiles of the measured spread. scripts/build-
 * isolate.ts prints it on every run, so they can be re-measured rather than
 * nudged if the score ever changes.
 */
export function bandOf(score: number): Band {
  if (score < 64) return 'gentle';
  if (score < 76) return 'steady';
  if (score < 87) return 'tricky';
  return 'severe';
}

export type Chapter = {
  readonly name: string;
  readonly count: number;
  readonly recipe: Recipe;
};

/**
 * The ladder. The grid grows and the rooms are allowed to get bigger, which is
 * the lever that matters: a board of twos and threes is nearly written for
 * you, and one where a room might be six is a board where the number on a
 * circle stops settling it.
 */
export const LADDER: readonly Chapter[] = [
  { name: 'Small Rooms', count: 8, recipe: { w: 4, h: 4, biggest: 3 } },
  { name: 'Twenty', count: 8, recipe: { w: 5, h: 4, biggest: 4 } },
  { name: 'Five Square', count: 8, recipe: { w: 5, h: 5, biggest: 4 } },
  { name: 'Longer Rooms', count: 8, recipe: { w: 6, h: 5, biggest: 5 } },
  { name: 'Thirty-Six', count: 8, recipe: { w: 6, h: 6, biggest: 5 } },
  { name: 'Forty-Two', count: 8, recipe: { w: 7, h: 6, biggest: 6 } },
];

export type Built = Board & {
  readonly id: string;
  readonly band: Band;
  readonly score: number;
  readonly chapter: number;
};

export function buildIsolate(seed = 'isolate-1', onProgress?: (msg: string) => void): Built[] {
  const out: Built[] = [];
  let no = 0;

  LADDER.forEach((chapter, ci) => {
    const rng = makeRng(`${seed}:${ci}`);
    const seen = new Set<string>();
    let made = 0;
    let tries = 0;
    const until = Date.now() + 90_000;
    while (made < chapter.count && tries < 40_000 && Date.now() < until) {
      tries++;
      const board = makeIsolate(chapter.recipe, rng);
      if (!board) continue;
      const score = scoreOf(board.reading);
      const key = board.answer.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      no++;
      made++;
      out.push({
        w: board.w,
        h: board.h,
        dots: board.dots,
        sizes: board.sizes,
        crosses: board.crosses,
        given: board.given,
        answer: board.answer,
        id: `isolate-${no}`,
        band: bandOf(score),
        score: Math.round(score * 10) / 10,
        chapter: ci + 1,
      });
    }
    onProgress?.(`${chapter.name}: ${made}/${chapter.count} in ${tries} draws`);
  });

  return out;
}

export { scoreOf };
