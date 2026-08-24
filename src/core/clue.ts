/**
 * Making and proving clue levels.
 *
 * A clue level is a board of wires with numbers in some of the cells: each
 * number says how many of that cell's four sides the loop uses. There is no
 * shape to copy and no outline to trace — the only way in is to work out which
 * single closed loop the numbers describe.
 *
 * That is only a puzzle if exactly one loop fits, so the generator does not
 * invent clues. It draws a loop first, reads the true count off every cell,
 * and then takes clues away one at a time for as long as the answer stays the
 * only one. `countSolutions` is what "the only one" means here, and the level
 * gate runs it again on the finished level rather than trusting the builder.
 *
 * Pure and DOM-free, like the rest of core.
 */

import { cellWires, latticeIndex, latticeWires } from './objective.js';
import type { Rng } from './rng.js';

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export interface Lattice {
  cols: number;
  rows: number;
  /** Peg index -> its neighbours. */
  adj: number[][];
  wires: [number, number][];
  /** Wire key -> the cells it borders. */
  cellsOfWire: Map<string, number[]>;
  /** Cell index -> its four wire keys. */
  wiresOfCell: string[][];
}

export function lattice(cols: number, rows: number): Lattice {
  const wires = latticeWires(cols, rows);
  const adj: number[][] = Array.from({ length: (cols + 1) * (rows + 1) }, () => []);
  for (const [a, b] of wires) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const wiresOfCell: string[][] = [];
  const cellsOfWire = new Map<string, number[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const ks = cellWires(cols, r, c).map(([a, b]) => key(a, b));
      wiresOfCell.push(ks);
      for (const k of ks) {
        const list = cellsOfWire.get(k) ?? [];
        list.push(cell);
        cellsOfWire.set(k, list);
      }
    }
  }
  return { cols, rows, adj, wires, cellsOfWire, wiresOfCell };
}

/**
 * How many distinct loops satisfy these clues, up to `cap`.
 *
 * Loops are counted as sets of wires, not as orders: a loop and the same loop
 * walked backwards or started elsewhere is one answer, so the search always
 * begins at the lowest-numbered peg the loop touches and leaves by its
 * lower-numbered neighbour.
 *
 * Pruning is what makes this quick enough to run inside a build. A partial
 * path is abandoned as soon as any cell has more sides used than its clue
 * allows, or has too few sides left unresolved to ever reach it.
 */
export function countSolutions(
  lat: Lattice,
  clues: (number | null)[],
  cap = 2,
): { count: number; first: number[] | null } {
  const { cols, rows, adj } = lat;
  const n = (cols + 1) * (rows + 1);
  const used = new Map<string, boolean>();
  // Sides of each cell currently used, and still undecided.
  const on = new Array<number>(cols * rows).fill(0);
  const open = new Array<number>(cols * rows).fill(4);

  let count = 0;
  let first: number[] | null = null;

  const setWire = (k: string, value: boolean) => {
    used.set(k, value);
    for (const cell of lat.cellsOfWire.get(k) ?? []) {
      if (value) on[cell]++;
      open[cell]--;
    }
  };
  const unsetWire = (k: string, value: boolean) => {
    used.delete(k);
    for (const cell of lat.cellsOfWire.get(k) ?? []) {
      if (value) on[cell]--;
      open[cell]++;
    }
  };

  /** Could every clue still be met from here? */
  const feasible = (): boolean => {
    for (let cell = 0; cell < clues.length; cell++) {
      const want = clues[cell];
      if (want === null || want === undefined) continue;
      if (on[cell] > want) return false;
      if (on[cell] + open[cell] < want) return false;
    }
    return true;
  };

  /** Every cell exactly right, with nothing left undecided. */
  const satisfied = (): boolean => {
    for (let cell = 0; cell < clues.length; cell++) {
      const want = clues[cell];
      if (want === null || want === undefined) continue;
      if (on[cell] !== want) return false;
    }
    return true;
  };

  const path: number[] = [];
  const onPath = new Uint8Array(n);

  const walk = (at: number, start: number): void => {
    if (count >= cap) return;
    for (const next of adj[at]) {
      if (count >= cap) return;
      // Never revisit a peg: a Slitherlink loop is simple.
      if (next !== start && onPath[next]) continue;
      // Only ever start a loop at its own lowest peg, so each loop is
      // reached exactly once rather than once per rotation and direction.
      if (next < start) continue;
      const k = key(at, next);
      if (used.has(k)) continue;

      setWire(k, true);
      if (feasible()) {
        if (next === start) {
          // The same loop can be walked either way round. Keeping only the
          // direction whose second peg is the smaller of the two neighbours
          // of the start counts it once.
          const oneWay = path.length >= 2 && path[1] < path[path.length - 1];
          if (path.length >= 4 && oneWay && satisfied()) {
            count++;
            if (!first) first = [...path];
          }
        } else {
          path.push(next);
          onPath[next] = 1;
          walk(next, start);
          onPath[next] = 0;
          path.pop();
        }
      }
      unsetWire(k, true);

      // The alternative — this wire deliberately unused — is covered by the
      // other branches of the search, so there is nothing to do here.
    }
  };

  for (let start = 0; start < n; start++) {
    if (count >= cap) break;
    // Every wire below `start` is decided-unused for a loop starting here.
    path.length = 0;
    path.push(start);
    onPath.fill(0);
    onPath[start] = 1;
    walk(start, start);
  }
  return { count, first };
}

