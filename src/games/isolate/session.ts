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
import { astray } from '../../platform/hint.js';
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

  /*
   * Every wall of the one answer. The given ones are already among them — the
   * designer only ever promotes a wall the answer has — so this is a set of
   * walls rather than a union of two, and nothing can be given and wrong.
   */
  reveal(): void {
    this.mark();
    this.walls = new Set(this.board.answer);
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
   * A wall the answer leaves open comes first. The rooms either side of it
   * may look fine, but the crossing-out below reasons from the walls as
   * premises, and a wrong premise makes every conclusion after it worthless.
   * Then the next line the crossing-out can settle that the player has not,
   * with the reason it was settled, in the words a person would use —
   * because "this line is a wall" without the why is an answer rather than a
   * hint. And when nothing is forced: the cross that still wants its two
   * walls, with one of them named at the third rung.
   */
  hint(): Hint | null {
    const { board } = this;
    const { w, h } = board;
    const answer = new Set(board.answer);
    for (const edge of [...this.walls].sort((a, b) => a - b)) {
      if (answer.has(edge)) continue;
      const [a, b] = cellsOf(w, h, edge);
      return astray('The wall between the two cells lit up', [`cell:${a}`, `cell:${b}`], [`edge:${edge}=open`]);
    }

    const j = judge(board, this.walls);
    if (j.solved) return null;

    const step = nextStep(board, [...this.walls]);
    if (step) {
      const [a, b] = cellsOf(w, h, step.edge);
      return {
        kind: 'step',
        focus: [`cell:${a}`, `cell:${b}`],
        reason: step.reason,
        move: step.wall
          ? 'Draw a wall on the line between the two cells lit up.'
          : 'Leave the line between the two cells lit up open.',
        claim: [`edge:${step.edge}=${step.wall ? 'wall' : 'open'}`],
      };
    }

    /*
     * Nothing is forced. Point at a cross that still wants its two walls,
     * because that is a fact about a place rather than about the whole board,
     * and name one of the answer's walls at it — or, if the answer has none
     * left to draw there, the first it has left to draw anywhere.
     */
    const corner = j.waiting[0];
    const wanted = board.answer.find((e) => !this.walls.has(e)
      && (corner === undefined || edgesAtCorner(w, h, corner).includes(e)))
      ?? board.answer.find((e) => !this.walls.has(e));
    if (wanted === undefined) return null;
    const [a, b] = cellsOf(w, h, wanted);
    return {
      kind: 'look',
      focus: [...(corner === undefined ? [] : [`corner:${corner}`]), `cell:${a}`, `cell:${b}`],
      reason: corner === undefined
        ? 'Nothing is forced just now. Every room has to hold exactly one circle, so look for a cell that only one circle can still reach.'
        : 'At least two walls have to meet at this cross, and fewer than two do — one of them runs between the two cells lit up.',
      move: 'Draw a wall on the line between the two cells lit up.',
      claim: [`edge:${wanted}=wall`],
    };
  }

  /** For the gate and the tests: does deduction alone finish this board? */
  reading(): ReturnType<typeof analyse> { return analyse(this.board); }
}
