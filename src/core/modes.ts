/**
 * The four modes that ask something other than "copy this shape".
 *
 * Each is a small set of chapters with its own designer, built by the same
 * pipeline as Classic: the designer proposes, the gate disposes. Nothing here
 * touches the DOM, so `pnpm validate` proves every level in Node before any of
 * it reaches a browser.
 *
 * Shadow  the region with no outline. Only worth playing on a board where the
 *         obvious order gives a different region, so the gate insists on it.
 * Par     the region in a fixed number of moves. Spare pegs sit along the
 *         edges, so the shape is easy and finding its corners is the puzzle.
 * Corral  no target: enclose these, exclude those. You invent the loop, so
 *         there is no single answer — but the gate proves one exists inside
 *         the budget, and that the lazy answer does not.
 * Wire    no target: numbers say how many of each cell's four sides the loop
 *         uses. Exactly one loop fits, and src/core/clue.ts proves it.
 */

import type { Body, ChapterSpec, Maker } from './design.js';
import { THREAD_COLORS } from '../render/theme.js';
import { latticeIndex, latticeWires, pointInLoop } from './objective.js';
import { lattice, randomLoop, pareClues, countSolutions, boundaryOf } from './clue.js';
import { clueCountsOf } from './objective.js';
import { ringPoints, starPoints } from './shapes.js';
import type { Pt } from './geometry.js';

const C = THREAD_COLORS;

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Shadow — the region, with the order hidden
// ---------------------------------------------------------------------------

/**
 * Every star polygon {n/k} worth playing, in order of how tangled it is.
 *
 * A chapter may only hold two levels of the same topology, so a maker that
 * produces one shape over and over fills a chapter with two levels and stops.
 * Walking a list of genuinely different stars is what makes ten of them
 * possible: {5/2} has one hole, {7/3} has two nested ones, {8/3} another
 * arrangement again.
 */
