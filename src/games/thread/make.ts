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
 *
 * The budget is generous because it has to be, and it has grown twice as the
 * rule has been let out. Running through post centres rather than round them
 * means a run only has to clear a post by the string's own width; dropping the
 * old refusal of a sharp turn opened up a third of the routes on every board;
 * and dropping the last of it — a fold is now never a fault, because a string
 * round a nail is entitled to touch itself there — opened up the rest.
 *
 * Every one of those makes the run graph denser and uniqueness harder to
 * reach, so the number of blocks it takes to leave one answer standing has
 * gone up each time. That is the right way to pay for it. Blocks are part of
 * the game and they are honest: they say what they do. A rule that refuses
 * moves the picture allows is the one thing this game cannot afford, because
 * the player cannot see it and cannot act on it.
 */
export function carve(base: Board, intended: number[][], rng: Rng, maxBlocks = 32): Made | null {
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

/**
 * Refine a grid board until its answer is the only one.
 *
 * A lattice board has nothing to carve with: the only thing holding the answer
 * down is where the string ends are pinned. So the grid designer does what
 * `carve` does, with the one tool it has — it cuts the covering path again.
 *
 * Find a rival answer, find the first place where the intended path uses a run
 * the rival does not, and cut the path there. The two cells either side of
 * that cut become a new pair of pinned ends, which is precisely the fact the
 * rival was free to disagree about. Cutting never changes which cells are
 * covered, so the intended answer survives every round — the same property
 * that makes `carve` safe.
 *
 * How many pairs a board ends up with is therefore measured, not chosen. The
 * recipe asks for a starting number and the board is told how many it actually
 * needs, which is the honest way round: nobody can know in advance how much
 * pinning a particular 12 x 12 lattice takes.
 */
function refine(base: Board, path: number[], want: number, rng: Rng): Made | null {
  let cuts = new Set<number>();
  {
    // Start from the requested number of pairs, spread at random.
    const spread = rng.shuffle([...path.keys()].slice(1, path.length - 1));
    for (const at of spread) {
      if (cuts.size >= want - 1) break;
      cuts.add(at);
    }
  }

  const build = (): number[][] | null => {
    const at = [0, ...[...cuts].sort((a, b) => a - b), path.length];
    const out: number[][] = [];
    for (let i = 0; i + 1 < at.length; i++) {
      const piece = path.slice(at[i], at[i + 1]);
      // A one-cell strand pins a cell to itself, which is not a string.
      if (piece.length < 2) return null;
      out.push(piece);
    }
    return out;
  };

  /*
   * Every cut is one more pair of ends, and every pair needs a colour of its
   * own — two strings the same colour is two strings the player cannot tell
   * apart, which is worse than no board at all. So the palette is the ceiling,
   * and a lattice that cannot be pinned down inside it is one this designer
   * honestly cannot make.
   */
  const maxCuts = Math.min(INKS.length, Math.floor(path.length / 2)) - 1;
  if (cuts.size > maxCuts) return null;

  for (;;) {
    const cover = build();
    if (!cover) return null;
    const board: Board = {
      ...base,
      strands: cover.map((piece, i) => ({
        from: piece[0], to: piece[piece.length - 1], color: INKS[i % INKS.length],
      })),
      solution: cover,
    };
    const c = compile(board);
    if (!judge(c, cover).solved) return null;

    const found = search(c, 2, VERIFY_NODES);
    if (found.exhausted) return null;
    if (found.solutions.length === 0) return null;
    if (found.solutions.length === 1) return { board, nodes: found.nodes };

    const rival = found.solutions.find((s) => !sameCover(s, cover));
    if (!rival) return null;
    const theirs = runsOf(rival);
    // The first run of the intended path the rival does not use is a place the
    // rival was free to disagree. Cutting there takes that freedom away.
    let cutAt = -1;
    for (let i = 0; i + 1 < path.length; i++) {
      if (cuts.has(i + 1)) continue;
      if (theirs.has(runKey(path[i], path[i + 1]))) continue;
      const next = new Set(cuts);
      next.add(i + 1);
      const sorted = [0, ...[...next].sort((a, b) => a - b), path.length];
      let fits = true;
      for (let k = 0; k + 1 < sorted.length; k++) {
        if (sorted[k + 1] - sorted[k] < 2) { fits = false; break; }
      }
      if (fits) { cutAt = i + 1; break; }
    }
    if (cutAt < 0 || cuts.size >= maxCuts) return null;
    cuts = new Set(cuts).add(cutAt);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The three modes
// ---------------------------------------------------------------------------

/*
 * The inks, and the reason there are twelve of them.
 *
 * On a Coloured or Grid board a colour is not decoration, it is the whole
 * instruction: two dots of one colour say "join these" without a word of text.
 * So two strands may never share one. That makes the palette a hard limit on
 * how many strings a board can have — and, on a lattice, a hard limit on how
 * big the board can be, because the bigger it is the more pairs it takes to
 * pin one answer down.
 *
 * Twelve is where legibility gives out: an even turn round the hue wheel, each
 * one nameable, none of them a near-miss for its neighbours at the size a post
 * is drawn on a phone. Squeezing in a thirteenth would buy one more chapter at
 * the cost of two strings a player cannot tell apart, which is not a trade.
 *
 * They alternate light and dark as they go round, which matters more than it
 * sounds: twelve hues means three of them land in the greens, and three greens
 * of the same weight are three greens nobody can pair up. Two axes to tell
 * them apart beats one, and it is also what makes the set survive being seen
 * by an eye that does not separate red from green.
 */
export const INKS = [
  '#D2452E', '#F07818', '#E0A21A', '#8C8A12', '#63B22B', '#12805A',
  '#12B5C4', '#1F6FEB', '#3B2FB5', '#9B5CF6', '#C0219E', '#E8659C',
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

    // A grid board has no blocks to carve with — walls in a lattice would make
    // it a different game — so it is refined instead: see `refine`.
    if (grid) {
      const made = refine(base, path, r.strands, rng);
      if (made) return made;
      continue;
    }
    const made = carve(base, cover, rng);
    if (made) return made;
  }
  return null;
}
