/**
 * Isolate's solver, and its measure of how hard a board is to think about.
 *
 * The search does not look for walls. It builds ROOMS: take the first cell
 * nothing has claimed, work out every room that could contain it, try each in
 * turn, and go on to the next unclaimed cell. Walls are read off the answer at
 * the end, because a room and its walls are two ways of writing one thing and
 * the room is the one with fewer of them — a nine by seven board has a hundred
 * and ten edges and eleven rooms.
 *
 * `analyse` plays the deduction instead: which walls MUST be there and which
 * cannot, given only what is drawn. That is what a person does, and it is what
 * the ladder is ordered by.
 */

import {
  cellsOf, edgeBetween, edgeCount, edgesAtCorner, neighbours, roomsOf,
  type Board,
} from './model.js';

export type Found = {
  readonly count: number;
  /** The walls of the first answer found. */
  readonly first: number[] | null;
  /** Every answer found, up to the limit asked for. */
  readonly all: number[][];
  readonly nodes: number;
  /** True when the search finished rather than running out of budget. */
  readonly exhausted: boolean;
};

/** One answer, and the search proved it. Never "one so far". */
export function isUnique(found: Found): boolean {
  return found.count === 1 && found.exhausted;
}

/** The walls that a set of rooms implies: every edge between two of them. */
export function wallsOf(board: Board, of: Int32Array): number[] {
  const { w, h } = board;
  const out: number[] = [];
  for (let edge = 0; edge < edgeCount(w, h); edge++) {
    const [a, b] = cellsOf(w, h, edge);
    if (of[a] !== of[b]) out.push(edge);
  }
  return out;
}

export function search(board: Board, limit = 2, budget = 400_000): Found {
  const { w, h } = board;
  const n = w * h;
  const dots = new Set(board.dots);
  const given = new Set(board.given);
  const biggest = Math.max(2, ...Object.values(board.sizes));

  const of = new Int32Array(n).fill(-1);
  let rooms = 0;
  let count = 0;
  let nodes = 0;
  let cutOff = false;
  let first: number[] | null = null;
  const all: number[][] = [];

  /* A corner wants two walls; with the rooms known, its walls are known too. */
  const cornersHold = (): boolean => board.crosses.every((corner) => {
    const walls = edgesAtCorner(w, h, corner).filter((edge) => {
      const [a, b] = cellsOf(w, h, edge);
      return of[a] !== of[b];
    });
    return walls.length >= 2;
  });

  /* Every given wall really is a wall: the two cells either side of it are in
     different rooms. Checked as rooms are built rather than at the end. */
  const keepsGiven = (cells: readonly number[], room: number): boolean => {
    for (const cell of cells) {
      for (const other of neighbours(w, h, cell)) {
        if (of[other] !== room) continue;
        if (given.has(edgeBetween(w, h, cell, other))) return false;
      }
    }
    return true;
  };

  /**
   * Is what is left still fillable?
   *
   * Every room takes exactly two circles, so a pocket of unclaimed cells with
   * fewer than two in it can never become one — and neither can one whose
   * circles cannot reach each other. Cheap, and it cuts most of the tree.
   */
  const restIsPossible = (): boolean => {
    const seen = new Uint8Array(n);
    for (let start = 0; start < n; start++) {
      if (of[start] >= 0 || seen[start]) continue;
      let inside = 0;
      let cells = 0;
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        cells++;
        if (dots.has(cell)) inside++;
        for (const other of neighbours(w, h, cell)) {
          if (of[other] >= 0 || seen[other]) continue;
          if (given.has(edgeBetween(w, h, cell, other))) continue;
          seen[other] = 1;
          stack.push(other);
        }
      }
      if (inside < 2 || inside % 2 !== 0) return false;
      if (cells < 2) return false;
    }
    return true;
  };

  const go = (): void => {
    if (count >= limit || cutOff) return;
    if (nodes > budget) { cutOff = true; return; }

    let seed = -1;
    for (let cell = 0; cell < n; cell++) if (of[cell] < 0) { seed = cell; break; }
    if (seed < 0) {
      if (!cornersHold()) return;
      count++;
      const walls = wallsOf(board, of);
      if (!first) first = walls;
      all.push(walls);
      return;
    }

    const room = rooms++;
    const inside: number[] = [];
    const taken: number[] = [];

    /**
     * Every room that could hold the seed, built by adding one cell at a time.
     *
     * Cells are only ever added in increasing order from the frontier, so each
     * set is reached exactly once — no set is built twice and then thrown away
     * for being a duplicate.
     */
    const grow = (frontier: number[], from: number): void => {
      if (count >= limit || cutOff) return;
      if (nodes++ > budget) { cutOff = true; return; }

      const numbered = taken.map((c) => board.sizes[c]).filter((s) => s !== undefined);
      if (numbered.length > 1) return;
      if (inside.length > 2) return;
      const wants = numbered[0];
      if (wants !== undefined && taken.length > wants) return;
      if (taken.length > biggest) return;

      if (inside.length === 2 && wants !== undefined && taken.length === wants) {
        if (keepsGiven(taken, room) && restIsPossible()) go();
        return;
      }

      for (let k = from; k < frontier.length; k++) {
        const cell = frontier[k];
        if (of[cell] >= 0) continue;
        of[cell] = room;
        taken.push(cell);
        if (dots.has(cell)) inside.push(cell);
        const grown = frontier.slice();
        for (const other of neighbours(w, h, cell)) {
          if (of[other] >= 0) continue;
          if (given.has(edgeBetween(w, h, cell, other))) continue;
          if (!grown.includes(other)) grown.push(other);
        }
        grow(grown, k + 1);
        if (dots.has(cell)) inside.pop();
        taken.pop();
        of[cell] = -1;
        if (count >= limit || cutOff) return;
      }
    };

    grow([seed], 0);
    rooms--;
  };

  go();
  return { count, first, all, nodes, exhausted: !cutOff };
}

