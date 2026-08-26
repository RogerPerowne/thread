/**
 * Thread's live puzzle: what is on the board, and everything you can do to it.
 *
 * ONE STRING PER COLOUR. The board holds exactly one run of posts per strand,
 * and that run always begins at one of the strand's two pinned ends. There is
 * no way to have two loose pieces of one colour lying about, because there is
 * nowhere to put a second one — which is the whole reason this is a single
 * array per strand rather than a list of pieces. A puzzle where a colour can
 * be in two places at once asks the player to keep track of something the
 * puzzle never needed.
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

/** One run of posts per strand, in the order the string passes through them. */
export type Paths = number[][];
export type ThreadState = { paths: Paths };

const clone = (ps: Paths): Paths => ps.map((p) => p.slice());

export class ThreadSession implements Session<ThreadState> {
  readonly board: Board;
  readonly c: Compiled;
  paths: Paths;
  readonly effort = new Effort();

  private past: Paths[] = [];
  private future: Paths[] = [];
  private snapped = false;

  constructor(board: Board) {
    this.board = board;
    this.c = compile(board);
    this.paths = board.strands.map(() => []);
  }

  get state(): ThreadState {
    return { paths: this.paths };
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
    this.past.push(clone(this.paths));
    if (this.past.length > 120) this.past.shift();
    this.future.length = 0;
  }

  /** Called by the view when a gesture begins and ends. */
  openGesture(): void { this.snapped = false; }

  /** Which strand's string passes through this post, or -1. */
  strandAt(post: number): number {
    for (let s = 0; s < this.paths.length; s++) {
      if (this.paths[s].includes(post)) return s;
    }
    return -1;
  }

  /** The strand this post is a pinned end of, or -1. */
  pinAt(post: number): number {
    for (let s = 0; s < this.board.strands.length; s++) {
      const spec = this.board.strands[s];
      if (spec.from === post || spec.to === post) return s;
    }
    return -1;
  }

  /** The far end of a strand: the pin its string has not started from. */
  target(strand: number): number {
    const spec = this.board.strands[strand];
    const path = this.paths[strand];
    if (path.length === 0) return -1;
    return path[0] === spec.from ? spec.to : spec.from;
  }

  /** The engine's own verdict, with the parts only the board needs. */
  raw(): ReturnType<typeof judge> {
    const laid = this.paths.some((p) => p.length > 1);
    return judge(this.c, this.paths, !laid);
  }

  verdict(): Verdict {
    /*
     * A board nobody has touched is judged as work in progress, not as a wrong
     * answer. Otherwise the first thing a player is told, before they have
     * done anything at all, is that they have broken a rule.
     */
    const laid = this.paths.some((p) => p.length > 1);
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
    this.future.push(clone(this.paths));
    this.paths = prev;
    this.effort.undid();
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(clone(this.paths));
    this.paths = next;
    return true;
  }

  restart(): void {
    this.mark();
    this.paths = this.board.strands.map(() => []);
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
    const body = this.paths.map((p) => p.join(',')).join('|');
    return `2;${this.board.id};${this.effort.freeze().join(',')};${body}`;
  }

  load(saved: string): boolean {
    const [version, id, effort, body] = saved.split(';');
    if (version !== '2' || id !== this.board.id) return false;
    const chunks = (body ?? '').split('|');
    if (chunks.length !== this.board.strands.length) return false;
    const paths: Paths = [];
    for (const chunk of chunks) {
      const list = chunk.split(',').filter((x) => x !== '').map(Number);
      if (list.some((n) => !Number.isInteger(n) || n < 0 || n >= this.board.posts.length)) return false;
      // A saved run that is not actually layable means the board changed under
      // the save. Refusing is better than restoring something illegal.
      for (let i = 0; i + 1 < list.length; i++) {
        if (runBetween(this.c, list[i], list[i + 1]) < 0) return false;
      }
      paths.push(list);
    }
    /* A string always starts at one of its own pinned ends. Anything else is
       not a state this game can produce. */
    for (let s = 0; s < paths.length; s++) {
      if (paths[s].length === 0) continue;
      const spec = this.board.strands[s];
      if (paths[s][0] !== spec.from && paths[s][0] !== spec.to) return false;
    }
    this.paths = paths;
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
    for (const path of this.paths) for (const p of path) used.add(p);

    let tightest = -1;
    let fewest = Infinity;
    for (let p = 0; p < this.c.n; p++) {
      if (used.has(p)) continue;
      const ways = this.c.neighbours[p].filter((q) => !used.has(q)).length;
      if (ways === 0) continue;
      if (ways < fewest) { fewest = ways; tightest = p; }
    }
    if (tightest < 0) return null;

    const pinned = this.pinAt(tightest) >= 0;
    if (fewest === 1) {
      return {
        focus: [`post:${tightest}`],
        reason: pinned
          ? 'This end has only one way out left, so that run has to be laid.'
          : 'Only one run still reaches this post, so it has to be the end of a string.',
        move: 'Lay string between this post and its one remaining neighbour.',
      };
    }
    return {
      focus: [`post:${tightest}`],
      reason: `This post has only ${fewest} ways out — fewer than anything else left, so it is the one most nearly decided.`,
    };
  }
}
