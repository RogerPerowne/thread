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
import { nextRun } from './reason.js';
import { Effort } from '../../platform/signature.js';
import { astray } from '../../platform/hint.js';
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

  /** Every string run as the designer drew it before the board existed. */
  reveal(): void {
    this.mark();
    this.paths = this.board.solution.map((run) => [...run]);
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
   * A string that has left its route comes first. The answer is one route per
   * colour, pin to pin, and a string that started at either pin has to follow
   * it — so the first post where the laid string and the route part company
   * is a wrong run, whether or not it breaks a rule yet, and every post laid
   * after it is laid on top of that mistake.
   *
   * Then the same crossing-out the designer used to prove the board has one
   * answer, started from the player's own strings and stopped at the first
   * thing it can say that they have not. Always one step, always one the
   * board itself justifies, and always one they could have found from what is
   * drawn. And when nothing is forced, a true thing about where to look, with
   * one run from the route named at the third rung.
   */
  hint(): Hint | null {
    const { board } = this;
    for (let s = 0; s < this.paths.length; s++) {
      const path = this.paths[s];
      if (path.length === 0) continue;
      const route = board.solution[s];
      const along = path[0] === route[0] ? route : [...route].reverse();
      const k = path.findIndex((p, i) => p !== along[i]);
      if (k < 0) continue;
      const focus = k === 0 ? [`post:${path[0]}`] : [`post:${path[k - 1]}`, `post:${path[k]}`];
      const claim = k === 0 ? [] : [`norun:${path[k - 1]}-${path[k]}`];
      return astray(k === 0 ? 'The string starting at the post lit up' : 'The string between the two posts lit up', focus, claim);
    }

    const v = this.raw();
    if (v.solved) return null;
    if (v.broken.length > 0) {
      const clash = v.clashes[0] ?? v.badRuns[0];
      return {
        kind: 'fix',
        focus: clash ? [`post:${clash[0]}`, `post:${clash[1]}`] : [],
        reason: 'Something already on the board breaks the rule, so nothing follows from here.',
        move: 'Take that bit of string back and the board can be reasoned on again.',
        claim: [],
      };
    }

    const step = nextRun(this.c, this.paths);
    if (step) {
      return {
        kind: 'step',
        focus: [`post:${step.a}`, `post:${step.b}`],
        reason: step.reason,
        move: 'Lay string between the two posts lit up.',
        claim: [`run:${step.a}-${step.b}`],
      };
    }

    /*
     * Nothing is forced from here. That is not a dead end — it means the next
     * move needs two facts at once — so the most useful thing left to say is
     * where the board is tightest, which is where two facts are likeliest to
     * meet. The third rung carries one string on along its route.
     */
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
    const next = this.nextOnRoute();
    if (tightest < 0 && !next) return null;
    return {
      kind: 'look',
      focus: tightest < 0 ? [`post:${next!.from}`] : [`post:${tightest}`],
      reason: tightest < 0
        ? 'Nothing is forced just now. Every post has to be used, so look for one that only one string can still reach.'
        : `Nothing is forced just now. The post lit up has only ${fewest} ${fewest === 1 ? 'way' : 'ways'} out — fewer than anything else left, so it is where the next thing will be decided.`,
      move: next ? `Carry the ${next.colour} string on from its loose end to the post ${next.where} it.` : undefined,
      claim: next ? [`run:${next.from}-${next.to}`] : [],
    };
  }

  /**
   * One run the route makes next: from the loose end of a started string, or
   * out of the first pin of one that has not been started. Described by
   * colour and direction, because posts have no names.
   */
  private nextOnRoute(): { from: number; to: number; colour: string; where: string } | null {
    const { board } = this;
    for (let s = 0; s < this.paths.length; s++) {
      const path = this.paths[s];
      const route = board.solution[s];
      const along = path.length > 0 && path[0] !== route[0] ? [...route].reverse() : route;
      if (path.length >= along.length) continue;
      const from = path.length === 0 ? along[0] : path[path.length - 1];
      const to = along[path.length === 0 ? 1 : path.length];
      const [ax, ay] = board.posts[from];
      const [bx, by] = board.posts[to];
      const dx = bx - ax;
      const dy = by - ay;
      const ns = Math.abs(dy) > Math.abs(dx) * 0.4 ? (dy < 0 ? 'above' : 'below') : '';
      const ew = Math.abs(dx) > Math.abs(dy) * 0.4 ? (dx < 0 ? 'left of' : 'right of') : '';
      const where = ns && ew ? `${ns} and to the ${ew.split(' ')[0]} of` : ns || ew;
      return { from, to, colour: inkName(board.strands[s].color), where };
    }
    return null;
  }
}

/** The six inks, by the names a person would use for them. */
function inkName(hex: string): string {
  const names: Record<string, string> = {
    '#d55e00': 'orange', '#0072b2': 'blue', '#009e73': 'green',
    '#cc79a7': 'pink', '#e69f00': 'amber', '#56b4e9': 'sky-blue',
  };
  return names[hex.toLowerCase()] ?? 'coloured';
}
