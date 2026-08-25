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

/**
 * Something the player has done wrong. A break is a thing on the board that
 * should not be there, it has a place you can point at, and undoing the move
 * that caused it makes it go.
 */
export type Break =
  /** A post appears on more than one strand, or twice on one. */
  | 'reuse'
  /** A run that cannot exist: it clips a post it does not use, or a block. */
  | 'blocked'
  /** Two runs are closer than the string is thick. */
  | 'touch'
  /** A turn so tight the string lies along itself past the nail. */
  | 'fold';

/**
 * Something the player has not done yet. This is NOT a fault and must never be
 * shown as one: it is true of every board from the moment it opens until the
 * moment it is solved, so a warning about it would be on the whole game and
 * could never go. It is the state of play, and the post counter already says
 * it.
 */
export type Missing =
  /** Every strand is laid, but posts are left over. */
  | 'unused'
  /** A strand does not start and end where it is pinned. */
  | 'ends';

export type Fault = Break | Missing;

const BREAKS: readonly Break[] = ['touch', 'fold', 'blocked', 'reuse'];

export type Verdict = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  /** The faults that are the player's doing, in the order worth saying. */
  readonly broken: readonly Break[];
  /** What is left to do. Never a warning. */
  readonly missing: readonly Missing[];
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
    broken: BREAKS.filter((f) => faults.has(f)),
    missing: (['ends', 'unused'] as const).filter((f) => faults.has(f)),
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
  touch: 'The strings are lying on each other',
  fold: 'That turn is too tight — the string lies on itself',
  unused: 'Every post has to be used',
  ends: 'Each string has to join its own two ends',
};

/**
 * The one thing that is WRONG with the board, or nothing.
 *
 * Ordered by what the player can act on soonest, and saying one thing plainly
 * rather than listing four. Empty when the board is merely unfinished — which
 * is the whole point of the split: a warning that is true for the entire game
 * is not a warning, and a player who has been shown red since their first move
 * has no way to tell when they have fixed something.
 */
export function firstBreak(v: Verdict): string {
  const f = v.broken[0];
  return f ? FAULT_TEXT[f] : '';
}

/**
 * What is left to do, said quietly, or nothing. Only reached when there is
 * nothing wrong — otherwise the board has a real problem and that is the more
 * useful sentence.
 */
export function whatIsLeft(v: Verdict): string {
  if (v.broken.length > 0) return '';
  const left = v.unused.length;
  if (left > 0) return left === 1 ? 'One post to go' : `${left} posts to go`;
  if (v.missing.includes('ends')) return 'Join each string to its own two ends';
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
