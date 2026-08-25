/**
 * Judging an attempt.
 *
 * The rule is one sentence, so this file is mostly about saying WHICH part of
 * it a board is failing and WHERE — a player who is told "no" learns nothing,
 * and a player who is shown the two runs that are touching learns the game.
 *
 * Everything here reads the compiled board rather than measuring: the geometry
 * was settled once, on load. A full judgement of a finished board is a few
 * hundred array lookups, which is why it can run on every pointer move.
 */

import { type Compiled, type Board, runBetween, conflicts } from './board.js';

export type Fault =
  /** A post appears on more than one strand, or twice on one. */
  | 'reuse'
  /** A run that cannot exist: it clips a post it does not use, or a block. */
  | 'blocked'
  /** Two runs are closer than the string is thick. */
  | 'touch'
  /** The string folds back on itself at a post. */
  | 'fold'
  /** Every strand is laid, but posts are left over. */
  | 'unused'
  /** A strand does not start and end where it is pinned. */
  | 'ends';

export type Verdict = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  /** Posts no strand uses. Drives the count on screen and the ghost ring. */
  readonly unused: readonly number[];
  /** Post pairs whose run cannot exist. */
  readonly badRuns: readonly (readonly [number, number])[];
  /** Pairs of runs in contact, as post pairs, for the clash marks. */
  readonly clashes: readonly (readonly [number, number])[];
  /** How much of the board is done, 0..1 — posts used, not a similarity. */
  readonly progress: number;
};

export type Attempt = readonly (readonly number[])[];

const EMPTY: readonly number[] = [];

/**
 * Judge `attempt` against the board.
 *
 * `partial` is the live case: a strand still being dragged is not yet expected
 * to reach its far end, and leftover posts are not yet a fault. The contact
 * rules are enforced the whole time either way, because a string that is
 * already touching another will still be touching it when you let go, and
 * finding that out at the end is the worst moment to find it out.
 */
export function judge(c: Compiled, attempt: Attempt, partial = false): Verdict {
  const board = c.board;
  const faults = new Set<Fault>();
  const badRuns: [number, number][] = [];
  const clashes: [number, number][] = [];

  // --- every post at most once ---------------------------------------------
  const owner = new Int32Array(c.n).fill(-1);
  let used = 0;
  for (let s = 0; s < attempt.length; s++) {
    for (const p of attempt[s] ?? EMPTY) {
      if (p < 0 || p >= c.n) continue;
      if (owner[p] !== -1) faults.add('reuse');
      else { owner[p] = s; used++; }
    }
  }

  // --- the runs actually laid ----------------------------------------------
  const laid: number[] = [];
  const laidPair: [number, number][] = [];
  for (const strand of attempt) {
    const path = strand ?? EMPTY;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const id = runBetween(c, a, b);
      if (id < 0) {
        faults.add('blocked');
        badRuns.push([a, b]);
        continue;
      }
      laid.push(id);
      laidPair.push([a, b]);
    }
  }

  // --- no two runs may touch, and no string may fold -----------------------
  for (let i = 0; i < laid.length; i++) {
    for (let j = i + 1; j < laid.length; j++) {
      if (!conflicts(c, laid[i], laid[j])) continue;
      const r = c.runs[laid[i]];
      const s = c.runs[laid[j]];
      const shares = r.a === s.a || r.a === s.b || r.b === s.a || r.b === s.b;
      faults.add(shares ? 'fold' : 'touch');
      clashes.push(laidPair[i], laidPair[j]);
    }
  }

  // --- pinned ends ---------------------------------------------------------
  if (!partial) {
    for (let s = 0; s < board.strands.length; s++) {
      const want = board.strands[s];
      const path = attempt[s] ?? EMPTY;
      if (want.from < 0) continue; // Classic pins neither end.
      if (path.length < 2) { faults.add('ends'); continue; }
      const first = path[0];
      const last = path[path.length - 1];
      const okForward = first === want.from && last === want.to;
      const okBack = first === want.to && last === want.from;
      if (!okForward && !okBack) faults.add('ends');
    }
  }

  // --- every post used -----------------------------------------------------
  const unused: number[] = [];
  for (let p = 0; p < c.n; p++) if (owner[p] === -1) unused.push(p);
  if (!partial && unused.length > 0) faults.add('unused');

  return {
    solved: !partial && faults.size === 0,
    faults: [...faults],
    unused,
    badRuns,
    clashes,
    progress: c.n === 0 ? 1 : used / c.n,
  };
}

/** What a fault means, in the fewest words that still teach the rule. */
export const FAULT_TEXT: Record<Fault, string> = {
  reuse: 'A post can only be used once',
  blocked: 'The string cannot pass there',
  touch: 'The strings are touching',
  fold: 'The string folds back on itself',
  unused: 'Every post has to be used',
  ends: 'Each string has to join its own two ends',
};

/**
 * The single thing to say about a board that is not solved.
 *
 * Ordered by what the player can act on soonest: a touch is right in front of
 * them, leftover posts are a whole-board problem. Saying one thing plainly
 * beats listing four.
 */
export function firstFault(v: Verdict): string {
  const order: Fault[] = ['touch', 'fold', 'blocked', 'reuse', 'ends', 'unused'];
  for (const f of order) if (v.faults.includes(f)) return FAULT_TEXT[f];
  return '';
}

/** Board -> the ends a strand is pinned to, for drawing the anchors. */
export function pinnedPosts(board: Board): number[] {
  const out: number[] = [];
  for (const s of board.strands) {
    if (s.from >= 0) out.push(s.from, s.to);
  }
  return out;
}
