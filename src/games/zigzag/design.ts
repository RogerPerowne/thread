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

/** How long one chapter may spend looking, before it ships what it has. */
const CHAPTER_MS = Number(process.env.CHAPTER_MS ?? 240_000);

/**
 * A Hamiltonian path from `start` to `finish`, or null.
 *
 * Randomised depth-first with the two prunes that make it terminate: a cell
 * with no way out is lost, and everything unvisited has to stay connected to
 * where we are. Without them a 7 x 7 board takes minutes; with them it takes
 * about a millisecond.
 */
export function hamiltonian(
  w: number, h: number, start: number, finish: number, rng: Rng, diagonal = true,
): number[] | null {
  const n = w * h;
  const nbr = adjacency(w, h, diagonal);
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
  /** May the line step corner to corner? Four ways on instead of eight. */
  readonly diagonal: boolean;
};

/** One board, or null if this seed did not produce a sound one. */
export function makeZig(r: Recipe, rng: Rng): Made | null {
  /* Refused, not searched for. Without this the designer spends its whole
     budget looking for a path parity says cannot exist. */
  if (!r.diagonal && !orthogonalPossible(r.w, r.h)) return null;
  const n = r.w * r.h;
  const start = 0;
  const finish = n - 1;
  const path = hamiltonian(r.w, r.h, start, finish, rng, r.diagonal);
  if (!path) return null;

  const cells = new Array<number>(n).fill(0);
  for (let i = 0; i < path.length; i++) {
    cells[path[i]] = r.sequence[i % r.sequence.length];
  }

  const zig: Zig = {
    w: r.w, h: r.h, cells, sequence: r.sequence, start, finish,
    diagonal: r.diagonal, answer: path,
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
export function scoreOf(made: Made): number {
  /*
   * Weights from measurement rather than taste. Across the shipped sizes the
   * forced share barely moves — 60 to 73 per cent — so on its own it separates
   * almost nothing, while the search cost spans three orders of magnitude and
   * tracks how much of the board a person has to hold in their head. So the
   * cost leads and the branching tilts it: two boards that took the same
   * search are ordered by how often the player is actually made to choose.
   */
  const choosing = 1 - made.forcedShare;
  return Math.log10(Math.max(1, made.nodes)) * 22 + choosing * 60;
}

export function bandOf(made: Made): Band {
  const score = scoreOf(made);
  if (score < 48) return 'gentle';
  if (score < 59) return 'steady';
  if (score < 71) return 'tricky';
  return 'severe';
}

/**
 * Corner to corner without diagonals is impossible on some boards, and it is
 * a parity fact rather than a search that fails.
 *
 * Colour the grid like a chessboard. A line stepping only up, down, left and
 * right changes colour every step, so a path through all w*h cells has
 * endpoints of the same colour when w*h is odd and opposite colours when it is
 * even. The start is (0, 0) and the finish is the far corner, whose colour is
 * (w + h) mod 2. Work both cases through and exactly one shape fails: w and h
 * BOTH even. Six by six has no orthogonal answer at all, and no amount of
 * looking will find one.
 */
export function orthogonalPossible(w: number, h: number): boolean {
  return w % 2 === 1 || h % 2 === 1;
}

/**
 * The ladder: seventeen chapters, ordered by what the measure says.
 *
 * Three levers, and the measurement is the whole reason they are in this
 * order rather than in the order they look like they should be in.
 *
 * **Diagonals.** The biggest lever by a distance, and the one that separates
 * the easy end from the rest. Off, the line has four ways out of a cell and
 * about one of them carries the next number, so most steps are forced and the
 * line very nearly draws itself; on, it has eight and two or three are legal,
 * which is a search. Measured on the same sizes the difference is 47 against
 * 90, and 41 against 104 — bigger than going from a five by five to an eight
 * by seven. So every chapter below the halfway mark is a board the line can
 * only be drawn on straight.
 *
 * **How many numbers.** Backwards from how it looks. MORE numbers in the
 * sequence is EASIER, because a longer run means a smaller share of the
 * neighbours carry the next one: five numbers measures 35 where four measures
 * 65 on the same board. Two numbers is not a difficulty at all, it is a broken
 * puzzle — half of every neighbourhood is legal and no board of any size came
 * out with one answer. Three, four and five are the range.
 *
 * **Size.** The weakest of the three, and the one everybody reaches for first.
 * Across a whole ladder it moves the measure about as far as one step of
 * either of the others.
 */
export const LADDER: readonly (Recipe & { name: string; count: number })[] = [
  { name: 'Straight Lines', w: 5, h: 5, sequence: [1, 2, 3, 4, 5], diagonal: false, count: 30 },
  { name: 'A Longer Run', w: 6, h: 5, sequence: [1, 2, 3, 4, 5], diagonal: false, count: 30 },
  { name: 'Six by Five', w: 7, h: 6, sequence: [1, 2, 3, 4, 5], diagonal: false, count: 30 },
  { name: 'Three Numbers', w: 5, h: 5, sequence: [1, 2, 3], diagonal: false, count: 30 },
  { name: 'Seven Across', w: 7, h: 7, sequence: [1, 2, 3, 4, 5], diagonal: false, count: 30 },
  { name: 'Fewer to Go On', w: 6, h: 5, sequence: [1, 2, 3], diagonal: false, count: 30 },
  { name: 'The Long Board', w: 8, h: 7, sequence: [1, 2, 3, 4, 5], diagonal: false, count: 30 },
  { name: 'Wider Still', w: 7, h: 6, sequence: [1, 2, 3], diagonal: false, count: 30 },
  { name: 'Corners Open', w: 5, h: 5, sequence: [1, 2, 3, 4, 5], diagonal: true, count: 30 },
  { name: 'Forty-Nine', w: 7, h: 7, sequence: [1, 2, 3], diagonal: false, count: 30 },
  { name: 'Eight Ways Out', w: 6, h: 5, sequence: [1, 2, 3, 4, 5], diagonal: true, count: 30 },
  { name: 'Four and Free', w: 5, h: 5, sequence: [1, 2, 3, 4], diagonal: true, count: 30 },
  { name: 'Thirty-Six', w: 6, h: 6, sequence: [1, 2, 3, 4, 5], diagonal: true, count: 30 },
  { name: 'Room to Wander', w: 6, h: 5, sequence: [1, 2, 3, 4], diagonal: true, count: 30 },
  { name: 'Across the Diagonal', w: 7, h: 6, sequence: [1, 2, 3, 4, 5], diagonal: true, count: 30 },
  { name: 'Four Numbers', w: 7, h: 6, sequence: [1, 2, 3, 4], diagonal: false, count: 30 },
  { name: 'Three and Free', w: 5, h: 5, sequence: [1, 2, 3], diagonal: true, count: 20 },
];

/** Build the whole ladder, deterministically from one seed. */
export type Chaptered = Made & { readonly chapter: number; readonly score: number };

export function buildZigzag(
  seed: string, onProgress?: (msg: string) => void,
): Chaptered[] {
  const out: Chaptered[] = [];
  const seen = new Set<string>();
  /* Seeded by the recipe rather than by position — see One to Nine's note. */
  LADDER.forEach((recipe, ci) => {
    const key = `${recipe.w}x${recipe.h}s${recipe.sequence.length}${recipe.diagonal ? 'd' : 'o'}`;
    if (!recipe.diagonal && !orthogonalPossible(recipe.w, recipe.h)) {
      throw new Error(`${recipe.name}: ${recipe.w}x${recipe.h} has no straight-only answer`);
    }
    const batch: Chaptered[] = [];
    const until = Date.now() + CHAPTER_MS;
    for (let attempt = 0; batch.length < recipe.count && attempt < recipe.count * 4000; attempt++) {
      if (Date.now() > until) break;
      const rng = makeRng(`${seed}/zigzag/${key}/${attempt}`);
      const m = makeZig(recipe, rng);
      if (!m) continue;
      // Two boards with the same numbering are the same puzzle.
      const print = `${recipe.w}x${recipe.h}|${m.zig.cells.join('')}`;
      if (seen.has(print)) continue;
      seen.add(print);
      batch.push({ ...m, chapter: ci + 1, score: scoreOf(m) });
    }
    /* Sorted inside the chapter too, so the thirty levels of it climb rather
       than arriving in whatever order the generator happened to find them. */
    batch.sort((a, b) => a.score - b.score);
    out.push(...batch);
    onProgress?.(`${recipe.name}: ${batch.length}/${recipe.count}`);
  });
  return out;
}
