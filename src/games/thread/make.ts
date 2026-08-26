/**
 * Designing boards.
 *
 * Every board ships with exactly one answer, and the only way to know that is
 * to search for a second one and fail to find it. So the designer works the
 * other way round from the obvious: it builds the ANSWER first, then adds
 * constraint until nothing else works.
 *
 *   1. Lay a path that covers the lattice. That is the intended answer.
 *   2. Cut it into strings. Each cut is a pair of pinned ends.
 *   3. Search. While a second answer exists, take a freedom away — a WALL
 *      across a run the rival uses and the answer does not, or, when no wall
 *      will fit, one more cut.
 *   4. Then ask whether it can be REASONED out rather than searched out, and
 *      keep adding walls until it can.
 *
 * Steps 3 and 4 are the whole trick, and they never touch the answer: a wall
 * is only ever placed across a run the intended answer does not use, and a cut
 * changes where the string ends, not which posts it covers. So the answer that
 * was drawn in step 1 is still the answer at the end, and every board is
 * possible by construction.
 *
 * A wall is preferred to a cut wherever both would do, because a cut costs a
 * colour and a wall costs nothing — and the number of colours a board can wear
 * is the hard limit on this whole game (see INKS).
 */

import {
  type Board, type Block, type Pt, compile, segRectDist2, rectPointDist2,
  POST_R, STRING_W, BOARD,
} from './board.js';
import { judge } from './check.js';
import { search } from './search.js';
import { analyse, type Reading } from './reason.js';
import type { Rng } from '../../platform/rng.js';

export type Made = {
  readonly board: Board;
  /** Nodes the search needed to prove the answer unique — the difficulty. */
  readonly nodes: number;
};

/*
 * The budget for proving a board unique. A board that cannot be settled inside
 * it is thrown away rather than shipped: `search` reports an abandoned walk as
 * exhausted, and `carve` refuses anything exhausted, so "unique" always means
 * proven and never means "no second answer turned up in time".
 */
const VERIFY_NODES = 600_000;

// ---------------------------------------------------------------------------
// A path that covers a lattice
// ---------------------------------------------------------------------------

/**
 * A random Hamiltonian path on the cols x rows lattice.
 *
 * Randomised depth-first with the same two prunes the solver uses — a cell
 * with no way out, and cells cut off from the rest — because without them a
 * 6x6 board takes minutes and with them it takes a millisecond.
 */
export function latticePath(cols: number, rows: number, rng: Rng): number[] | null {
  const n = cols * rows;
  const nbrs: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = i % cols;
    const y = (i / cols) | 0;
    const list: number[] = [];
    if (x > 0) list.push(i - 1);
    if (x < cols - 1) list.push(i + 1);
    if (y > 0) list.push(i - cols);
    if (y < rows - 1) list.push(i + cols);
    nbrs.push(list);
  }

  const seen = new Uint8Array(n);
  const path: number[] = [];
  let budget = 200_000;

  const reachableCount = (from: number): number => {
    const stack = [from];
    const mark = new Uint8Array(n);
    mark[from] = 1;
    let count = 0;
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      for (const q of nbrs[p]) if (!seen[q] && !mark[q]) { mark[q] = 1; stack.push(q); }
    }
    return count;
  };

  const rec = (at: number): boolean => {
    if (budget-- <= 0) return false;
    if (path.length === n) return true;

    const options = rng.shuffle(nbrs[at].filter((q) => !seen[q]));
    if (options.length === 0) return false;
    // Everything still unvisited has to hang together with where we can go.
    if (reachableCount(options[0]) !== n - path.length) return false;

    for (const q of options) {
      seen[q] = 1; path.push(q);
      if (rec(q)) return true;
      path.pop(); seen[q] = 0;
    }
    return false;
  };

  for (let tries = 0; tries < 40; tries++) {
    seen.fill(0);
    path.length = 0;
    const start = rng.int(n);
    seen[start] = 1;
    path.push(start);
    if (rec(start)) return path.slice();
    budget = 200_000;
  }
  return null;
}

