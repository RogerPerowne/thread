/**
 * How hard a board is to THINK about.
 *
 * The solver proves a board has one answer. That is a different question from
 * whether a person can find it, and the difference is the whole of what makes
 * a board worth shipping: a puzzle you have to guess at is not a hard puzzle,
 * it is a coin toss with more steps.
 *
 * So this plays the deduction instead. It knows only the things a player can
 * see on the board, and it applies them in the order a player applies them:
 *
 *   - a post needs exactly two runs, and a pinned end exactly one;
 *   - so if a post has as many runs still open as it still needs, they are all
 *     laid, and if it already has its full share, the rest are impossible;
 *   - a run that is laid rules out every run that would lie across it;
 *   - string never closes a loop, so a run joining the two ends of one piece
 *     of string is impossible;
 *   - and two pieces of string of different colours never join.
 *
 * Repeat until nothing more can be said. A board that finishes is one that can
 * be reasoned out; a board that stalls needs a guess, and is not shipped.
 */

import { conflicts, runBetween, type Compiled } from './board.js';

export type Reading = {
  /** True when the reasoning alone finishes the board. */
  readonly byReason: boolean;
  /** How many passes it took. */
  readonly rounds: number;
  /** Runs still undecided at the start: the size of the room you begin in. */
  readonly opening: number;
  /** Runs still undecided when the reasoning ran out of things to say. */
  readonly stuck: number;
  /** How many runs the first pass alone settles — how obvious the way in is. */
  readonly entry: number;
};

const UNKNOWN = 0;
const ON = 1;
const OFF = 2;

/**
 * Play the deduction on a board, from nothing laid.
 *
 * Chains of laid string are tracked with a union-find over posts, which is
 * what makes the loop rule and the colour rule cheap: two posts are on the
 * same piece of string exactly when they share a root.
 */
export function analyse(c: Compiled): Reading {
  const { board, runs, n } = c;
  const state = new Uint8Array(runs.length);

  /** How many runs each post needs: one at a pinned end, two anywhere else. */
  const need = new Uint8Array(n).fill(2);
  /** Which strand a post is pinned for, or -1. */
  const pinOf = new Int32Array(n).fill(-1);
  board.strands.forEach((s, i) => {
    for (const p of [s.from, s.to]) {
      if (p < 0) continue;
      need[p] = 1;
      pinOf[p] = i;
    }
  });

  const at: number[][] = Array.from({ length: n }, () => []);
  runs.forEach((r, i) => { at[r.a].push(i); at[r.b].push(i); });

  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const up = parent[x]; parent[x] = r; x = up; }
    return r;
  };
  /** The colour a piece of string has taken on, by root. -1 for none yet. */
  const colour = new Int32Array(n).fill(-1);
  for (let p = 0; p < n; p++) colour[p] = pinOf[p];

  const on = new Uint8Array(n);
  const off = new Uint8Array(n);
  const count = (): void => {
    on.fill(0); off.fill(0);
    runs.forEach((r, i) => {
      if (state[i] === ON) { on[r.a]++; on[r.b]++; }
      else if (state[i] === OFF) { off[r.a]++; off[r.b]++; }
    });
  };

  const lay = (i: number): boolean => {
    if (state[i] !== UNKNOWN) return false;
    state[i] = ON;
    const ra = find(runs[i].a);
    const rb = find(runs[i].b);
    if (ra !== rb) {
      const hue = colour[ra] >= 0 ? colour[ra] : colour[rb];
      parent[rb] = ra;
      colour[ra] = hue;
    }
    return true;
  };

  const opening = runs.length;
  let rounds = 0;
  let entry = 0;

  for (;;) {
    rounds++;
    let moved = false;
    count();

    /* What each post's own count forces. */
    for (let p = 0; p < n; p++) {
      const open = at[p].filter((i) => state[i] === UNKNOWN);
      if (open.length === 0) continue;
      if (on[p] === need[p]) {
        for (const i of open) { state[i] = OFF; moved = true; }
      } else if (on[p] + open.length === need[p]) {
        for (const i of open) if (lay(i)) moved = true;
      }
    }

    /* What a laid run rules out, and what would close a loop or mix colours. */
    for (let i = 0; i < runs.length; i++) {
      if (state[i] === ON) {
        for (let j = 0; j < runs.length; j++) {
          if (j === i || state[j] !== UNKNOWN) continue;
          if (conflicts(c, i, j)) { state[j] = OFF; moved = true; }
        }
        continue;
      }
      if (state[i] !== UNKNOWN) continue;
      const ra = find(runs[i].a);
      const rb = find(runs[i].b);
      if (ra === rb) { state[i] = OFF; moved = true; continue; }
      if (colour[ra] >= 0 && colour[rb] >= 0 && colour[ra] !== colour[rb]) {
        state[i] = OFF;
        moved = true;
      }
    }

    if (rounds === 1) {
      entry = state.reduce((k, v) => k + (v === UNKNOWN ? 0 : 1), 0);
    }
    if (!moved || rounds > 200) break;
  }

  let stuck = 0;
  for (const v of state) if (v === UNKNOWN) stuck++;

  return { byReason: stuck === 0, rounds, opening, stuck, entry };
}

