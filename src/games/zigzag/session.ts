/**
 * Zigzag's live puzzle.
 *
 * The state is one array: the cells the line has been drawn through, in order.
 * That is the whole model, which is why undo, saving, resuming and judging are
 * each two lines — everything a player can do is push, pop, or truncate.
 */

import {
  judge, firstFault, whatIsLeft, neighbours, wants, type Zig,
} from './model.js';
import { Effort } from '../../platform/signature.js';
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
    if (!neighbours(this.zig.w, this.zig.h, at).includes(cell)) return false;
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
      if (i > 0 && !neighbours(this.zig.w, this.zig.h, path[i - 1]).includes(path[i])) return false;
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
   * The real one a player makes: from where the line stands, count the legal
   * continuations. Exactly one means the move is forced and there is nothing
   * to think about; none means the line is already stuck and the mistake is
   * behind you, which is a far more useful thing to be told than "wrong".
   *
   * With a choice to make, it points at the cell that will be hardest to reach
   * later — the one with fewest unvisited neighbours — because that is the
   * corner a line paints itself out of.
   */
  hint(): Hint | null {
    const at = this.path[this.path.length - 1];
    if (at === undefined) {
      return {
        focus: [`cell:${this.zig.start}`],
        reason: 'Every line starts here, on the first number of the run.',
      };
    }
    const moves = neighbours(this.zig.w, this.zig.h, at).filter((c) => this.canGo(c));

    if (moves.length === 0) {
      return {
        focus: [`cell:${at}`],
        reason: 'Nothing legal follows from here, so the line went wrong further back.',
        move: 'Undo until the line has somewhere to go.',
      };
    }
    if (moves.length === 1) {
      return {
        focus: [`cell:${at}`, `cell:${moves[0]}`],
        reason: `Only one cell carries a ${wants(this.zig, this.path.length)} next to the end of the line, so that step is forced.`,
        move: 'Draw into the highlighted cell.',
      };
    }

    /*
     * More than one way on, so nothing is forced. What IS worth saying is
     * which of them the board is likeliest to punish you for leaving: the cell
     * with the fewest ways out of its own is the one that gets stranded, and
     * that is the deduction a player makes without noticing.
     *
     * One cell is named, not all of them — a hint that lights up every option
     * and then says "the highlighted cell" is a hint about nothing.
     */
    const used = new Set(this.path);
    let tightest = moves[0];
    let fewest = Infinity;
    for (const m of moves) {
      const ways = neighbours(this.zig.w, this.zig.h, m).filter((c) => !used.has(c)).length;
      if (ways < fewest) { fewest = ways; tightest = m; }
    }
    return {
      focus: [`cell:${at}`, `cell:${tightest}`],
      reason: `${moves.length} ways on from here. The one lit up has only ${fewest} left of its own, so it is the one that gets stranded if you go the other way.`,
      move: 'Draw into the cell lit up, and see whether the rest still works.',
    };
  }
}
