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
 *
 * EMPTY is the player's notation and not part of the answer. It is a note that
 * says "I have settled this", written where the deduction needed it and
 * nowhere else — so the board is finished when every line holds one of each
 * shape, and nobody is asked to dot the rest of the grid to be told so. See
 * `judge` in model.ts, which is where that reading lives.
 */

import {
  judge, firstFault, whatIsLeft, sightLine, clueHolds, clueText, rowCells, colCells, type Board,
} from './model.js';
import { arrangements } from './solve.js';
import { glyphName } from './glyphs.js';
import { Effort } from '../../platform/signature.js';
import { astray } from '../../platform/hint.js';
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

  /** The filling the clues were read off, written back onto the board. */
  reveal(): void {
    this.mark();
    this.cells = this.board.answer.slice();
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
   * In the order the platform's Hint type lays down. First, anything on the
   * board that the answer does not have — a shape in the wrong cell, or a cell
   * marked empty that holds a shape — because a board with one of those on it
   * has no next step, only a step back. Then a line whose remaining
   * arrangements are down to one, which can simply be written in. Then the
   * tightest line, with a clue that actually reads it, and at the third rung
   * one cell the answer fills.
   *
   * Every claim made here is checked against the answer by the hint gate, so
   * a "forced" that was not would fail the build rather than the player.
   */
  hint(): Hint | null {
    const { board } = this;
    const { w, h, shapes, answer } = board;
    const cells = this.cells;

    const wrong = this.astray();
    if (wrong) return wrong;

    const settled = judge(board, cells);
    if (settled.solved) return null;

    type Cand = { cells: number[]; ways: number[][]; label: string };
    const cands: Cand[] = [];

    const consider = (line: number[], stock: number[][], label: string): void => {
      const now = line.map((i) => cells[i]);
      /* A line with all its shapes down is finished, whether or not its gaps
         are dotted. There is nothing left to deduce there, so pointing at it
         and saying "only one arrangement fits" would be telling the player to
         write out notation the answer does not need. */
      if (now.filter((v) => v > 0).length >= shapes) return;
      const ways = stock.filter((way) => {
        for (let k = 0; k < now.length; k++) if (now[k] !== -1 && now[k] !== way[k]) return false;
        for (const clue of board.clues) {
          const sight = sightLine(board, clue.side, clue.line);
          if (sight.length !== line.length) continue;
          if (!sight.every((i) => line.includes(i))) continue;
          const order = sight.map((i) => way[line.indexOf(i)]);
          if (clueHolds(order, clue.depth, clue.shape) !== true) return false;
        }
        return true;
      });
      cands.push({ cells: line, ways, label });
    };

    const rowStock = arrangements(w, shapes);
    const colStock = arrangements(h, shapes);
    for (let r = 0; r < h; r++) consider(rowCells(board, r), rowStock, `row ${r + 1}`);
    for (let c = 0; c < w; c++) consider(colCells(board, c), colStock, `column ${c + 1}`);
    if (cands.length === 0) return null;

    cands.sort((a, b) => a.ways.length - b.ways.length);
    const best = cands[0];
    /* A line down to one arrangement: the shapes it puts down. Only the
       shapes are named — its blanks are the player's own notation. */
    if (best.ways.length === 1) {
      const way = best.ways[0];
      const marks = best.cells
        .map((i, k) => (way[k] > 0 && cells[i] !== way[k] ? { i, v: way[k] } : null))
        .filter((m): m is { i: number; v: number } => m !== null);
      return {
        kind: 'step',
        focus: best.cells.map((i) => `cell:${i}`),
        reason: `Only one arrangement still fits ${best.label}, given its clues and what is already down.`,
        move: `Reading along it: ${way.map((v) => (v === 0 ? 'blank' : NAMES[v - 1])).join(', ')}.`,
        claim: marks.map((m) => `cell:${m.i}=${m.v}`),
      };
    }

    /*
     * Nothing forced. Name the tightest line and quote a clue that actually
     * READS that line; at the third rung, one cell of it from the answer —
     * the first empty one the answer fills, which is a move and not the line.
     */
    const looks = board.clues.find((clue) => {
      const sight = sightLine(board, clue.side, clue.line);
      return sight.length === best.cells.length && sight.every((i) => best.cells.includes(i));
    });
    const next = best.cells.find((i) => cells[i] <= 0 && answer[i] > 0);
    const rowOf = (i: number) => ((i / w) | 0) + 1;
    const colOf = (i: number) => (i % w) + 1;
    const capital = best.label.charAt(0).toUpperCase() + best.label.slice(1);
    return {
      kind: 'look',
      focus: best.cells.map((i) => `cell:${i}`),
      reason: looks
        ? `${capital} is the tightest line left — ${best.ways.length} ways to fill it. ${clueText(looks, NAMES)}.`
        : `${capital} is the tightest line left — ${best.ways.length} ways to fill it.`,
      move: next === undefined ? undefined
        : `The ${NAMES[answer[next] - 1]} goes in row ${rowOf(next)}, column ${colOf(next)}.`,
      claim: next === undefined ? [] : [`cell:${next}=${answer[next]}`],
    };
  }

  /**
   * The first thing on the board that the answer does not have, or null.
   *
   * A shape where the answer has a different shape or nothing; or a cell
   * marked empty where the answer has a shape. An undecided cell is never
   * wrong, and neither is an empty mark where the answer is empty. Row-major,
   * so the same wrong board always points at the same cell.
   */
  private astray(): Hint | null {
    const { w, answer } = this.board;
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      if (v === -1 || v === answer[i]) continue;
      const where = `row ${((i / w) | 0) + 1}, column ${(i % w) + 1}`;
      const what = v === 0 ? `The empty mark in ${where}` : `The ${NAMES[v - 1]} in ${where}`;
      return astray(what, [`cell:${i}`], [`cell:${i}!=${v}`]);
    }
    return null;
  }
}