// ---------------------------------------------------------------------------
// How hard it is to think about
// ---------------------------------------------------------------------------

export type Reading = {
  /** True when the crossing-out alone settles every wall. */
  readonly byReason: boolean;
  readonly rounds: number;
  /** Edges still undecided at the start: the size of the room you begin in. */
  readonly opening: number;
  /** Edges still undecided when the reasoning ran out of things to say. */
  readonly stuck: number;
  /** How many the first pass alone settles — how obvious the way in is. */
  readonly entry: number;
};

const UNKNOWN = 0;
const WALL = 1;
const OPEN = 2;

/**
 * Play the deduction, and tell someone about every step it takes.
 *
 * Everything turns on one idea: a piece of the grid is FINISHED when it holds
 * two circles, one of which carries a number, and it is that many cells big.
 * From there the rules are the ones a person says out loud:
 *
 *   - two pieces can only be joined if the join could still be finished —
 *     three circles between them, two numbers, or more cells than the number
 *     allows, and the line between them has to be a wall;
 *   - a finished piece is walled all the way round, because nothing may be
 *     added to it;
 *   - an unfinished piece with one way left to grow has to grow that way;
 *   - and a corner that wants two walls, with two of its four already open,
 *     has to have the other two.
 *
 * `seed` is what is already drawn — nothing, when the question is how hard the
 * board is; the player's own walls, when the question is what to do next. And
 * `onSettle` is told about each line as it is settled and may stop the whole
 * thing by returning false, which is what makes one function serve both.
 */
