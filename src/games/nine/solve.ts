/**
 * One to Nine's solver, and its measure of how hard a board is to think about.
 *
 * Two different questions, answered two different ways.
 *
 * `search` asks "how many arrangements satisfy all six lines". It is an
 * exhaustive permutation search with the lines checked the moment their last
 * cell is filled, and it exists to prove uniqueness — nothing ships without
 * exactly one answer.
 *
 * `analyse` asks "how hard is it to REASON out", which is a different thing
 * entirely and the one the ladder is ordered by. Counting search nodes would
 * order the boards by how long a computer takes, and a computer finds a board
 * hard for reasons no person shares. So instead this plays the deduction a
 * person actually does: work out every triple of digits that could fill each
 * line, cross out the ones the other lines rule out, and repeat. A board that
 * falls to that alone is a board you can reason through; one that does not is
 * one where you have to try something and see.
 */

import {
  evaluate, rowOpsOf, colOpsOf, type Nine,
} from './model.js';

export type Found = {
  /** Capped at the limit asked for. */
  readonly count: number;
  /** The first arrangement found, if any. */
  readonly first: number[] | null;
  readonly nodes: number;
};

/**
 * Every arrangement that satisfies the board, up to `limit`.
 *
 * Digits are placed in reading order. A row is checked when its last cell goes
 * down and a column when its last cell does, which on a three-wide board means
 * the first prune lands on the third digit rather than the ninth.
 */
export function search(nine: Nine, limit = 2, budget = 5_000_000): Found {
  const { n } = nine;
  const total = n * n;
  const cells = new Array<number>(total).fill(0);
  const used = new Array<boolean>(total + 1).fill(false);
  let count = 0;
  let nodes = 0;
  let first: number[] | null = null;

  const line = (vals: number[], ops: ReturnType<typeof rowOpsOf>, target: number): boolean =>
    evaluate(vals, ops, nine.mode) === target;

  const go = (at: number): void => {
    if (count >= limit || nodes > budget) return;
    if (at === total) {
      count++;
      if (!first) first = cells.slice();
      return;
    }
    const r = (at / n) | 0;
    const c = at % n;
    for (let d = 1; d <= total; d++) {
      if (used[d]) continue;
      nodes++;
      cells[at] = d;
      used[d] = true;

      let ok = true;
      if (c === n - 1) {
        const vals: number[] = [];
        for (let k = 0; k < n; k++) vals.push(cells[r * n + k]);
        ok = line(vals, rowOpsOf(nine, r), nine.rowTargets[r]);
      }
      if (ok && r === n - 1) {
        const vals: number[] = [];
        for (let k = 0; k < n; k++) vals.push(cells[k * n + c]);
        ok = line(vals, colOpsOf(nine, c), nine.colTargets[c]);
      }
      if (ok) go(at + 1);

      used[d] = false;
      cells[at] = 0;
      if (count >= limit || nodes > budget) return;
    }
  };

  go(0);
  return { count, first, nodes };
}

// ---------------------------------------------------------------------------
// How hard it is to think about
// ---------------------------------------------------------------------------

/** One line's worth of possibilities: the ordered tuples that come out right. */
type Line = {
  /** Cell indices this line covers, in order. */
  readonly cells: number[];
  /** Every tuple of distinct digits that satisfies it. */
  tuples: number[][];
};

function linesOf(nine: Nine): Line[] {
  const { n } = nine;
  const total = n * n;
  const out: Line[] = [];

  const enumerate = (ops: ReturnType<typeof rowOpsOf>, target: number): number[][] => {
    const tuples: number[][] = [];
    const pick: number[] = [];
    const used = new Array<boolean>(total + 1).fill(false);
    const go = (): void => {
      if (pick.length === n) {
        if (evaluate(pick, ops, nine.mode) === target) tuples.push(pick.slice());
        return;
      }
      for (let d = 1; d <= total; d++) {
        if (used[d]) continue;
        used[d] = true;
        pick.push(d);
        go();
        pick.pop();
        used[d] = false;
      }
    };
    go();
    return tuples;
  };

  for (let r = 0; r < n; r++) {
    const cells: number[] = [];
    for (let c = 0; c < n; c++) cells.push(r * n + c);
    out.push({ cells, tuples: enumerate(rowOpsOf(nine, r), nine.rowTargets[r]) });
  }
  for (let c = 0; c < n; c++) {
    const cells: number[] = [];
    for (let r = 0; r < n; r++) cells.push(r * n + c);
    out.push({ cells, tuples: enumerate(colOpsOf(nine, c), nine.colTargets[c]) });
  }
  return out;
}