const STARS: [number, number][] = [];
for (let n = 5; n <= 13; n++) {
  for (let k = 2; k * 2 < n; k++) if (gcd(n, k) === 1) STARS.push([n, k]);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function shadowMaker(from: number, to: number, radius: number): Maker {
  const pool = STARS.filter(([n]) => n >= from && n <= to);
  return (rng, i) => {
    const [n, step] = pool[i % pool.length];
    const r = radius + rng.range(-3, 3);
    const rot = rng.range(0, Math.PI * 2);
    const pegs = ringPoints(n, r, rot).map(([x, y]) => [round1(x), round1(y)] as [number, number]);
    const sol: number[] = [];
    for (let k = 0; k < n; k++) sol.push((k * step) % n);
    return {
      pegs,
      allowCross: true,
      threads: [{ color: C[0], sol }],
      objective: { kind: 'silhouette' },
    };
  };
}

/**
 * The same star drawn as its own outline — every crossing point is a peg — so
 * the region is a plain polygon and the order is the long way round. Hiding
 * the outline here means working out which of the pegs are the points.
 */
function shadowOutline(from: number, to: number): Maker {
  const pool = STARS.filter(([n]) => n >= from && n <= to);
  return (rng, i) => {
    const [n, step] = pool[i % pool.length];
    const pts = starPoints(n, step, 34 + rng.range(-3, 3));
    const pegs = pts.map(([x, y]) => [round1(x), round1(y)] as [number, number]);
    return {
      pegs,
      allowCross: true,
      threads: [{ color: C[0], sol: pegs.map((_, k) => k) }],
      objective: { kind: 'silhouette' },
    };
  };
}

// ---------------------------------------------------------------------------
// Par — the region in a fixed number of moves
// ---------------------------------------------------------------------------

/**
 * A convex ring of corners, with spare pegs sprinkled along the edges between
 * them. Stopping at a spare peg changes nothing about the region and costs a
 * move, so the level is "which of these are the corners".
 */
function parMaker(corners: number[], spareMax: number): Maker {
  return (rng, i) => {
    // Corner count and spare pattern both step with the level index. A chapter
    // may only hold two levels of one topology, and topology here is mostly
    // "how many pegs and how many corners" — so a maker that varies only the
    // radius fills two slots and then spends the rest of the chapter's budget
    // proposing levels that are refused for being the same again.
    const n = corners[i % corners.length];
    const bump = Math.floor(i / corners.length) % spareMax;
    const r = 33 + rng.range(-3, 5);
    const rot = rng.range(0, Math.PI * 2);
    const hull = ringPoints(n, r, rot);
    const pegs: [number, number][] = hull.map(([x, y]) => [round1(x), round1(y)]);
    const sol = hull.map((_, k) => k);
    for (let e = 0; e < n; e++) {
      const a = hull[e], b = hull[(e + 1) % n];
      const spares = 1 + ((e + bump) % spareMax);
      for (let s = 1; s <= spares; s++) {
        const t = s / (spares + 1);
        pegs.push([round1(a[0] + (b[0] - a[0]) * t), round1(a[1] + (b[1] - a[1]) * t)]);
      }
    }
    return {
      pegs,
      threads: [{ color: C[0], sol }],
      objective: { kind: 'par', segments: n },
    };
  };
}

// ---------------------------------------------------------------------------
// Corral — enclose these, exclude those
// ---------------------------------------------------------------------------

/**
 * A ring of pegs to build the fence from, and a scatter of marks inside the
 * board. The authored loop is a random subset of the ring in hull order; the
 * marks are then sorted into those it caught and those it did not.
 *
 * Only some of each are shown. A mark the loop happens to catch but which the
 * level does not name is not a mistake — it is slack, and slack is what makes
 * the puzzle have more than one answer, which is the point of the mode.
 */
function corralMaker(ringSize: number, marks: number, slack: number): Maker {
  return (rng, i) => {
    const n = ringSize + (i % 3);
    const r = 36 + rng.range(-3, 3);
    const ring = ringPoints(n, r, rng.range(0, Math.PI * 2));
    const pegs: [number, number][] = ring.map(([x, y]) => [round1(x), round1(y)]);

    // The fence: a contiguous-ish subset of the ring, so it stays simple.
    const keep: number[] = [];
    for (let k = 0; k < n; k++) if (rng.chance(0.62)) keep.push(k);
    if (keep.length < 4) return null;
    const loop = keep.map((k) => pegs[k] as Pt);

    // Marks, placed away from the fence so "inside or out" is never a
    // judgement call about a peg sitting on a line.
    const inside: number[] = [];
    const outside: number[] = [];
    let guard = 0;
    while (inside.length + outside.length < marks && guard++ < 400) {
      const p: [number, number] = [round1(rng.range(12, 88)), round1(rng.range(12, 88))];
      if (nearAnyPeg(p, pegs, 7) || nearLoop(p, loop, 7)) continue;
      const idx = pegs.length;
      const isIn = pointInLoop(p, loop);
      if (isIn && inside.length >= Math.ceil(marks / 2)) continue;
      if (!isIn && outside.length >= Math.floor(marks / 2)) continue;
      pegs.push(p);
      (isIn ? inside : outside).push(idx);
    }
    if (inside.length < 2 || outside.length < 2) return null;

    return {
      pegs,
      // Marks are never threaded: they are what the fence is about, not part
      // of it. Thorns already mean "do not touch", so they carry that here.
      thorn: [...inside, ...outside],
      threads: [{ color: C[0], sol: keep }],
      objective: {
        kind: 'enclose',
        inside,
        outside,
        maxSegments: keep.length + slack,
      },
    };
  };
}

function nearAnyPeg(p: Pt, pegs: ReadonlyArray<readonly number[]>, d: number): boolean {
  return pegs.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < d);
}

function nearLoop(p: Pt, loop: readonly Pt[], d: number): boolean {
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[j], b = loop[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    if (Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) < d) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wire — the clue grid
// ---------------------------------------------------------------------------

/** Peg positions for a cols x rows lattice, centred in the board. */
export function latticePegs(cols: number, rows: number): [number, number][] {
  const span = 78;
  const step = span / Math.max(cols, rows);
  const w = step * cols, h = step * rows;
  const x0 = (100 - w) / 2, y0 = (100 - h) / 2;
  const out: [number, number][] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) out.push([round1(x0 + c * step), round1(y0 + r * step)]);
  }
  return out;
}

