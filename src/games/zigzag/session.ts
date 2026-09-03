/**
 * Zigzag's live puzzle.
 *
 * The state is one array: the cells the line has been drawn through, in order.
 * That is the whole model, which is why undo, saving, resuming and judging are
 * each two lines — everything a player can do is push, pop, or truncate.
 */

import {
  judge, firstFault, whatIsLeft, stepsFrom, wants, type Zig,
} from './model.js';
import { Effort } from '../../platform/signature.js';
import { astray } from '../../platform/hint.js';
import type { Hint, Session, Verdict } from '../../platform/types.js';

export type ZigState = { path: number[] };

export class ZigSession implements Session<ZigState> {
  readonly zig: Zig;
  path: number[] = [];
  readonly effort = new Effort();
  private past: number[][] = [];
  private future: number[][] = [];
  private snapped = false;

  constructor(zig: Zig) {
    this.zig = zig;
  }

  get state(): ZigState { return { path: this.path }; }

  /** One undo step per gesture, taken before the first change it makes. */
  mark(): void {
    if (this.snapped) return;
    this.snapped = true;
    this.past.push(this.path.slice());
    if (this.past.length > 200) this.past.shift();
    this.future.length = 0;
  }

  openGesture(): void { this.snapped = false; }

  /** Can the line step to this cell from where it is? */
  canGo(cell: number): boolean {
    const at = this.path[this.path.length - 1];
    if (at === undefined) return cell === this.zig.start;
    if (this.path.includes(cell)) return false;
    if (at === this.zig.finish) return false;
    if (!stepsFrom(this.zig, at).includes(cell)) return false;
    return this.zig.cells[cell] === wants(this.zig, this.path.length);
  }

  verdict(): Verdict {
    const j = judge(this.zig, this.path, this.path.length < this.zig.w * this.zig.h);
    const fault = firstFault(j);
    this.effort.note(j.progress);
    return {
      solved: judge(this.zig, this.path).solved,
      fault,
      left: whatIsLeft(this.zig, j, this.path),
      progress: j.progress,
    };
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.path.slice());
    this.path = prev;
    this.effort.undid();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.path.slice());
    this.path = next;
    return true;
  }

  restart(): void {
    this.mark();
    this.path = [];
    this.snapped = false;
  }

  /** The route the designer drew the board from, laid back down. */
  reveal(): void {
    this.mark();
    this.path = this.zig.answer.slice();
    this.snapped = false;
  }

  save(): string {
    return `1;${this.zig.w}x${this.zig.h};${this.effort.freeze().join(',')};${this.path.join(',')}`;
  }

  load(saved: string): boolean {
    const [version, size, effort, body] = saved.split(';');
    if (version !== '1' || size !== `${this.zig.w}x${this.zig.h}`) return false;
    const path = (body ?? '').split(',').filter((x) => x !== '').map(Number);
    const n = this.zig.w * this.zig.h;
    if (path.some((c) => !Number.isInteger(c) || c < 0 || c >= n)) return false;
    // A saved line that is not actually drawable means the board changed under
    // the save. Refusing is better than restoring something illegal.
    for (let i = 0; i < path.length; i++) {
      if (this.zig.cells[path[i]] !== wants(this.zig, i)) return false;
      if (i > 0 && !stepsFrom(this.zig, path[i - 1]).includes(path[i])) return false;
    }
    this.path = path;
    this.effort.thaw((effort ?? '').split(',').map(Number));
    this.past.length = 0;
    this.future.length = 0;
    return true;
  }

  signature(): string { return this.effort.toString(); }

  /**
   * The next useful deduction.
   *
   * First, a line that has left the route: the answer is one path, so the
   * first cell where the drawn line and the route part company is a wrong
   * step, whatever the numbers say about it — and every step after it is a
   * step built on that one. Then the move a person makes without noticing:
   * count the legal continuations, and one means the step is forced. With a
   * choice to make, nothing is forced and the hint says so, pointing at the
   * ways on rather than at one of them as though it were the way; the third
   * rung names the route's next cell.
   */
  hint(): Hint | null {
    const { zig, path } = this;
    const { answer } = zig;

    const k = path.findIndex((c, i) => c !== answer[i]);
    if (k >= 0) {
      const what = k === 0 ? 'Starting the line on the cell lit up' : 'The step onto the cell lit up';
      return astray(what, [`cell:${path[k]}`], [`cell:${path[k]}!@${k}`]);
    }
    if (path.length >= answer.length) return null;

    const next = answer[path.length];
    const at = path[path.length - 1];
    const place = (c: number) => `row ${((c / zig.w) | 0) + 1}, column ${(c % zig.w) + 1}`;
    if (at === undefined) {
      return {
        kind: 'step',
        focus: [`cell:${zig.start}`],
        reason: 'Every line starts here, on the first number of the run.',
        move: 'Put a finger on the cell lit up and draw from there.',
        claim: [`cell:${zig.start}@0`],
      };
    }
    const moves = stepsFrom(zig, at).filter((c) => this.canGo(c));
    if (moves.length === 1) {
      return {
        kind: 'step',
        focus: [`cell:${at}`, `cell:${moves[0]}`],
        reason: `Only one cell carrying a ${wants(zig, path.length)} touches the end of the line, so that step is forced.`,
        move: 'Draw into the other cell lit up.',
        claim: [`cell:${moves[0]}@${path.length}`],
      };
    }

    /*
     * More than one way on, so nothing is forced, and the hint lights up the
     * choice rather than pretending one of them is the answer. The useful
     * thing to say is what decides it: a cell with only one way out has to be
     * entered last or not at all, and that is the fact a line gets stranded
     * on. The third rung names the route's next cell outright.
     */
    const used = new Set(path);
    const exits = (m: number) => stepsFrom(zig, m).filter((c) => !used.has(c)).length;
    const fewest = Math.min(...moves.map(exits));
    return {
      kind: 'look',
      focus: [`cell:${at}`, ...moves.map((c) => `cell:${c}`)],
      reason: `${moves.length} ways on from here, none of them forced. The one to watch has only ${fewest} ${fewest === 1 ? 'way' : 'ways'} out of its own: the line has to reach it before that closes.`,
      move: `The line goes on to ${place(next)}.`,
      claim: [`cell:${next}@${path.length}`],
    };
  }
}
