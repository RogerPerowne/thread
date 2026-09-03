/**
 * One to Nine's live puzzle.
 *
 * The state is nine numbers, one per cell, zero for empty. Everything a player
 * can do is one assignment — place a digit, take one back, swap two — so undo,
 * saving and resuming are each a copy of that array and nothing else.
 */

import {
  judge, firstFault, whatIsLeft, rowOf, colOf, rowOpsOf, colOpsOf, lineText,
  evaluate, type Nine,
} from './model.js';
import { analyse } from './solve.js';
import { Effort } from '../../platform/signature.js';
import { astray } from '../../platform/hint.js';
import type { Hint, Session, Verdict } from '../../platform/types.js';

export type NineState = { cells: number[] };

export class NineSession implements Session<NineState> {
  readonly nine: Nine;
  cells: number[];
  readonly effort = new Effort();
  private past: number[][] = [];
  private future: number[][] = [];
  private snapped = false;

  constructor(nine: Nine) {
    this.nine = nine;
    this.cells = new Array(nine.n * nine.n).fill(0);
  }

  get state(): NineState { return { cells: this.cells }; }

  /** One undo step per gesture, taken before the first change it makes. */
  mark(): void {
    if (this.snapped) return;
    this.snapped = true;
    this.past.push(this.cells.slice());
    if (this.past.length > 200) this.past.shift();
    this.future.length = 0;
  }

  openGesture(): void { this.snapped = false; }

  /** Which digits are not on the board. */
  spare(): number[] {
    const total = this.nine.n * this.nine.n;
    const on = new Set(this.cells.filter((d) => d !== 0));
    const out: number[] = [];
    for (let d = 1; d <= total; d++) if (!on.has(d)) out.push(d);
    return out;
  }

  where(digit: number): number {
    return this.cells.indexOf(digit);
  }

  /**
   * Put `digit` in `cell`.
   *
   * Whatever was there goes back to the tray, and if the digit was already
   * somewhere else it leaves that cell — so dragging one placed digit onto
   * another is a swap without anything having to know the word.
   */
  place(cell: number, digit: number): void {
    if (cell < 0 || cell >= this.cells.length) return;
    if (this.cells[cell] === digit) return;
    this.mark();
    const from = this.cells.indexOf(digit);
    const displaced = this.cells[cell];
    this.cells[cell] = digit;
    if (from >= 0) this.cells[from] = displaced;
  }

  /** Take a digit off the board. */
  lift(cell: number): void {
    if (cell < 0 || cell >= this.cells.length || this.cells[cell] === 0) return;
    this.mark();
    this.cells[cell] = 0;
  }

