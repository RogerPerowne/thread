/**
 * Shape Up's solver, and its measure of how hard a board is to think about.
 *
 * Both work on the same object: a LINE'S ARRANGEMENTS. A row of six cells
 * holding one each of four shapes has 360 possible arrangements, and every
 * clue that reads along that row throws most of them away before the search
 * starts. That is the whole trick — the puzzle is small in the space of
 * arrangements and enormous in the space of cells, so nothing here ever thinks
 * about a cell on its own.
 *
 * `search` counts answers, to prove uniqueness. `analyse` plays the deduction
 * a person plays — cross out the arrangements the other lines rule out, and
 * repeat — and reports whether that alone finishes the board.
 */

import { sightLine, clueHolds, rowCells, colCells, type Board, type Clue } from './model.js';

const stockCache = new Map<string, number[][]>();

/**
 * Every arrangement of one-of-each-shape plus blanks, for a line of `len`.
 *
 * Cached, because it depends on two small numbers and nothing else, and the
 * clue minimiser asks for it a hundred times per board. Six cells and four
 * shapes is 360 arrangements; working them out again for every clue removed
 * was most of the time the generator spent.
 */
export function arrangements(len: number, shapes: number): number[][] {
  const key = `${len}:${shapes}`;
  const had = stockCache.get(key);
  if (had) return had;
  const made = buildArrangements(len, shapes);
  stockCache.set(key, made);
  return made;
}

function buildArrangements(len: number, shapes: number): number[][] {
  const out: number[][] = [];
  const row = new Array<number>(len).fill(0);
  const used = new Array<boolean>(shapes + 1).fill(false);
  const go = (at: number, placed: number): void => {
    if (at === len) {
      if (placed === shapes) out.push(row.slice());
      return;
    }
    // Not enough room left for the shapes still to place.
    if (shapes - placed > len - at) return;
    row[at] = 0;
    go(at + 1, placed);
    for (let s = 1; s <= shapes; s++) {
      if (used[s]) continue;
      used[s] = true;
      row[at] = s;
      go(at + 1, placed + 1);
      row[at] = 0;
      used[s] = false;
    }
  };
  go(0, 0);
  return out;
}

/** The clues that read along one row, and the ones that read down one column. */
function cluesFor(board: Board, kind: 'row' | 'col', line: number): Clue[] {
  return board.clues.filter((c) => (
    kind === 'row'
      ? (c.side === 'left' || c.side === 'right') && c.line === line
      : (c.side === 'top' || c.side === 'bottom') && c.line === line
  ));
}

/** Does an arrangement of a row satisfy every clue that reads along it? */
function rowOk(board: Board, r: number, row: number[]): boolean {
  for (const clue of cluesFor(board, 'row', r)) {
    const seen = clue.side === 'left' ? row : [...row].reverse();
    if (clueHolds(seen, clue.depth, clue.shape) !== true) return false;
  }
  return true;
}

function colOk(board: Board, c: number, col: number[]): boolean {
  for (const clue of cluesFor(board, 'col', c)) {
    const seen = clue.side === 'top' ? col : [...col].reverse();
    if (clueHolds(seen, clue.depth, clue.shape) !== true) return false;
  }
  return true;
}

export type Found = {
  readonly count: number;
  readonly first: number[] | null;
  readonly nodes: number;
  /**
   * True when the search finished rather than running out of budget.
   *
   * This is the difference between "there is one answer" and "I found one
   * answer and stopped looking", and conflating them is how a generator comes
   * to remove a clue the board needed. Stopping because a second answer turned
   * up is not being cut off — that conclusion is sound.
   */
  readonly exhausted: boolean;
};

/** One answer, and the search proved it. Never "one so far". */
export function isUnique(found: Found): boolean {
  return found.count === 1 && found.exhausted;
}

/**
 * Every filling of the board, up to `limit`.
 *
 * Row by row, from the arrangements each row's own clues already allow. The
 * column checks are the pruning: a shape used twice down a column kills the
 * branch at once, and a column that cannot still fit its missing shapes into
 * the rows that are left kills it a good deal earlier than that.
 */