/**
 * How hard a board is to think about, as one number.
 *
 * The same shape as every other game here: the size of the room you start in,
 * how far the crossing-out has to be carried, and a class of its own for a
 * board that crossing-out never finishes — because from there the only way on
 * is to try something and see.
 */
export function scoreOf(r: Reading): number {
  return Math.log2(Math.max(1, r.opening)) * 7
    + r.rounds * 3.5
    + r.stuck * 0.6
    + (r.byReason ? 0 : 40);
}

// ---------------------------------------------------------------------------
// The next deduction, from where the player actually is
// ---------------------------------------------------------------------------

export type Step = {
  /** The run that has to be laid. */
  readonly a: number;
  readonly b: number;
  /** Why, in the words the player would use. */
  readonly reason: string;
};

/**
 * The next run that HAS to be laid, given what is on the board already.
 *
 * The same crossing-out as `analyse`, started from the player's own strings
 * rather than from nothing, and stopped at the first thing it can say that the
 * player has not already done. So the hint is never "the answer is this": it
 * is one step, and it is a step the player could have taken themselves from
 * what is drawn.
 *
 * Returns null when nothing is forced — either because the board is finished,
 * or because what is down cannot be carried on from (which is a different
 * thing, and the fault line says so).
 */
export function nextRun(c: Compiled, paths: readonly (readonly number[])[]): Step | null {
  const { board, runs, n } = c;
  const state = new Uint8Array(runs.length);

  const need = new Uint8Array(n).fill(2);
  const pinOf = new Int32Array(n).fill(-1);
  board.strands.forEach((s, i) => {
    for (const p of [s.from, s.to]) {
      if (p < 0) continue;
      need[p] = 1;
      pinOf[p] = i;
    }
  });

  const at: number[][] = Array.from({ length: n }, () => []);
  runs.forEach((r, i) => { at[r.a].push(i); at[r.b].push(i); });

  /* What the player has laid is where the reasoning starts. */
  const laid = new Set<number>();
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i++) {
      const run = runBetween(c, path[i], path[i + 1]);
      if (run >= 0) { state[run] = ON; laid.add(run); }
    }
  }

  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const up = parent[x]; parent[x] = r; x = up; }
    return r;
  };
  const colour = new Int32Array(n);
  for (let p = 0; p < n; p++) colour[p] = pinOf[p];
  const join = (i: number): void => {
    const ra = find(runs[i].a);
    const rb = find(runs[i].b);
    if (ra === rb) return;
    const hue = colour[ra] >= 0 ? colour[ra] : colour[rb];
    parent[rb] = ra;
    colour[ra] = hue;
  };
  for (const i of laid) join(i);

  const on = new Uint8Array(n);
  const count = (): void => {
    on.fill(0);
    runs.forEach((r, i) => { if (state[i] === ON) { on[r.a]++; on[r.b]++; } });
  };

  /** What to say about a post that has exactly as many ways left as it needs. */
  const why = (p: number, has: number, left: number): string => {
    if (need[p] === 1) return 'This end has only one way out left, so that is where its string goes.';
    if (has === 1) return 'This post already has one run and only one way left, and every post needs two.';
    if (left === 2) return 'Only two runs still reach this post, and every post needs two — so both are laid.';
    return 'This post has as many ways left as it still needs, so they all have to be laid.';
  };

  for (let round = 0; round < 200; round++) {
    let moved = false;
    count();

    for (let p = 0; p < n; p++) {
      const open = at[p].filter((i) => state[i] === UNKNOWN);
      if (open.length === 0) continue;
      if (on[p] === need[p]) {
        for (const i of open) { state[i] = OFF; moved = true; }
      } else if (on[p] + open.length === need[p]) {
        const reason = why(p, on[p], open.length);
        for (const i of open) {
          state[i] = ON;
          join(i);
          moved = true;
          /* The first thing the reasoning can say that the player has not
             already said is the hint. Nothing deeper is worth showing: a
             player wants the next step, not the tenth. */
          if (!laid.has(i)) return { a: runs[i].a, b: runs[i].b, reason };
        }
      }
    }

    for (let i = 0; i < runs.length; i++) {
      if (state[i] === ON) {
        for (let j = 0; j < runs.length; j++) {
          if (j === i || state[j] !== UNKNOWN) continue;
          if (conflicts(c, i, j)) { state[j] = OFF; moved = true; }
        }
        continue;
      }
      if (state[i] !== UNKNOWN) continue;
      const ra = find(runs[i].a);
      const rb = find(runs[i].b);
      if (ra === rb) { state[i] = OFF; moved = true; continue; }
      if (colour[ra] >= 0 && colour[rb] >= 0 && colour[ra] !== colour[rb]) {
        state[i] = OFF;
        moved = true;
      }
    }

    if (!moved) break;
  }
  return null;
}
