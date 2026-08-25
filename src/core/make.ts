/**
 * Designing boards.
 *
 * Every board ships with exactly one answer, and the only way to know that is
 * to search for a second one and fail to find it. So the designer works the
 * other way round from the obvious: it builds the ANSWER first, then adds
 * constraint until nothing else works.
 *
 *   1. Lay a path that covers a lattice. That is the intended answer.
 *   2. Shake the posts off the lattice so the board does not look like graph
 *      paper — and, more importantly, so runs are no longer only orthogonal.
 *   3. Search. If a second answer exists, drop a block on a run that answer
 *      uses and the intended one does not, and search again.
 *
 * Step 3 is the whole trick. Each block kills one rival without touching the
 * intended answer, so the count comes down without the answer ever changing.
 *
 * Post width does a great deal of the work for free: a run only exists if it
 * clears every post it does not use, so on a board with posts this close
 * together the long runs are already impossible and the graph is sparse before
 * a single block is placed.
 */

import {
  type Board, type Block, type Pt, compile, segRectDist2, rectPointDist2,
  POST_R, STRING_W, BOARD,
} from './board.js';
import { judge } from './check.js';
import { search } from './search.js';
import type { Rng } from './rng.js';

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

/** Lattice cell centres, shaken off the grid so the board is not graph paper. */
export function shakenPosts(cols: number, rows: number, rng: Rng, shake: number): Pt[] {
  const margin = 12;
  const span = BOARD - margin * 2;
  const out: Pt[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = margin + (cols === 1 ? span / 2 : (x * span) / (cols - 1));
      const cy = margin + (rows === 1 ? span / 2 : (y * span) / (rows - 1));
      out.push([
        Math.round((cx + rng.range(-shake, shake)) * 100) / 100,
        Math.round((cy + rng.range(-shake, shake)) * 100) / 100,
      ]);
    }
  }
  return out;
}

/** Exact lattice cell centres, for Grid boards. */
export function latticePosts(cols: number, rows: number): Pt[] {
  return shakenPosts(cols, rows, { range: () => 0 } as unknown as Rng, 0);
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
 * Add blocks until `intended` is the only answer.
 *
 * Returns null rather than a compromise: a board with two answers is not a
 * puzzle, and a board whose answer the blocks broke is a bug.
 */
export function carve(base: Board, intended: number[][], rng: Rng, maxBlocks = 7): Made | null {
  const keep = runsOf(intended);
  let blocks = [...base.blocks];

  for (let round = 0; round <= maxBlocks; round++) {
    const board: Board = { ...base, blocks, solution: intended };
    const c = compile(board);
    if (!judge(c, intended).solved) return null;

    const found = search(c, 2, VERIFY_NODES);
    if (found.exhausted) return null;
    if (found.solutions.length === 0) return null;
    if (found.solutions.length === 1) return { board, nodes: found.nodes };
    if (round === maxBlocks) return null;

    const rival = found.solutions.find((s) => !sameCover(s, intended));
    if (!rival) return null;
    const spare = rng.shuffle(
      [...runsOf(rival)].filter((k) => !keep.has(k)),
    );
    let placed: Block | null = null;
    for (const key of spare) {
      const [i, j] = key.split(':').map(Number);
      placed = blockAcross(board, i, j, keep, rng);
      if (placed) break;
    }
    if (!placed) return null;
    blocks = [...blocks, placed];
  }
  return null;
}

// ---------------------------------------------------------------------------
// The three modes
// ---------------------------------------------------------------------------

export const INKS = [
  '#D2452E', '#1F6FEB', '#E8A33D', '#2E9E6B', '#8B5CF6', '#D9488F', '#0FA3B1',
];

export type Recipe = {
  readonly cols: number;
  readonly rows: number;
  readonly strands: number;
  readonly shake: number;
  /**
   * Leave both ends of a single string unpinned. A purer puzzle, but a far
   * looser one: with no ends given it takes six or seven blocks to pin the
   * answer down, and a board that cluttered is a worse thing to look at than
   * the free ends are worth.
   */
  readonly freeEnds?: boolean;
};

/** One board, or null if this seed did not produce a sound one. */
export function makeBoard(
  mode: Board['mode'], id: string, r: Recipe, rng: Rng,
): Made | null {
  const path = latticePath(r.cols, r.rows, rng);
  if (!path) return null;

  const grid = mode === 'grid';
  const posts = grid ? latticePosts(r.cols, r.rows) : shakenPosts(r.cols, r.rows, rng, r.shake);

  /*
   * Where the path is cut decides the puzzle, so one lattice path is worth
   * several boards. Trying a handful of cuts here rather than throwing the
   * path away is most of the difference between a designer that fills a
   * chapter and one that does not.
   */
  for (let cut = 0; cut < 8; cut++) {
    const cover = cutPath(path, r.strands, grid ? 2 : 3, rng);
    if (!cover) return null;

    const free = r.strands === 1 && !grid && r.freeEnds === true;
    const strands = cover.map((piece, i) => ({
      from: free ? -1 : piece[0],
      to: free ? -1 : piece[piece.length - 1],
      color: INKS[i % INKS.length],
    }));

    const base: Board = {
      id, mode, chapter: 0, posts, blocks: [], strands,
      lattice: grid ? { cols: r.cols, rows: r.rows } : undefined,
      solution: cover,
    };

    // A grid board is constrained by its lattice and its pinned ends alone —
    // dropping walls into it would make it a different game. If a cut does not
    // pin the answer down, that is a cut to throw away, not a board to patch.
    if (grid) {
      const c = compile(base);
      if (!judge(c, cover).solved) continue;
      const found = search(c, 2, VERIFY_NODES);
      if (found.exhausted || found.solutions.length !== 1) continue;
      return { board: base, nodes: found.nodes };
    }
    const made = carve(base, cover, rng);
    if (made) return made;
  }
  return null;
}
