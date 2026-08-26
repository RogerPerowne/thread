/**
 * Designing Zigzag boards.
 *
 * The wrong way round is to scatter numbers and hope a line exists. The right
 * way is the same trick every designer in this catalogue uses: build the
 * ANSWER first, then read the puzzle off it.
 *
 *   1. Find a Hamiltonian path from the start cell to the finish cell.
 *   2. Number each cell by where it falls on that path.
 *   3. Ask the solver how many lines the numbering admits.
 *
 * Step 3 is the whole thing. A numbering derived from a path always admits at
 * least that path, so the only question is whether it admits a second — and
 * when it does, the board is thrown away rather than shipped. There is no
 * repair step here because there is nothing to repair with: the numbers ARE
 * the puzzle, and changing one changes the answer.
 *
 * That makes the designer a filter rather than a builder, which is fine
 * because Hamiltonian paths on an eight-connected grid are plentiful. Roughly
 * one in six numberings turns out unique at the sizes we ship.
 */

import { adjacency, type Zig } from './model.js';
import { solve } from './solve.js';
import { makeRng, type Rng } from '../../platform/rng.js';
import type { Band } from '../../platform/types.js';

export type Made = {
  readonly zig: Zig;
  readonly nodes: number;
  /** Share of steps where only one move was legal, 0..1. */
  readonly forcedShare: number;
};

const VERIFY_NODES = 500_000;

/**
 * A Hamiltonian path from `start` to `finish`, or null.
 *
 * Randomised depth-first with the two prunes that make it terminate: a cell
 * with no way out is lost, and everything unvisited has to stay connected to
 * where we are. Without them a 7 x 7 board takes minutes; with them it takes
 * about a millisecond.
 */
export function hamiltonian(
  w: number, h: number, start: number, finish: number, rng: Rng,
): number[] | null {
  const n = w * h;
  const nbr = adjacency(w, h);
  const seen = new Uint8Array(n);
  const path: number[] = [];
  const queue = new Int32Array(n);
  const mark = new Uint8Array(n);
  let budget = 300_000;

  const connected = (at: number): boolean => {
    mark.fill(0);
    let qn = 0;
    queue[qn++] = at;
    mark[at] = 1;
    let reached = 0;
    for (let i = 0; i < qn; i++) {
      for (const q of nbr[queue[i]]) {
        if (seen[q] || mark[q]) continue;
        mark[q] = 1;
        queue[qn++] = q;
        reached++;
      }
    }
    let missing = 0;
    for (let i = 0; i < n; i++) if (!seen[i]) missing++;
    return reached >= missing && (missing === 0 || mark[finish] === 1 || finish === at);
  };

  const rec = (at: number): boolean => {
    if (budget-- <= 0) return false;
    if (path.length === n) return at === finish;
    // Reaching the finish early strands whatever is left.
    if (at === finish) return false;
    if (!connected(at)) return false;

    for (const q of rng.shuffle(nbr[at].filter((c) => !seen[c]))) {
      seen[q] = 1;
      path.push(q);
      if (rec(q)) return true;
      path.pop();
      seen[q] = 0;
    }
    return false;
  };

  for (let tries = 0; tries < 30; tries++) {
    seen.fill(0);
    path.length = 0;
    seen[start] = 1;
    path.push(start);
    if (rec(start)) return path.slice();
    budget = 300_000;
  }
  return null;
}

export type Recipe = {
  readonly w: number;
  readonly h: number;
  readonly sequence: readonly number[];
};

/** One board, or null if this seed did not produce a sound one. */
export function makeZig(r: Recipe, rng: Rng): Made | null {
  const n = r.w * r.h;
  const start = 0;
  const finish = n - 1;
  const path = hamiltonian(r.w, r.h, start, finish, rng);
  if (!path) return null;

  const cells = new Array<number>(n).fill(0);
  for (let i = 0; i < path.length; i++) {
    cells[path[i]] = r.sequence[i % r.sequence.length];
  }

  const zig: Zig = {
    w: r.w, h: r.h, cells, sequence: r.sequence, start, finish, answer: path,
  };

  const found = solve(zig, 2, VERIFY_NODES);
  if (found.exhausted || found.paths.length !== 1) return null;

  const steps = found.forced + found.choices;
  return {
    zig,
    nodes: found.nodes,
    forcedShare: steps === 0 ? 1 : found.forced / steps,
  };
}

/**
 * How hard a board is for a person.
 *
 * Not the size. A board where nearly every step has exactly one legal
 * continuation can be walked without thinking however large it is, and a small
 * board that branches at every turn cannot. So the measure is how often the
 * player is actually made to choose, tempered by how much searching it took to
 * prove the answer unique — the first is what it feels like, the second is
 * what it costs.
 */
export function bandOf(made: Made): Band {
  /*
   * Weights from measurement rather than taste. Across the shipped sizes the
   * forced share barely moves — 60 to 73 per cent — so on its own it separates
   * almost nothing, while the search cost spans three orders of magnitude and
   * tracks how much of the board a person has to hold in their head. So the
   * cost leads and the branching tilts it: two boards that took the same
   * search are ordered by how often the player is actually made to choose.
   */
  const choosing = 1 - made.forcedShare;
  const score = Math.log10(Math.max(1, made.nodes)) * 22 + choosing * 60;
  if (score < 70) return 'gentle';
  if (score < 88) return 'steady';
  if (score < 104) return 'tricky';
  return 'severe';
}

/** The shipped ladder: sizes, and how many of each. */
export const LADDER: readonly (Recipe & { count: number })[] = [
  { w: 5, h: 5, sequence: [1, 2, 3, 4], count: 8 },
  { w: 6, h: 5, sequence: [1, 2, 3, 4], count: 8 },
  { w: 6, h: 6, sequence: [1, 2, 3, 4], count: 8 },
  { w: 7, h: 6, sequence: [1, 2, 3, 4], count: 8 },
  { w: 7, h: 7, sequence: [1, 2, 3, 4], count: 8 },
  { w: 8, h: 7, sequence: [1, 2, 3, 4], count: 4 },
];

/** Build the whole ladder, deterministically from one seed. */
export function buildZigzag(seed: string): Made[] {
  const out: Made[] = [];
  const seen = new Set<string>();
  let band = 0;
  for (const recipe of LADDER) {
    band++;
    let made = 0;
    for (let attempt = 0; made < recipe.count && attempt < recipe.count * 200; attempt++) {
      const rng = makeRng(`${seed}/zigzag/${band}/${attempt}`);
      const m = makeZig(recipe, rng);
      if (!m) continue;
      // Two boards with the same numbering are the same puzzle.
      const print = `${recipe.w}x${recipe.h}|${m.zig.cells.join('')}`;
      if (seen.has(print)) continue;
      seen.add(print);
      out.push(m);
      made++;
    }
  }
  return out;
}