  verdict(): Verdict {
    const j = judge(this.nine, this.cells);
    this.effort.note(j.progress);
    return {
      solved: j.solved,
      fault: firstFault(j),
      left: whatIsLeft(this.nine, j),
      progress: j.progress,
    };
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.cells.slice());
    this.cells = prev;
    this.effort.undid();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.cells.slice());
    this.cells = next;
    return true;
  }

  restart(): void {
    this.mark();
    this.cells = new Array(this.nine.n * this.nine.n).fill(0);
    this.snapped = false;
  }

  /** The arrangement the six sums were read off, put back. */
  reveal(): void {
    this.mark();
    this.cells = this.nine.answer.slice();
    this.snapped = false;
  }

  save(): string {
    return `1;${this.nine.rowTargets.join(',')};${this.effort.freeze().join(',')};${this.cells.join(',')}`;
  }

  load(saved: string): boolean {
    const [version, targets, effort, body] = saved.split(';');
    if (version !== '1' || targets !== this.nine.rowTargets.join(',')) return false;
    const cells = (body ?? '').split(',').map(Number);
    const total = this.nine.n * this.nine.n;
    if (cells.length !== total) return false;
    if (cells.some((d) => !Number.isInteger(d) || d < 0 || d > total)) return false;
    const on = cells.filter((d) => d !== 0);
    if (new Set(on).size !== on.length) return false;
    this.cells = cells;
    this.effort.thaw((effort ?? '').split(',').map(Number));
    this.past.length = 0;
    this.future.length = 0;
    return true;
  }

  signature(): string { return this.effort.toString(); }

  /**
   * The next useful deduction.
   *
   * A digit that is not where the answer has it comes first: the lines it
   * sits on may still add up, but everything deduced across it would be
   * deduced from a wrong premise. Then the one a person actually makes: find
   * the line with the fewest ways of being filled, given what is already
   * down. A line with one way left is a line you can just write in; a line
   * with three is where to spend your next minute, and the third rung names
   * one digit of it from the answer.
   */
  hint(): Hint | null {
    const { nine } = this;
    const { n, answer } = nine;
    const total = n * n;
    const place = (i: number) => `row ${((i / n) | 0) + 1}, column ${(i % n) + 1}`;

    for (let i = 0; i < total; i++) {
      const d = this.cells[i];
      if (d !== 0 && d !== answer[i]) {
        return astray(`The ${d} in ${place(i)}`, [`cell:${i}`], [`cell:${i}!=${d}`]);
      }
    }
    const spare = new Set(this.spare());
    if (spare.size === 0) return null;

    type Cand = { key: string; label: string; cells: number[]; ways: number[][] };
    const cands: Cand[] = [];

    const consider = (
      cells: number[], vals: number[], ops: ReturnType<typeof rowOpsOf>,
      target: number, key: string, label: string,
    ): void => {
      const holes = vals.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
      if (holes.length === 0) return;
      const ways: number[][] = [];
      const pick: number[] = [];
      const used = new Set<number>();
      const go = (k: number): void => {
        if (ways.length > 40) return;
        if (k === holes.length) {
          const trial = vals.slice();
          holes.forEach((h, i) => { trial[h] = pick[i]; });
          if (evaluate(trial, ops, nine.mode) === target) ways.push(pick.slice());
          return;
        }
        for (let d = 1; d <= total; d++) {
          if (!spare.has(d) || used.has(d)) continue;
          used.add(d);
          pick.push(d);
          go(k + 1);
          pick.pop();
          used.delete(d);
        }
      };
      go(0);
      cands.push({ key, label, cells: holes.map((h) => cells[h]), ways });
    };

    for (let r = 0; r < n; r++) {
      const cells: number[] = [];
      for (let c = 0; c < n; c++) cells.push(r * n + c);
      consider(cells, rowOf(nine, this.cells, r), rowOpsOf(nine, r), nine.rowTargets[r],
        `row:${r}`, `the ${['first', 'second', 'third', 'fourth'][r] ?? r + 1} row`);
    }
    for (let c = 0; c < n; c++) {
      const cells: number[] = [];
      for (let r = 0; r < n; r++) cells.push(r * n + c);
      consider(cells, colOf(nine, this.cells, c), colOpsOf(nine, c), nine.colTargets[c],
        `col:${c}`, `the ${['first', 'second', 'third', 'fourth'][c] ?? c + 1} column`);
    }
    if (cands.length === 0) return null;

    cands.sort((a, b) => a.ways.length - b.ways.length);
    const best = cands[0];
    const capital = best.label.charAt(0).toUpperCase() + best.label.slice(1);
    if (best.ways.length === 1) {
      const which = Number(best.key.slice(4));
      const line = best.key.startsWith('row')
        ? lineText(rowOf(nine, this.cells, which), rowOpsOf(nine, which), nine.rowTargets[which])
        : lineText(colOf(nine, this.cells, which), colOpsOf(nine, which), nine.colTargets[which]);
      return {
        kind: 'step',
        focus: best.cells.map((i) => `cell:${i}`),
        reason: `Only one set of digits still fits ${best.label}: ${line}.`,
        move: `Put ${best.ways[0].join(', ')} in the highlighted cells, in that order.`,
        claim: best.cells.map((i, k) => `cell:${i}=${best.ways[0][k]}`),
      };
    }
    /*
     * Nothing is settled. Naming one of the four ways as though it were the
     * way would be a hint that is true and misleading at once, so the reason
     * says what to do with the line — it is the lines crossing this one that
     * cut four down to one — and the third rung names a single digit of it.
     */
    const next = best.cells[0];
    return {
      kind: 'look',
      focus: best.cells.map((i) => `cell:${i}`),
      reason: `${capital} is the tightest line left — only ${best.ways.length} ways to fill it. Take each against the lines that cross it; one survives.`,
      move: `The ${answer[next]} goes in ${place(next)}.`,
      claim: [`cell:${next}=${answer[next]}`],
    };
  }

  /** For the gate and the tests: does deduction alone finish this board? */
  reading(): ReturnType<typeof analyse> { return analyse(this.nine); }
}