/** A random simple loop on the lattice, grown as a rectilinear blob. */
export function randomLoop(lat: Lattice, rng: Rng, cells: number): number[] | null {
  const { cols, rows } = lat;
  const inSet = new Set<number>();
  const start = rng.int(rows) * cols + rng.int(cols);
  inSet.add(start);
  const neighbours = (cell: number): number[] => {
    const r = Math.floor(cell / cols), c = cell % cols;
    const out: number[] = [];
    if (r > 0) out.push(cell - cols);
    if (r < rows - 1) out.push(cell + cols);
    if (c > 0) out.push(cell - 1);
    if (c < cols - 1) out.push(cell + 1);
    return out;
  };
  let guard = 0;
  while (inSet.size < cells && guard++ < 500) {
    const frontier: number[] = [];
    for (const cell of inSet) for (const nb of neighbours(cell)) if (!inSet.has(nb)) frontier.push(nb);
    if (!frontier.length) break;
    inSet.add(frontier[rng.int(frontier.length)]);
  }
  return boundaryOf(lat, inSet);
}

/**
 * The outline of a set of cells, as a peg order — or null when that outline is
 * not one simple loop, which happens as soon as the set has a hole or pinches
 * to a point.
 */
export function boundaryOf(lat: Lattice, cells: ReadonlySet<number>): number[] | null {
  const { cols, rows } = lat;
  const has = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && cells.has(r * cols + c);
  const edges = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a)!.push(b);
    edges.get(b)!.push(a);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cells.has(r * cols + c)) continue;
      if (!has(r - 1, c)) add(latticeIndex(cols, r, c), latticeIndex(cols, r, c + 1));
      if (!has(r + 1, c)) add(latticeIndex(cols, r + 1, c), latticeIndex(cols, r + 1, c + 1));
      if (!has(r, c - 1)) add(latticeIndex(cols, r, c), latticeIndex(cols, r + 1, c));
      if (!has(r, c + 1)) add(latticeIndex(cols, r, c + 1), latticeIndex(cols, r + 1, c + 1));
    }
  }
  if (edges.size === 0) return null;
  // A simple loop is a graph where every corner has exactly two ways out.
  for (const [, list] of edges) if (list.length !== 2) return null;

  const startPeg = Math.min(...edges.keys());
  const order: number[] = [startPeg];
  let prev = -1;
  let at = startPeg;
  for (let i = 0; i < edges.size; i++) {
    const [x, y] = edges.get(at)!;
    const next = x === prev ? y : x;
    if (next === startPeg) break;
    order.push(next);
    prev = at;
    at = next;
  }
  return order.length === edges.size ? order : null;
}

/**
 * Take clues away for as long as the loop stays the only answer.
 *
 * The order is shuffled so two levels built from similar loops do not end up
 * with the same clues showing, and `keep` sets a floor so an early level is
 * not left with three numbers on a board and a very long think.
 */
export function pareClues(
  lat: Lattice,
  full: number[],
  rng: Rng,
  opts: { keep?: number; cap?: number } = {},
): (number | null)[] {
  const clues: (number | null)[] = [...full];
  const order = full.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const floor = opts.keep ?? 0;
  let showing = clues.length;
  for (const i of order) {
    if (showing <= floor) break;
    const was = clues[i];
    clues[i] = null;
    if (countSolutions(lat, clues, 2).count !== 1) clues[i] = was;
    else showing--;
  }
  return clues;
}