export function propagate(
  board: Board,
  seed: readonly number[],
  onSettle?: (edge: number, wall: boolean, reason: string) => boolean,
): { state: Uint8Array; rounds: number; entry: number } {
  const { w, h } = board;
  const n = w * h;
  const E = edgeCount(w, h);
  const state = new Uint8Array(E);
  for (const edge of board.given) state[edge] = WALL;
  for (const edge of seed) state[edge] = WALL;

  const dots = new Set(board.dots);
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const up = parent[x]; parent[x] = r; x = up; }
    return r;
  };
  const size = new Int32Array(n).fill(1);
  const holds = new Int32Array(n);
  const numbered = new Int32Array(n);
  const wants = new Int32Array(n).fill(-1);
  for (let cell = 0; cell < n; cell++) {
    if (dots.has(cell)) holds[cell] = 1;
    const s = board.sizes[cell];
    if (s !== undefined) { wants[cell] = s; numbered[cell] = 1; }
  }

  const merge = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[rb] = ra;
    size[ra] += size[rb];
    holds[ra] += holds[rb];
    numbered[ra] += numbered[rb];
    if (wants[ra] < 0) wants[ra] = wants[rb];
  };

  /** Nothing may be added to this piece, and nothing needs to be. */
  const finished = (root: number): boolean =>
    holds[root] === 2 && numbered[root] === 1 && size[root] === wants[root];

  /** Why these two pieces can never be one room, or an empty string if they can. */
  const cannotJoin = (a: number, b: number): string => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return '';
    if (holds[ra] + holds[rb] > 2) {
      return 'Putting these two together would make a room of more than two circles.';
    }
    if (numbered[ra] + numbered[rb] > 1) {
      return 'Both of these carry a number, and a room only ever has one.';
    }
    const want = wants[ra] >= 0 ? wants[ra] : wants[rb];
    if (want >= 0 && size[ra] + size[rb] > want) {
      return `Putting these two together would make more than the ${want} cells the number asks for.`;
    }
    return '';
  };

  let stopped = false;
  const settle = (edge: number, wall: boolean, reason: string): void => {
    if (stopped) return;
    state[edge] = wall ? WALL : OPEN;
    if (onSettle && !onSettle(edge, wall, reason)) stopped = true;
  };

  let rounds = 0;
  let entry = 0;

  for (;;) {
    rounds++;
    let moved = false;

    for (let edge = 0; edge < E && !stopped; edge++) {
      if (state[edge] !== UNKNOWN) continue;
      const [a, b] = cellsOf(w, h, edge);
      const why = cannotJoin(a, b);
      if (why !== '') { settle(edge, true, why); moved = true; }
    }

    /* The boundary of every piece, worked out once per piece. */
    const border = new Map<number, number[]>();
    for (let cell = 0; cell < n; cell++) {
      const root = find(cell);
      for (const other of neighbours(w, h, cell)) {
        const edge = edgeBetween(w, h, cell, other);
        if (state[edge] !== UNKNOWN || find(other) === root) continue;
        const list = border.get(root) ?? [];
        if (!list.includes(edge)) list.push(edge);
        border.set(root, list);
      }
    }
    for (const [root, edges] of border) {
      if (stopped) break;
      if (finished(root)) {
        const why = wants[root] >= 0
          ? `This room holds its two circles and the ${wants[root]} cells its number asks for, so it is finished.`
          : 'This room already holds its two circles, so nothing more can come into it.';
        for (const edge of edges) { settle(edge, true, why); moved = true; }
      } else if (edges.length === 1) {
        settle(edges[0], false,
          'This piece cannot be a room yet and has only one way left to grow, so that line is not a wall.');
        moved = true;
      }
    }

    for (const corner of board.crosses) {
      if (stopped) break;
      const four = edgesAtCorner(w, h, corner);
      if (four.filter((e) => state[e] === OPEN).length < 2) continue;
      for (const edge of four) {
        if (state[edge] !== UNKNOWN) continue;
        settle(edge, true, 'Two walls have to meet at this cross, and only these lines are left to be them.');
        moved = true;
      }
    }

    for (let edge = 0; edge < E; edge++) {
      if (state[edge] !== OPEN) continue;
      const [a, b] = cellsOf(w, h, edge);
      if (find(a) !== find(b)) { merge(a, b); moved = true; }
    }

    if (rounds === 1) entry = state.reduce((k, v) => k + (v === UNKNOWN ? 0 : 1), 0);
    if (stopped || !moved || rounds > 200) break;
  }

  return { state, rounds, entry };
}

/** How far the crossing-out gets from nothing at all. */
export function analyse(board: Board): Reading {
  const { state, rounds, entry } = propagate(board, []);
  let stuck = 0;
  for (const v of state) if (v === UNKNOWN) stuck++;
  return {
    byReason: stuck === 0,
    rounds,
    opening: state.length,
    stuck,
    entry,
  };
}

export type Step = {
  readonly edge: number;
  /** True when the line has to be a wall, false when it has to stay open. */
  readonly wall: boolean;
  readonly reason: string;
};

/**
 * The next line the reasoning can settle that the player has not.
 *
 * The same crossing-out, started from their own walls and stopped at the first
 * thing it can say that they have not already said. So a hint is one step,
 * always one the board itself justifies, and never the answer.
 */
export function nextStep(board: Board, walls: readonly number[]): Step | null {
  const drawn = new Set([...walls, ...board.given]);
  let found: Step | null = null;
  propagate(board, [...drawn], (edge, wall, reason) => {
    if (wall && drawn.has(edge)) return true;
    found = { edge, wall, reason };
    return false;
  });
  return found;
}

/**
 * How hard a board is to think about, as one number.
 *
 * The same shape as every other game here: the size of the room you start in,
 * how far the crossing-out has to be carried, and a class of its own for a
 * board the crossing-out never finishes, because from there the only way on is
 * to try a wall and see.
 */
export function scoreOf(r: Reading): number {
  return Math.log2(Math.max(1, r.opening)) * 7
    + r.rounds * 3.5
    + r.stuck * 0.6
    + (r.byReason ? 0 : 40);
}

/** For the gate: the walls the board's own answer implies. */
export function wallsFromRooms(board: Board, walls: readonly number[]): Int32Array {
  return roomsOf(board, new Set(walls)).of;
}
