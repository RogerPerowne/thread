/**
 * Shape Up's live puzzle.
 *
 * The state is one number per cell, and it has three kinds of value rather
 * than two: a shape (1 and up), EMPTY (0) — a cell the player has decided
 * holds nothing — and UNDECIDED (-1), which is where every cell starts.
 *
 * Keeping "empty" apart from "not yet" is the whole reason the board can be
 * judged honestly. A clue about the second shape along a row cannot be broken
 * until the cells before it are settled, and without the distinction there is
 * no way to know whether a blank cell is a blank or a gap.
 */

import {
  judge, firstFault, whatIsLeft, sightLine, clueHolds, clueText, type Board,
} from './model.js';
import { arrangements } from './solve.js';
import { glyphName } from './glyphs.js';
import { Effort } from '../../platform/signature.js';
import type { Hint, Session, Verdict } from '../../platform/types.js';

export type ShapeState = { cells: number[] };

const NAMES = [1, 2, 3, 4, 5].map((n) => glyphName(n));

export class ShapeSession implements Session<ShapeState> {
  readonly board: Board;
  cells: number[];
  readonly effort = new Effort();
  private past: number[][] = [];
  private future: number[][] = [];
  private snapped = false;

  constructor(board: Board) {
    this.board = board;
    this.cells = new Array(board.w * board.h).fill(-1);
  }

  get state(): ShapeState { return { cells: this.cells }; }

  mark(): void {
    if (this.snapped) return;
    this.snapped = true;
    this.past.push(this.cells.slice());
    if (this.past.length > 300) this.past.shift();
    this.future.length = 0;
  }

  openGesture(): void { this.snapped = false; }

  /** Put a shape, an empty, or an undecided in a cell. */
  set(cell: number, value: number): void {
    if (cell < 0 || cell >= this.cells.length) return;
    if (this.cells[cell] === value) return;
    this.mark();
    this.cells[cell] = value;
  }

  verdict(): Verdict {
    const j = judge(this.board, this.cells);
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
    this.cells = new Array(this.board.w * this.board.h).fill(-1);
    this.snapped = false;
  }

  save(): string {
    const key = this.board.clues.map((c) => `${c.side[0]}${c.line}${c.shape}${c.depth}`).join('');
    return `1;${key};${this.effort.freeze().join(',')};${this.cells.join(',')}`;
  }

  load(saved: string): boolean {
    const [version, key, effort, body] = saved.split(';');
    const mine = this.board.clues.map((c) => `${c.side[0]}${c.line}${c.shape}${c.depth}`).join('');
    if (version !== '1' || key !== mine) return false;
    const cells = (body ?? '').split(',').map(Number);
    if (cells.length !== this.board.w * this.board.h) return false;
    if (cells.some((v) => !Number.isInteger(v) || v < -1 || v > this.board.shapes)) return false;
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
   * The real one: find the line whose remaining arrangements are fewest given
   * what is already down. One arrangement left means the line can simply be
   * written in. None means the mistake is behind you, which is far more use
   * than being told the board is wrong.
   */
  hint(): Hint | null {
    const { board } = this;
    const { w, h, shapes } = board;

    /*
     * A clue the board has already broken comes first, and it comes first
     * because it is the most useful thing there is to say. Everything below
     * looks for the next deduction; if a clue is broken there is no next
     * deduction, only a wrong cell somewhere behind you.
     */
    const settled = judge(board, this.cells);
    if (settled.badClues.length > 0) {
      const clue = board.clues[settled.badClues[0]];
      return {
        focus: sightLine(board, clue.side, clue.line).map((i) => `cell:${i}`),
        reason: `${clueText(clue, NAMES)} — and it does not, as this line stands.`,
        move: 'Take something back along the highlighted line.',
      };
    }
    if (settled.badRows.length > 0 || settled.badCols.length > 0) {
      const isRow = settled.badRows.length > 0;
      const line = isRow ? settled.badRows[0] : settled.badCols[0];
      const cells: number[] = [];
      if (isRow) for (let c = 0; c < w; c++) cells.push(line * w + c);
      else for (let r = 0; r < h; r++) cells.push(r * w + line);
      return {
        focus: cells.map((i) => `cell:${i}`),
        reason: `That ${isRow ? 'row' : 'column'} has the same shape in it twice.`,
        move: 'Every line holds one of each, and no more.',
      };
    }

    type Cand = { cells: number[]; ways: number[][]; label: string };
    const cands: Cand[] = [];

    const consider = (cells: number[], stock: number[][], label: string): void => {
      const now = cells.map((i) => this.cells[i]);
      if (now.every((v) => v !== -1)) return;
      const ways = stock.filter((way) => {
        for (let k = 0; k < now.length; k++) if (now[k] !== -1 && now[k] !== way[k]) return false;
        for (const clue of board.clues) {
          const line = sightLine(board, clue.side, clue.line);
          if (line.length !== cells.length) continue;
          if (!line.every((i) => cells.includes(i))) continue;
          const order = line.map((i) => way[cells.indexOf(i)]);
          if (clueHolds(order, clue.depth, clue.shape) !== true) return false;
        }
        return true;
      });
      cands.push({ cells, ways, label });
    };

    const rowStock = arrangements(w, shapes);
    const colStock = arrangements(h, shapes);
    for (let r = 0; r < h; r++) {
      const cells: number[] = [];
      for (let c = 0; c < w; c++) cells.push(r * w + c);
      consider(cells, rowStock, `row ${r + 1}`);
    }
    for (let c = 0; c < w; c++) {
      const cells: number[] = [];
      for (let r = 0; r < h; r++) cells.push(r * w + c);
      consider(cells, colStock, `column ${c + 1}`);
    }
    if (cands.length === 0) return null;

    const dead = cands.find((c) => c.ways.length === 0);
    if (dead) {
      return {
        focus: dead.cells.map((i) => `cell:${i}`),
        reason: `Nothing fits ${dead.label} any more, so something already on the board is wrong.`,
        move: 'Take a mark back and try it elsewhere.',
      };
    }

    cands.sort((a, b) => a.ways.length - b.ways.length);
    const best = cands[0];
    if (best.ways.length === 1) {
      return {
        focus: best.cells.map((i) => `cell:${i}`),
        reason: `Only one arrangement still fits ${best.label}.`,
        move: `It reads ${best.ways[0].map((v) => (v === 0 ? 'blank' : NAMES[v - 1])).join(', ')}.`,
      };
    }

    /*
     * Nothing forced. Name the tightest line, and quote a clue that actually
     * READS that line — an arbitrary clue from the other side of the board is
     * true and no use, which is what this used to give.
     */
    const looks = board.clues.find((clue) => {
      const line = sightLine(board, clue.side, clue.line);
      return line.length === best.cells.length && line.every((i) => best.cells.includes(i));
    });
    return {
      focus: best.cells.map((i) => `cell:${i}`),
      reason: `${best.label.charAt(0).toUpperCase()}${best.label.slice(1)} is the tightest line left — ${best.ways.length} ways to fill it.`,
      move: looks ? clueText(looks, NAMES) : undefined,
    };
  }
}
