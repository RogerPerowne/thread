/**
 * Zigzag's solver, and the difficulty it measures.
 *
 * A depth-first walk from the start cell. The sequence does most of the work:
 * from step i the only moves are to unvisited neighbours carrying the next
 * number, which is usually two of the eight. Two prunes finish the job:
 *
 *   1. Every unvisited cell has to still be reachable from where we are.
 *   2. A cell that no unvisited neighbour can arrive AT is already lost,
 *      unless it happens to be the finish.
 *
 * Both are necessary conditions, never sufficient, so they only ever remove
 * branches that genuinely cannot work.
 *
 * The node count is the honest difficulty signal, and the forced-move count is
 * the interesting one: a board where nearly every step has exactly one legal
 * continuation is a board you can walk without thinking, however large it is.
 */

import { adjacency, wants, type Zig } from './model.js';

export type Found = {
  /** Up to `cap` distinct paths. */
  readonly paths: readonly (readonly number[])[];
  readonly nodes: number;
  readonly exhausted: boolean;
  /** Steps where exactly one continuation was legal. */
  readonly forced: number;
  /** Steps where more than one was. */
  readonly choices: number;
};

const DEFAULT_NODES = 400_000;

export function solve(zig: Zig, cap = 2, maxNodes = DEFAULT_NODES): Found {
  const n = zig.w * zig.h;
  const nbr = adjacency(zig.w, zig.h);
  const seen = new Uint8Array(n);
  const path: number[] = [];
  const paths: number[][] = [];
  const queue = new Int32Array(n);
  const mark = new Uint8Array(n);

  let nodes = 0;
  let exhausted = false;
  let forced = 0;
  let choices = 0;

  /** Can every unvisited cell still be got to from `at`? */
  const open = (at: number): boolean => {
    mark.fill(0);
    let qn = 0;
    queue[qn++] = at;
    mark[at] = 1;
    let reached = 0;
    for (let i = 0; i < qn; i++) {
      const p = queue[i];
      for (const q of nbr[p]) {
        if (seen[q] || mark[q]) continue;
        mark[q] = 1;
        queue[qn++] = q;
        reached++;
      }
    }
    let missing = 0;
    for (let i = 0; i < n; i++) if (!seen[i]) missing++;
    if (reached < missing) return false;

    /*
     * A cell nothing can arrive at is lost. "Arrive at" means an unvisited
     * neighbour carrying the number that would land on it, or the head of the
     * path itself — and the finish is exempt, because it is where the path
     * stops rather than passes through.
     */
    for (let p = 0; p < n; p++) {
      if (seen[p]) continue;
      let ways = 0;
      for (const q of nbr[p]) {
        if (!seen[q] || q === at) { ways++; break; }
      }
      if (ways === 0) return false;
    }
    return true;
  };

  const walk = (at: number): void => {
    if (nodes >= maxNodes) { exhausted = true; return; }
    if (paths.length >= cap) return;
    nodes++;

    if (path.length === n) {
      if (at === zig.finish) paths.push(path.slice());
      return;
    }
    if (at === zig.finish) return; // the finish is the end, not a waypoint

    const need = wants(zig, path.length);
    const moves: number[] = [];
    for (const q of nbr[at]) {
      if (seen[q] || zig.cells[q] !== need) continue;
      moves.push(q);
    }
    if (moves.length === 0) return;
    if (moves.length === 1) forced++; else choices++;

    if (!open(at)) return;

    for (const q of moves) {
      seen[q] = 1;
      path.push(q);
      walk(q);
      path.pop();
      seen[q] = 0;
      if (paths.length >= cap) return;
      if (nodes >= maxNodes) { exhausted = true; return; }
    }
  };

  if (zig.cells[zig.start] === wants(zig, 0)) {
    seen[zig.start] = 1;
    path.push(zig.start);
    walk(zig.start);
  }

  return { paths, nodes, exhausted, forced, choices };
}

/** True when the board has exactly one line through it, proven. */
export function isUnique(zig: Zig, maxNodes = DEFAULT_NODES): boolean {
  const r = solve(zig, 2, maxNodes);
  return !r.exhausted && r.paths.length === 1;
}
