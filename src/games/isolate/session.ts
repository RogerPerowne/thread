/**
 * Isolate's live puzzle.
 *
 * The state is the set of walls the player has drawn. The walls the board came
 * with are not in it — they are part of the board and cannot be rubbed out —
 * so everything the player can do is adding one number to a set or taking it
 * out again, and undo, saving and resuming are each a copy of that set.
 */

import {
  judge, firstFault, whatIsLeft, edgeCount, edgesAtCorner, cellsOf, type Board,
} from './model.js';
import { analyse, nextStep } from './solve.js';
import { Effort } from '../../platform/signature.js';
import type { Hint, Session, Verdict } from '../../platform/types.js';

export type IsolateState = { walls: number[] };

export class IsolateSession implements Session<IsolateState> {
  readonly board: Board;
  /** Every wall on the board: the given ones and the drawn ones together. */
  walls: Set<number>;
  readonly effort = new Effort();
  private past: number[][] = [];
  private future: number[][] = [];
  private snapped = false;

  constructor(board: Board) {
    this.board = board;
    this.walls = new Set(board.given);
  }

  get state(): IsolateState { return { walls: [...this.walls] }; }

  /** One undo step per gesture, taken before the first change it makes. */
  mark(): void {
    if (this.snapped) return;
    this.snapped = true;
    this.past.push([...this.walls]);
    if (this.past.length > 200) this.past.shift();
    this.future.length = 0;
  }

  openGesture(): void { this.snapped = false; }

  /** Given walls belong to the board and are not the player's to move. */
  fixed(edge: number): boolean { return this.board.given.includes(edge); }

  has(edge: number): boolean { return this.walls.has(edge); }

  set(edge: number, wall: boolean): boolean {
    if (edge < 0 || edge >= edgeCount(this.board.w, this.board.h)) return false;
    if (this.fixed(edge)) return false;
    if (this.walls.has(edge) === wall) return false;
    this.mark();
    if (wall) this.walls.add(edge); else this.walls.delete(edge);
    return true;
  }

  verdict(): Verdict {
    const j = judge(this.board, this.walls);
    this.effort.note(j.progress);
    return {
      solved: j.solved,
      fault: firstFault(j),
      left: whatIsLeft(this.board, j),
      progress: j.progress,
    };
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push([...this.walls]);
    this.walls = new Set(prev);
    this.effort.undid();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push([...this.walls]);
    this.walls = new Set(next);
    return true;
  }

  restart(): void {
    this.mark();
    this.walls = new Set(this.board.given);
    this.snapped = false;
  }

  save(): string {
    const drawn = [...this.walls].filter((e) => !this.fixed(e)).sort((a, b) => a - b);
    return `1;${this.board.w}x${this.board.h};${this.effort.freeze().join(',')};${drawn.join(',')}`;
  }

  load(saved: string): boolean {
    const [version, size, effort, body] = saved.split(';');
    if (version !== '1' || size !== `${this.board.w}x${this.board.h}`) return false;
    const drawn = (body ?? '').split(',').filter((x) => x !== '').map(Number);
    const E = edgeCount(this.board.w, this.board.h);
    if (drawn.some((e) => !Number.isInteger(e) || e < 0 || e >= E)) return false;
    this.walls = new Set([...this.board.given, ...drawn]);
    this.effort.thaw((effort ?? '').split(',').map(Number));
    this.past.length = 0;
    this.future.length = 0;
    return true;
  }

  signature(): string { return this.effort.toString(); }

  /**
   * The next useful deduction.
   *
   * A room that already holds what it wants is finished, so everything round
   * it has to be a wall — that is the deduction this game is made of, and it
   * is the one worth pointing at. Failing that: a piece of the grid that
   * cannot be finished as it stands has one way left to grow, and that line
   * cannot be a wall.
   *
   * Nothing here reveals the answer. Both are read off what is drawn.
   */
  hint(): Hint | null {
    const { board } = this;
    const { w, h } = board;
    const j = judge(board, this.walls);
    /* A finished board has nothing left to point at, and saying "this line
       stays open" about a board that is already right is noise. */
    if (j.solved) return null;
    if (j.wrong.length > 0) {
      return {
        focus: j.wrong[0].map((c) => `cell:${c}`),
        reason: `${firstFault(j)}.`,
        move: 'Change a wall round that room and the rest can be worked on again.',
      };
    }

    /*
     * The next line the crossing-out can settle that the player has not. It
     * comes with the reason it was settled, in the words a person would use,
     * because "this line is a wall" without the why is an answer rather than
     * a hint.
     */
    const step = nextStep(board, [...this.walls]);
    if (step) {
      const [a, b] = cellsOf(w, h, step.edge);
      return {
        focus: [`cell:${a}`, `cell:${b}`],
        reason: step.reason,
        move: step.wall
          ? 'Draw a wall on the line between the two cells lit up.'
          : 'Leave the line between the two cells lit up open.',
      };
    }

    /* Nothing is forced. Point at the corner that still wants its two walls,
       because that is a fact about a place rather than about the whole board. */
    if (j.waiting.length > 0) {
      const corner = j.waiting[0];
      const [a] = cellsOf(w, h, edgesAtCorner(w, h, corner)[0]);
      return {
        focus: [`corner:${corner}`, `cell:${a}`],
        reason: 'At least two walls have to meet at this cross, and fewer than two do.',
      };
    }
    return null;
  }

  /** For the gate and the tests: does deduction alone finish this board? */
  reading(): ReturnType<typeof analyse> { return analyse(this.board); }
}