export type Reading = {
  /** True when crossing out alone finishes the board. */
  readonly byReason: boolean;
  /** How many passes it took to stop changing. */
  readonly rounds: number;
  /** Tuples on the most constrained line at the start — the way in. */
  readonly entry: number;
  /** Tuples over all six lines at the start. */
  readonly opening: number;
  /** Cells still undecided when crossing out ran out of things to say. */
  readonly stuck: number;
};

/**
 * Play the deduction.
 *
 * Three rules, and they are the three a person uses:
 *
 *   - a line's tuple is impossible if it puts a digit somewhere that digit
 *     cannot go;
 *   - a cell can only hold a digit that some surviving tuple puts there, on
 *     BOTH the line across and the line down;
 *   - a digit that only one cell can hold belongs in that cell, and a cell
 *     that can hold only one digit has it.
 *
 * Repeat until nothing changes. What is left over is the measure: a board
 * finished by this is one you can reason through, and a board that stalls with
 * six cells open is one where you have to try something.
 */
export function analyse(nine: Nine): Reading {
  const { n } = nine;
  const total = n * n;
  const lines = linesOf(nine);

  const opening = lines.reduce((s, l) => s + l.tuples.length, 0);
  const entry = lines.reduce((m, l) => Math.min(m, l.tuples.length), Infinity);

  /** What each cell could still hold. */
  const cand: Set<number>[] = [];
  for (let i = 0; i < total; i++) cand.push(new Set<number>());
  const linesAt: Line[][] = Array.from({ length: total }, () => []);
  for (const l of lines) for (const c of l.cells) linesAt[c].push(l);

  const refresh = (): boolean => {
    let changed = false;
    for (let i = 0; i < total; i++) {
      // A digit survives at a cell only if every line through that cell can
      // still put it there.
      let allowed: Set<number> | null = null;
      for (const l of linesAt[i]) {
        const at = l.cells.indexOf(i);
        const mine = new Set<number>();
        for (const t of l.tuples) mine.add(t[at]);
        if (allowed === null) allowed = mine;
        else for (const d of [...allowed]) if (!mine.has(d)) allowed.delete(d);
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
      const kept = l.tuples.filter((t) => t.every((d, k) => cand[l.cells[k]].has(d)));
      if (kept.length !== l.tuples.length) { l.tuples = kept; changed = true; }
    }
    return changed;
  };

  /** A digit only one cell can take is that cell's, and it is nowhere else. */
  const placeOnly = (): boolean => {
    let changed = false;
    for (let d = 1; d <= total; d++) {
      const homes: number[] = [];
      for (let i = 0; i < total; i++) if (cand[i].has(d)) homes.push(i);
      if (homes.length === 1 && cand[homes[0]].size > 1) {
        cand[homes[0]] = new Set([d]);
        changed = true;
      }
    }
    // And a decided cell takes its digit out of every other cell.
    for (let i = 0; i < total; i++) {
      if (cand[i].size !== 1) continue;
      const [d] = [...cand[i]];
      for (let k = 0; k < total; k++) {
        if (k !== i && cand[k].delete(d)) changed = true;
      }
    }
    return changed;
  };

  refresh();
  let rounds = 0;
  for (;;) {
    rounds++;
    const moved = prune() || placeOnly() || refresh();
    if (!moved || rounds > 60) break;
    // A second refresh so the next round starts from a consistent picture.
    refresh();
  }

  let stuck = 0;
  for (let i = 0; i < total; i++) if (cand[i].size !== 1) stuck++;

  return {
    byReason: stuck === 0,
    rounds,
    entry: entry === Infinity ? 0 : entry,
    opening,
    stuck,
  };
}
