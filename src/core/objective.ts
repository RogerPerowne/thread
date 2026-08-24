/**
 * What a level asks of you.
 *
 * Every level up to now asked the same question — reproduce this shape — and
 * drew the answer on the board as a dashed outline through the exact pegs, in
 * order. That makes tracing the whole skill, and wastes the one genuinely
 * interesting thing about the mechanic: under the even-odd rule the same five
 * pegs make a pentagon or a pentagram depending only on the order you visit
 * them in.
 *
 * An objective is how a level states its goal. Four of them exist, and the
 * shape objective is only the first:
 *
 *   shape       reproduce the region. The outline is shown.
 *   silhouette  reproduce the region. Only the filled area is shown, so on a
 *               level whose pegs admit more than one region you have to work
 *               out the order rather than read it off.
 *   par         reproduce the region in at most this many segments. Boards
 *               carry spare pegs along the edges of the shape, so the region
 *               is the same however many of them you stop at: the puzzle is
 *               to find its corners. Length is already the spool's job, so
 *               par counts moves instead.
 *   enclose     no target at all: enclose these pegs, exclude those, within a
 *               segment budget. You invent the loop.
 *   clue        no target at all: the string runs along the board's wires, and
 *               each numbered cell says how many of its four sides the loop
 *               uses. Exactly one loop fits.
 *
 * Everything here is pure and DOM-free: the game, the solver, the level gate
 * and the tests all decide "is this a win" through the same code.
 */

import type { Pt } from './geometry.js';

export type Objective =
  | { kind: 'shape' }
  | { kind: 'silhouette' }
  | { kind: 'par'; segments: number }
  | { kind: 'enclose'; inside: number[]; outside: number[]; maxSegments: number }
  | { kind: 'clue'; cols: number; rows: number; clues: (number | null)[] };

export const DEFAULT_OBJECTIVE: Objective = { kind: 'shape' };

/** Objectives that judge the region rather than a rule about the loop. */
export function judgesShape(o: Objective): boolean {
  return o.kind === 'shape' || o.kind === 'silhouette' || o.kind === 'par';
}

/** Whether the target outline may be drawn on the board. */
export function showsOutline(o: Objective): boolean {
  return o.kind === 'shape' || o.kind === 'par';
}

/**
 * Whether the target region may be drawn on the board at all.
 *
 * A corral and a clue board ask a rule, not a picture: shading the region the
 * answer encloses would BE the answer, and there would be nothing left to
 * work out. A silhouette is the opposite case — the region is the whole
 * puzzle and only the order is withheld.
 *
 * This happens to name the same set as `judgesShape`, but it answers a
 * different question: one is what the game checks, the other is what the
 * player is allowed to see.
 */
export function showsRegion(o: Objective): boolean {
  return o.kind === 'shape' || o.kind === 'silhouette' || o.kind === 'par';
}

// ---------------------------------------------------------------------------
// Enclosure
// ---------------------------------------------------------------------------

/**
 * Is `p` inside the closed loop, by the even-odd rule the whole game uses?
 *
 * Ray casting rather than a raster sample: a peg one cell from an edge would
 * be at the mercy of where the grid happened to fall, and the answer here
 * decides whether a level is won.
 *
 * A point exactly on an edge is not a meaningful answer to "inside or out",
 * so the caller must keep marked pegs off the loop. `onEdge` reports that
 * case so the gate can reject a level where it could happen.
 */
export function pointInLoop(p: Pt, loop: readonly Pt[], eps = 1e-9): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if ((yi > p[1] + eps) !== (yj > p[1] + eps)) {
      const x = xi + ((p[1] - yi) * (xj - xi)) / (yj - yi);
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/** How near `p` comes to the loop's outline. */
export function distanceToLoop(p: Pt, loop: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    best = Math.min(best, pointToSegment(p, loop[j], loop[i]));
  }
  return best;
}

function pointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

