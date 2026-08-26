/**
 * Thread's live puzzle: what is on the board, and everything you can do to it.
 *
 * The board holds PIECES of string, each a contiguous run of posts belonging
 * to a known strand. A strand is one piece when it is finished, and can be
 * more than one while it is being built — start at one pinned end, start at
 * the other, join them in the middle; or grab the middle of a finished string
 * and break it in two while you reroute. Nothing is ever hidden: what is drawn
 * is the whole state.
 *
 * No DOM here. The view drives this and draws it; this decides what is legal
 * and what it means.
 */

import {
  compile, runBetween, type Board, type Compiled,
} from './board.js';
import { judge, firstBreak, whatIsLeft } from './check.js';
import { Effort } from '../../platform/signature.js';
import type { Hint, Session, Verdict } from '../../platform/types.js';

export type Piece = { strand: number; posts: number[] };
export type ThreadState = { pieces: Piece[] };

const clone = (ps: readonly Piece[]): Piece[] =>
  ps.map((p) => ({ strand: p.strand, posts: p.posts.slice() }));

export class ThreadSession implements Session<ThreadState> {
  readonly board: Board;
  readonly c: Compiled;
  pieces: Piece[] = [];
  readonly effort = new Effort();

  private past: Piece[][] = [];
  private future: Piece[][] = [];
  private snapped = false;

  constructor(board: Board) {
    this.board = board;
    this.c = compile(board);
  }

  get state(): ThreadState {
    return { pieces: this.pieces };
  }

  /**
   * Take a snapshot, once per gesture, before the first change it makes.
   *
   * One undo step per gesture is the right granularity: a gesture is a move,
   * and a drag across nine posts that undoes one post at a time is nine
   * presses of Undo to get back to where you started.
   */
  mark(): void {
    if (this.snapped) return;
    this.snapped = true;
    this.past.push(clone(this.pieces));
    if (this.past.length > 120) this.past.shift();
    this.future.length = 0;
  }

  /** Called by the view when a gesture begins and ends. */
  openGesture(): void { this.snapped = false; }

  /**
   * The pieces as an attempt the judge can read: one entry per strand, plus
   * any extra pieces on the end. A strand with two pieces cannot have both its
   * ends joined yet, so the ends check fails on it — which is correct, and
   * reads as "not finished" rather than as a fault.
   */
  attempt(): number[][] {
    const out: number[][] = this.board.strands.map(() => []);
    const extra: number[][] = [];
    const taken = new Uint8Array(this.board.strands.length);
    for (const piece of this.pieces) {
      if (!taken[piece.strand]) {
        taken[piece.strand] = 1;
        out[piece.strand] = piece.posts;
      } else extra.push(piece.posts);
    }
    return [...out, ...extra];
  }

  /** The engine's own verdict, with the parts only the board needs. */
  raw(): ReturnType<typeof judge> {
    const laid = this.pieces.some((p) => p.posts.length > 1);
    return judge(this.c, this.attempt(), !laid);
  }

  verdict(): Verdict {
    /*
     * A board nobody has touched is judged as work in progress, not as a wrong
     * answer. Otherwise the first thing a player is told, before they have
     * done anything at all, is that they have broken a rule.
     */
    const laid = this.pieces.some((p) => p.posts.length > 1);
    const v = this.raw();
    const fault = laid ? firstBreak(v) : '';
    const left = laid ? whatIsLeft(v) : 'Drag from a coloured post';
    this.effort.note(v.progress);
    return {
      solved: v.solved,
      fault,
      left: v.solved ? 'Solved' : (fault ? '' : left),
      progress: v.progress,
    };
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(clone(this.pieces));
    this.pieces = prev;
    this.effort.undid();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(clone(this.pieces));
    this.pieces = next;
    return true;
  }

  restart(): void {
    this.mark();
    this.pieces = [];
    this.snapped = false;
  }

  /**
   * The player's state, as a string.
   *
   * Post indices, so it is short and it cannot be read as an answer by anyone
   * looking at storage. The board id goes in front: a saved state put back
   * against a different puzzle is refused rather than half-applied.
   */
  save(): string {
    const body = this.pieces.map((p) => `${p.strand}:${p.posts.join(',')}`).join('|');
    return `1;${this.board.id};${this.effort.freeze().join(',')};${body}`;
  }

  load(saved: string): boolean {
    const [version, id, effort, body] = saved.split(';');
    if (version !== '1' || id !== this.board.id) return false;
    const pieces: Piece[] = [];
    for (const chunk of (body ?? '').split('|').filter(Boolean)) {
      const [s, posts] = chunk.split(':');
      const strand = Number(s);
      const list = posts.split(',').filter((x) => x !== '').map(Number);
      if (!Number.isInteger(strand) || strand < 0 || strand >= this.board.strands.length) return false;
      if (list.some((n) => !Number.isInteger(n) || n < 0 || n >= this.board.posts.length)) return false;
      // A saved run that is not actually layable means the board changed under
      // the save. Refusing is better than restoring something illegal.
      for (let i = 0; i + 1 < list.length; i++) {
        if (runBetween(this.c, list[i], list[i + 1]) < 0) return false;
      }
      if (list.length > 0) pieces.push({ strand, posts: list });
    }
    this.pieces = pieces;
    this.effort.thaw((effort ?? '').split(',').map(Number));
    this.past.length = 0;
    this.future.length = 0;
    return true;
  }

  signature(): string {
    return this.effort.toString();
  }

  /**
   * The next useful deduction.
   *
   * Thread's is a genuine one rather than a peek at the answer: a post with
   * only one legal run left to it must be an end of a string, because a post
   * in the middle of one needs a run in and a run out. That is the deduction a
   * player makes without noticing, and pointing at it is enough to unstick a
   * board without spoiling it.
   *
   * Failing that, it looks for the tightest corner — the post with the fewest
   * ways out that is not yet used — which is where the board is most nearly
   * decided and therefore where thinking pays best.
   */
  hint(): Hint | null {
    const used = new Set<number>();
    for (const piece of this.pieces) for (const p of piece.posts) used.add(p);

    let tightest = -1;
    let fewest = Infinity;
    for (let p = 0; p < this.c.n; p++) {
      if (used.has(p)) continue;
      const ways = this.c.neighbours[p].filter((q) => !used.has(q)).length;
      if (ways === 0) continue;
      if (ways < fewest) { fewest = ways; tightest = p; }
    }
    if (tightest < 0) return null;

    const pinned = this.board.strands.some((s) => s.from === tightest || s.to === tightest);
    if (fewest === 1) {
      return {
        focus: [`post:${tightest}`],
        reason: pinned
          ? 'This end has only one way out left, so that run has to be laid.'
          : 'Only one run still reaches this post, so it has to be the end of a string.',
        move: `Lay string between post ${tightest} and its one remaining neighbour.`,
      };
    }
    return {
      focus: [`post:${tightest}`],
      reason: `This post has only ${fewest} ways out — fewer than anything else left, so it is the one most nearly decided.`,
    };
  }
}