function wireMaker(cols: number, rows: number, cells: [number, number], keep: number): Maker {
  const lat = lattice(cols, rows);
  const pegs = latticePegs(cols, rows);
  const wires = latticeWires(cols, rows);
  return (rng) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const want = cells[0] + rng.int(cells[1] - cells[0] + 1);
      const loop = randomLoop(lat, rng, want);
      if (!loop || loop.length < 6) continue;
      const full = clueCountsOf(cols, rows, loop);
      const clues = pareClues(lat, full, rng, { keep });
      const showing = clues.filter((c) => c !== null).length;
      // A board with almost every number still on it is a colouring exercise;
      // one with almost none is a very long stare.
      if (showing < 3 || showing > cols * rows - 2) continue;
      if (countSolutions(lat, clues, 2).count !== 1) continue;
      return {
        pegs,
        wires,
        threads: [{ color: C[0], sol: loop }],
        objective: { kind: 'clue', cols, rows, clues },
      };
    }
    return null;
  };
}

/** The loop a clue board's numbers describe, for the gate and for hints. */
export function solveClue(cols: number, rows: number, clues: (number | null)[]): number[] | null {
  return countSolutions(lattice(cols, rows), clues, 2).first;
}

export { boundaryOf, latticeIndex };

// ---------------------------------------------------------------------------

export const SHADOW_CHAPTERS: ChapterSpec[] = [
  { chapter: 1, name: 'Shadow', idea: 'Only the shape is shown, never the order', count: 10, make: shadowMaker(5, 9, 34) },
  { chapter: 2, name: 'Points', idea: 'Every crossing is a peg; which are the points?', count: 10, make: shadowOutline(5, 9) },
  { chapter: 3, name: 'Deeper', idea: 'Wider stars, and steps you have to find', count: 12, make: shadowMaker(9, 13, 37) },
];

export const PAR_CHAPTERS: ChapterSpec[] = [
  { chapter: 1, name: 'Corners', idea: 'The same shape, in as few pegs as it takes', count: 10, make: parMaker([4, 5, 6, 7], 3) },
  { chapter: 2, name: 'Sparse', idea: 'More spare pegs between the corners', count: 10, make: parMaker([5, 6, 7], 3) },
  { chapter: 3, name: 'Lean', idea: 'Wider shapes, and more to ignore', count: 12, make: parMaker([6, 7, 8, 9], 3) },
];

export const CORRAL_CHAPTERS: ChapterSpec[] = [
  { chapter: 1, name: 'Corral', idea: 'Fence the marks in; leave the rest out', count: 10, make: corralMaker(8, 4, 2) },
  { chapter: 2, name: 'Tighter', idea: 'Fewer posts to hang the fence from', count: 10, make: corralMaker(7, 6, 1) },
  { chapter: 3, name: 'Exact', idea: 'No slack at all', count: 12, make: corralMaker(9, 6, 0) },
];

export const WIRE_CHAPTERS: ChapterSpec[] = [
  { chapter: 1, name: 'Wire', idea: 'Each number counts the sides of its cell the loop uses', count: 10, make: wireMaker(3, 3, [2, 4], 4) },
  { chapter: 2, name: 'Grid', idea: 'A bigger board, and fewer numbers', count: 10, make: wireMaker(4, 4, [3, 7], 3) },
  { chapter: 3, name: 'Sparse', idea: 'Only what is needed to pin it down', count: 12, make: wireMaker(5, 5, [5, 11], 0) },
];

export const MODE_CHAPTERS: Record<string, ChapterSpec[]> = {
  shadow: SHADOW_CHAPTERS,
  par: PAR_CHAPTERS,
  corral: CORRAL_CHAPTERS,
  wire: WIRE_CHAPTERS,
};

export type { Body };