/** Lattice cell centres, evenly spread inside the board's margin. */
export function latticePosts(cols: number, rows: number): Pt[] {
  const margin = 12;
  const span = BOARD - margin * 2;
  const out: Pt[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      out.push([
        Math.round((margin + (cols === 1 ? span / 2 : (x * span) / (cols - 1))) * 100) / 100,
        Math.round((margin + (rows === 1 ? span / 2 : (y * span) / (rows - 1))) * 100) / 100,
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cutting one path into several strings
// ---------------------------------------------------------------------------

/** Cut a covering path into `pieces` strings, none shorter than `least`. */
export function cutPath(path: number[], pieces: number, least: number, rng: Rng): number[][] | null {
  if (pieces <= 1) return [path.slice()];
  if (path.length < pieces * least) return null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const cuts = new Set<number>();
    while (cuts.size < pieces - 1) cuts.add(1 + rng.int(path.length - 1));
    const at = [0, ...[...cuts].sort((a, b) => a - b), path.length];
    const out: number[][] = [];
    let ok = true;
    for (let i = 0; i + 1 < at.length; i++) {
      const piece = path.slice(at[i], at[i + 1]);
      if (piece.length < least) { ok = false; break; }
      out.push(piece);
    }
    if (ok) return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Carving to a single answer
// ---------------------------------------------------------------------------

const sameCover = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.length !== y.length) return false;
    const fwd = x.every((v, k) => v === y[k]);
    const rev = x.every((v, k) => v === y[y.length - 1 - k]);
    if (!fwd && !rev) return false;
  }
  return true;
};

const runKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function runsOf(cover: readonly (readonly number[])[]): Set<string> {
  const out = new Set<string>();
  for (const path of cover) {
    for (let i = 0; i + 1 < path.length; i++) out.add(runKey(path[i], path[i + 1]));
  }
  return out;
}

const BLOCK_SIDE = 4.2;

/**
 * A block that stops the run a..b without coming near the intended answer or
 * swallowing a post. Tried at several points along the run, because near the
 * ends it will usually be too close to the answer's own runs.
 */
function blockAcross(
  board: Board, a: number, b: number, keep: Set<string>, rng: Rng,
): Block | null {
  const pa = board.posts[a];
  const pb = board.posts[b];
  const ts = rng.shuffle([0.5, 0.42, 0.58, 0.35, 0.65]);
  for (const t of ts) {
    const cx = pa[0] + (pb[0] - pa[0]) * t;
    const cy = pa[1] + (pb[1] - pa[1]) * t;
    const blk: Block = {
      x: Math.round((cx - BLOCK_SIDE / 2) * 100) / 100,
      y: Math.round((cy - BLOCK_SIDE / 2) * 100) / 100,
      w: BLOCK_SIDE, h: BLOCK_SIDE,
    };
    let clear = true;
    for (let i = 0; i < board.posts.length && clear; i++) {
      if (rectPointDist2(blk, board.posts[i]) < (POST_R + 0.6) ** 2) clear = false;
    }
    for (const key of keep) {
      if (!clear) break;
      const [i, j] = key.split(':').map(Number);
      if (segRectDist2(board.posts[i], board.posts[j], blk) < (STRING_W + 0.4) ** 2) clear = false;
    }
    if (clear) return blk;
  }
  return null;
}

/**
 * Take one freedom away.
 *
 * A wall across the run a..b, placed so it comes nowhere near the intended
 * answer and swallows no post. Tried at several points along the run, because
 * near the ends it will usually be too close to the answer's own runs.
 */
function wallAcross(
  board: Board, a: number, b: number, keep: Set<string>, rng: Rng,
): Block | null {
  return blockAcross(board, a, b, keep, rng);
}

export type Settled = Made & { readonly reading: Reading };

/**
 * Add walls and cuts until the answer is the only one AND can be reasoned out.
 *
 * Returns null rather than a compromise. A board with two answers is not a
 * puzzle; a board with one answer that nothing but trial and error will find
 * is a worse thing — it looks like a puzzle and it is a maze.
 */
function settle(
  posts: readonly Pt[], lattice: { cols: number; rows: number },
  path: number[], cuts: Set<number>, rng: Rng, maxInks: number,
): Settled | null {
  let blocks: Block[] = [];

  const build = (): number[][] | null => {
    const at = [0, ...[...cuts].sort((x, y) => x - y), path.length];
    const out: number[][] = [];
    for (let i = 0; i + 1 < at.length; i++) {
      const piece = path.slice(at[i], at[i + 1]);
      // A one-post strand pins a post to itself, which is not a string.
      if (piece.length < 2) return null;
      out.push(piece);
    }
    return out;
  };

  /** Somewhere to put a wall that the intended answer will not mind. */
  const addWall = (board: Board, over: readonly string[], keep: Set<string>): boolean => {
    for (const key of rng.shuffle([...over])) {
      if (keep.has(key)) continue;
      const [i, j] = key.split(':').map(Number);
      const wall = wallAcross(board, i, j, keep, rng);
      if (wall) { blocks = [...blocks, wall]; return true; }
    }
    return false;
  };

  for (let round = 0; round < 60; round++) {
    const cover = build();
    if (!cover) return null;
    if (cover.length > maxInks) return null;

    const board: Board = {
      id: 'pending',
      chapter: 0,
      posts,
      blocks,
      strands: cover.map((piece, i) => ({
        from: piece[0], to: piece[piece.length - 1], color: INKS[i],
      })),
      lattice,
      solution: cover,
    };
    const c = compile(board);
    if (!judge(c, cover).solved) return null;

    const keep = runsOf(cover);
    const found = search(c, 2, VERIFY_NODES);
    if (found.exhausted || found.solutions.length === 0) return null;

    if (found.solutions.length === 1) {
      const reading = analyse(c);
      if (reading.byReason) return { board, nodes: found.nodes, reading };
      /*
       * One answer, but only a search finds it. More constraint is what makes
       * a board readable, so a wall goes across a run the answer does not use
       * and the whole thing is asked again.
       */
      const spare = c.runs
        .map((r) => runKey(r.a, r.b))
        .filter((k) => !keep.has(k));
      if (!addWall(board, spare, keep)) return null;
      continue;
    }

    const rival = found.solutions.find((sol) => !sameCover(sol, cover));
    if (!rival) return null;
    if (addWall(board, [...runsOf(rival)], keep)) continue;

    /*
     * No wall will fit, so the rival is disagreeing about a run the answer
     * itself uses. Cutting there takes that freedom away instead — at the cost
     * of one more colour, which is why it is the second choice.
     */
    const theirs = runsOf(rival);
    let cutAt = -1;
    for (let i = 0; i + 1 < path.length; i++) {
      if (cuts.has(i + 1)) continue;
      if (theirs.has(runKey(path[i], path[i + 1]))) continue;
      const next = [0, ...[...cuts, i + 1].sort((x, y) => x - y), path.length];
      let fits = true;
      for (let k = 0; k + 1 < next.length; k++) {
        if (next[k + 1] - next[k] < 2) { fits = false; break; }
      }
      if (fits) { cutAt = i + 1; break; }
    }
    if (cutAt < 0 || cuts.size + 1 >= maxInks) return null;
    cuts.add(cutAt);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The inks
// ---------------------------------------------------------------------------

/*
 * Six colours, and the reason there are six of them.
 *
 * A colour is not decoration here, it is the whole instruction: two dots of
 * one colour say "join these" without a word of text. So two strands may never
 * share one, and the palette is a hard ceiling on how many strings a board can
 * have.
 *
 * There used to be twelve, with a NUMBER printed on every pinned end, because
 * twelve inks cannot be told apart: measured as colour difference, the worst
 * pair of that set was 2.1 — under a simulation of common colour blindness,
 * effectively the same ink twice. The numbers were the patch.
 *
 * These six are Okabe and Ito's qualitative set, chosen for exactly this
 * problem. Measured the same way, the worst pair here is 19 in ordinary
 * vision, in deuteranopia and in protanopia alike — which is a difference
 * nobody has to squint at. So the numbers are gone, and the board is back to
 * saying what it means with colour alone.
 */
export const INKS = [
  '#D55E00', '#0072B2', '#009E73', '#CC79A7', '#E69F00', '#56B4E9',
];

export type Recipe = {
  readonly cols: number;
  readonly rows: number;
  /** How many strings to start from. The designer adds more if it must. */
  readonly strands: number;
};

/** One board, or null if this seed did not produce a sound one. */
export function makeBoard(id: string, r: Recipe, rng: Rng): Settled | null {
  const path = latticePath(r.cols, r.rows, rng);
  if (!path) return null;
  const posts = latticePosts(r.cols, r.rows);
  const lattice = { cols: r.cols, rows: r.rows };

  /*
   * Where the path is cut decides the puzzle, so one covering path is worth
   * several boards. Trying a handful of cuts here rather than throwing the
   * path away is most of the difference between a designer that fills a
   * chapter and one that does not.
   */
  for (let attempt = 0; attempt < 8; attempt++) {
    const cover = cutPath(path, r.strands, 2, rng);
    if (!cover) return null;
    const cuts = new Set<number>();
    let at = 0;
    for (let i = 0; i + 1 < cover.length; i++) { at += cover[i].length; cuts.add(at); }
    const made = settle(posts, lattice, path, cuts, rng, INKS.length);
    if (made) return { ...made, board: { ...made.board, id } };
  }
  return null;
}
