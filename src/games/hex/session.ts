/**
 * Hexagony's live puzzle.
 *
 * The state is one number per space: which tile is lying there, or -1 for an
 * empty space. Every move a player can make is one assignment — lay a tile,
 * pick it up, swap two — so undo, saving and resuming are each a copy of that
 * array and nothing else.
 */

import { judge, firstFault, whatIsLeft, neighboursOf, agree, type Hex } from './model.js';
import { analyse } from './solve.js';
import { Effort } from '../../platform/signature.js';
import { astray } from '../../platform/hint.js';
import type { Hint, Session, Verdict } from '../../platform/types.js';

export type HexState = { placed: number[] };

export class HexSession implements Session<HexState> {
  readonly hex: Hex;
  placed: number[];
  readonly effort = new Effort();
  private past: number[][] = [];
  private future: number[][] = [];
  private snapped = false;

  constructor(hex: Hex) {
    this.hex = hex;
    this.placed = new Array(hex.cells.length).fill(-1);
  }

  get state(): HexState { return { placed: this.placed }; }

  /** One undo step per gesture, taken before the first change it makes. */
  mark(): void {
    if (this.snapped) return;
    this.snapped = true;
    this.past.push(this.placed.slice());
    if (this.past.length > 200) this.past.shift();
    this.future.length = 0;
  }

  openGesture(): void { this.snapped = false; }

  /** Which tiles are still in the tray. */
  spare(): number[] {
    const down = new Set(this.placed.filter((t) => t >= 0));
    const out: number[] = [];
    for (let t = 0; t < this.hex.tiles.length; t++) if (!down.has(t)) out.push(t);
    return out;
  }

  /** Where a tile is lying, or -1. */
  where(tile: number): number { return this.placed.indexOf(tile); }

  /**
   * Lay `tile` in `at`.
   *
   * Whatever was there goes back to the tray, and if the tile was already
   * somewhere else it leaves that space — so dragging one laid tile onto
   * another is a swap without anything having to know the word.
   */
  place(at: number, tile: number): void {
    if (at < 0 || at >= this.placed.length) return;
    if (tile < 0 || tile >= this.hex.tiles.length) return;
    if (this.placed[at] === tile) return;
    this.mark();
    const from = this.placed.indexOf(tile);
    const displaced = this.placed[at];
    this.placed[at] = tile;
    if (from >= 0) this.placed[from] = displaced;
  }

  /** Take the tile in `at` back to the tray. */
  lift(at: number): void {
    if (at < 0 || at >= this.placed.length || this.placed[at] < 0) return;
    this.mark();
    this.placed[at] = -1;
  }

  verdict(): Verdict {
    const j = judge(this.hex, this.placed);
    this.effort.note(j.progress);
    return {
      solved: j.solved,
      fault: firstFault(j),
      left: whatIsLeft(this.hex, j),
      progress: j.progress,
    };
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.placed.slice());
    this.placed = prev;
    this.effort.undid();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.placed.slice());
    this.placed = next;
    return true;
  }

  restart(): void {
    this.mark();
    this.placed = new Array(this.hex.cells.length).fill(-1);
    this.snapped = false;
  }

  /** Every tile laid in the space it was cut for. */
  reveal(): void {
    this.mark();
    this.placed = this.hex.answer.slice();
    this.snapped = false;
  }

  /** The tiles themselves, so a save from one board cannot load into another. */
  private fingerprint(): string {
    return this.hex.tiles.map((t) => t.join('')).join('.');
  }

  save(): string {
    return `1;${this.fingerprint()};${this.effort.freeze().join(',')};${this.placed.join(',')}`;
  }

  load(saved: string): boolean {
    const [version, fingerprint, effort, body] = saved.split(';');
    if (version !== '1' || fingerprint !== this.fingerprint()) return false;
    const placed = (body ?? '').split(',').map(Number);
    if (placed.length !== this.hex.cells.length) return false;
    if (placed.some((t) => !Number.isInteger(t) || t < -1 || t >= this.hex.tiles.length)) return false;
    const down = placed.filter((t) => t >= 0);
    if (new Set(down).size !== down.length) return false;
    this.placed = placed;
    this.effort.thaw((effort ?? '').split(',').map(Number));
    this.past.length = 0;
    this.future.length = 0;
    return true;
  }

  signature(): string { return this.effort.toString(); }

  /**
   * Which tiles could still go in each empty space, given what is down.
   *
   * A tile fits a space when it agrees with every laid neighbour. That is the
   * whole of it — no lookahead, no guessing at what the empty neighbours might
   * become — because it is the reasoning a person can actually check by
   * holding the tile up to the board.
   */
  fits(): number[][] {
    const near = neighboursOf(this.hex);
    const spare = this.spare();
    return this.hex.cells.map((_, at) => {
      if (this.placed[at] >= 0) return [];
      return spare.filter((t) => near[at].every((nb) => {
        const other = this.placed[nb.at];
        return other < 0 || agree(this.hex.tiles, t, other, nb.dir);
      }));
    });
  }

  /**
   * The next useful deduction.
   *
   * A tile lying where the answer does not put it comes first, whether or
   * not its numbers happen to agree with its neighbours: every "only tile
   * that fits" worked out beside it would be worked out against the wrong
   * tile. Then a space that exactly one tile fits, which is a move you can
   * make without thinking. Otherwise the best advice is where to look: the
   * space with the fewest candidates, named but not answered — and at the
   * third rung, the tile that goes there, described by its faces.
   */
  hint(): Hint | null {
    const { hex } = this;
    for (let at = 0; at < this.placed.length; at++) {
      const t = this.placed[at];
      if (t >= 0 && t !== hex.answer[at]) {
        return astray('The tile in the space lit up', [`cell:${at}`], [`cell:${at}!=tile:${t}`]);
      }
    }

    const fits = this.fits();
    const empty = hex.cells.map((_, at) => at).filter((at) => this.placed[at] < 0);
    if (empty.length === 0) return null;

    empty.sort((a, b) => fits[a].length - fits[b].length);
    const best = empty[0];
    if (fits[best].length === 1) {
      return {
        kind: 'step',
        focus: [`cell:${best}`, `tile:${fits[best][0]}`],
        reason: 'Only one tile left agrees with everything around the space lit up.',
        move: 'It is the tile lit up in the tray.',
        claim: [`cell:${best}=tile:${fits[best][0]}`],
      };
    }
    const tile = hex.answer[best];
    return {
      kind: 'look',
      focus: [`cell:${best}`],
      reason: `This is the tightest space left — only ${fits[best].length} tiles still fit it. Work out from where the most neighbours are already down.`,
      move: `The tile whose faces read ${hex.tiles[tile].join(' ')}, clockwise from the right, goes in the space lit up.`,
      claim: [`cell:${best}=tile:${tile}`],
    };
  }

  /** For the gate and the tests: does deduction alone finish this board? */
  reading(): ReturnType<typeof analyse> { return analyse(this.hex); }
}