export interface EncloseVerdict {
  ok: boolean;
  /** 0-1: how much of the requirement is met, for honest near-miss feedback. */
  score: number;
  wrongInside: number[];
  wrongOutside: number[];
  overBudget: boolean;
}

export function checkEnclose(
  spec: { inside: readonly number[]; outside: readonly number[]; maxSegments: number },
  pegs: readonly Pt[],
  loop: readonly Pt[],
  segments: number,
): EncloseVerdict {
  const wrongInside: number[] = [];
  const wrongOutside: number[] = [];
  for (const i of spec.inside) if (!pointInLoop(pegs[i], loop)) wrongInside.push(i);
  for (const i of spec.outside) if (pointInLoop(pegs[i], loop)) wrongOutside.push(i);
  const overBudget = segments > spec.maxSegments;
  const total = spec.inside.length + spec.outside.length;
  const right = total - wrongInside.length - wrongOutside.length;
  return {
    ok: wrongInside.length === 0 && wrongOutside.length === 0 && !overBudget,
    score: total === 0 ? 1 : right / total,
    wrongInside,
    wrongOutside,
    overBudget,
  };
}

// ---------------------------------------------------------------------------
// Clues
// ---------------------------------------------------------------------------

/**
 * A clue level's board is a lattice: `cols + 1` by `rows + 1` pegs, and the
 * string may only run between neighbours. Peg indices go left to right, top to
 * bottom; cell `(r, c)` has index `r * cols + c`, and a clue of null is a cell
 * that says nothing.
 */
export function latticeIndex(cols: number, r: number, c: number): number {
  return r * (cols + 1) + c;
}

/** Every legal move on the lattice, as ordered peg pairs (low, high). */
export function latticeWires(cols: number, rows: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = latticeIndex(cols, r, c);
      if (c < cols) out.push([i, latticeIndex(cols, r, c + 1)]);
      if (r < rows) out.push([i, latticeIndex(cols, r + 1, c)]);
    }
  }
  return out;
}

/** The four wires around cell (r, c), as ordered peg pairs. */
export function cellWires(cols: number, r: number, c: number): [number, number][] {
  const tl = latticeIndex(cols, r, c);
  const tr = latticeIndex(cols, r, c + 1);
  const bl = latticeIndex(cols, r + 1, c);
  const br = latticeIndex(cols, r + 1, c + 1);
  return [[tl, tr], [bl, br], [tl, bl], [tr, br]];
}

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/**
 * The wires a peg order uses.
 *
 * An open path uses the wires between consecutive pegs; a closed one also uses
 * the wire back to the start. The board wants both: mid-loop, to show which
 * clues are already met, and at the end, to judge.
 */
export function usedWires(order: readonly number[], closed = true): Set<string> {
  const s = new Set<string>();
  const last = closed ? order.length : order.length - 1;
  for (let i = 0; i < last; i++) {
    s.add(key(order[i], order[(i + 1) % order.length]));
  }
  return s;
}

export interface ClueVerdict {
  ok: boolean;
  score: number;
  /** Cell indices whose count is wrong, for marking them on the board. */
  wrong: number[];
}

export function checkClues(
  spec: { cols: number; rows: number; clues: readonly (number | null)[] },
  order: readonly number[],
): ClueVerdict {
  const used = usedWires(order);
  const wrong: number[] = [];
  let asked = 0;
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const want = spec.clues[r * spec.cols + c];
      if (want === null || want === undefined) continue;
      asked++;
      const got = cellWires(spec.cols, r, c).filter((w) => used.has(key(w[0], w[1]))).length;
      if (got !== want) wrong.push(r * spec.cols + c);
    }
  }
  return {
    ok: wrong.length === 0,
    score: asked === 0 ? 1 : (asked - wrong.length) / asked,
    wrong,
  };
}

/** How many of its sides each cell uses, for generating and for the gate. */
export function clueCountsOf(cols: number, rows: number, order: readonly number[]): number[] {
  const used = usedWires(order);
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(cellWires(cols, r, c).filter((w) => used.has(key(w[0], w[1]))).length);
    }
  }
  return out;
}