export function search(board: Board, limit = 2, budget = 4_000_000): Found {
  const { w, h, shapes } = board;
  const stock = arrangements(w, shapes);
  const perRow: number[][][] = [];
  for (let r = 0; r < h; r++) perRow.push(stock.filter((row) => rowOk(board, r, row)));

  /*
   * The column clues, split by which way they read. A clue from the TOP can be
   * checked the moment its column has that many shapes in it, which is often
   * halfway up the board; one from the BOTTOM cannot be checked until the
   * column is full, because what it reads first is what goes down last.
   */
  const fromTop: Clue[][] = Array.from({ length: w }, () => []);
  const fromBottom: Clue[][] = Array.from({ length: w }, () => []);
  for (const clue of board.clues) {
    if (clue.side === 'top') fromTop[clue.line].push(clue);
    else if (clue.side === 'bottom') fromBottom[clue.line].push(clue);
  }

  const grid = new Array<number>(w * h).fill(0);
  /** The non-blank values placed down each column so far, in order. */
  const colVals: number[][] = Array.from({ length: w }, () => []);

  let count = 0;
  let nodes = 0;
  let first: number[] | null = null;
  let cutOff = false;

  const go = (r: number): void => {
    if (count >= limit) return;
    if (nodes > budget) { cutOff = true; return; }
    if (r === h) {
      for (let c = 0; c < w; c++) {
        for (const clue of fromBottom[c]) {
          const seen = [...colVals[c]].reverse();
          if (seen.length < clue.depth || seen[clue.depth - 1] !== clue.shape) return;
        }
      }
      count++;
      if (!first) first = grid.slice();
      return;
    }

    for (const row of perRow[r]) {
      nodes++;
      let ok = true;
      for (let c = 0; c < w && ok; c++) {
        if (row[c] > 0 && colVals[c].includes(row[c])) ok = false;
      }
      if (!ok) continue;

      for (let c = 0; c < w; c++) {
        grid[r * w + c] = row[c];
        if (row[c] > 0) colVals[c].push(row[c]);
      }

      /* Every column has to be able to finish: one missing shape needs one
         row left to put it in. */
      const left = h - r - 1;
      let feasible = true;
      for (let c = 0; c < w && feasible; c++) {
        if (shapes - colVals[c].length > left) feasible = false;
      }
      /* And a clue read from the top is decided as soon as its column has
         that many shapes down it. */
      for (let c = 0; c < w && feasible; c++) {
        for (const clue of fromTop[c]) {
          if (colVals[c].length >= clue.depth && colVals[c][clue.depth - 1] !== clue.shape) {
            feasible = false;
            break;
          }
        }
      }

      if (feasible) go(r + 1);

      for (let c = 0; c < w; c++) {
        if (row[c] > 0) colVals[c].pop();
        grid[r * w + c] = 0;
      }
      if (count >= limit) return;
      if (nodes > budget) { cutOff = true; return; }
    }
  };

  go(0);
  return { count, first, nodes, exhausted: !cutOff };
}

// ---------------------------------------------------------------------------
// How hard it is to think about
// ---------------------------------------------------------------------------

type Line = { readonly cells: number[]; ways: number[][] };

export type Reading = {
  /** True when crossing out alone finishes the board. */
  readonly byReason: boolean;
  readonly rounds: number;
  /** Arrangements left on the most constrained line at the start. */
  readonly entry: number;
  /** Arrangements over every line at the start. */
  readonly opening: number;
  readonly stuck: number;
};

/**
 * Play the deduction.
 *
 * Two rules, and they are the two a person uses: an arrangement of a line is
 * out if it puts a shape somewhere that shape cannot go, and a cell can only
 * hold what BOTH the line across and the line down still allow it to. Repeat
 * until nothing changes.
 */
export function analyse(board: Board): Reading {
  const { w, h, shapes } = board;
  const total = w * h;
  const lines: Line[] = [];

  const rowStock = arrangements(w, shapes);
  const colStock = arrangements(h, shapes);
  for (let r = 0; r < h; r++) {
    lines.push({ cells: rowCells(board, r), ways: rowStock.filter((x) => rowOk(board, r, x)) });
  }
  for (let c = 0; c < w; c++) {
    lines.push({ cells: colCells(board, c), ways: colStock.filter((x) => colOk(board, c, x)) });
  }

  const opening = lines.reduce((s, l) => s + l.ways.length, 0);
  const entry = lines.reduce((m, l) => Math.min(m, l.ways.length), Infinity);

  const cand: Set<number>[] = [];
  for (let i = 0; i < total; i++) cand.push(new Set<number>());
  const linesAt: Line[][] = Array.from({ length: total }, () => []);
  for (const l of lines) for (const c of l.cells) linesAt[c].push(l);

  const refresh = (): boolean => {
    let changed = false;
    for (let i = 0; i < total; i++) {
      let allowed: Set<number> | null = null;
      for (const l of linesAt[i]) {
        const at = l.cells.indexOf(i);
        const mine = new Set<number>();
        for (const way of l.ways) mine.add(way[at]);
        if (allowed === null) allowed = mine;
        else for (const v of [...allowed]) if (!mine.has(v)) allowed.delete(v);
      }
      const next = allowed ?? new Set<number>();
      if (next.size !== cand[i].size) changed = true;
      cand[i] = next;
    }
    return changed;
  };

  const prune = (): boolean => {
    let changed = false;
    for (const l of lines) {
      const kept = l.ways.filter((way) => way.every((v, k) => cand[l.cells[k]].has(v)));
      if (kept.length !== l.ways.length) { l.ways = kept; changed = true; }
    }
    return changed;
  };

  refresh();
  let rounds = 0;
  for (;;) {
    rounds++;
    const moved = prune() || refresh();
    if (!moved || rounds > 80) break;
    refresh();
  }

  let stuck = 0;
  for (let i = 0; i < total; i++) if (cand[i].size !== 1) stuck++;

  return { byReason: stuck === 0, rounds, entry: entry === Infinity ? 0 : entry, opening, stuck };
}

/** Every clue the answer could carry — the full set, before any are taken away. */
export function allClues(board: Board): Clue[] {
  const out: Clue[] = [];
  const sides: [Side: 'top' | 'bottom' | 'left' | 'right', count: number][] = [
    ['top', board.w], ['bottom', board.w], ['left', board.h], ['right', board.h],
  ];
  for (const [side, count] of sides) {
    for (let line = 0; line < count; line++) {
      const seen = sightLine(board, side, line).map((i) => board.answer[i]).filter((v) => v > 0);
      for (let depth = 1; depth <= seen.length; depth++) {
        out.push({ side, line, shape: seen[depth - 1], depth });
      }
    }
  }
  return out;
}
