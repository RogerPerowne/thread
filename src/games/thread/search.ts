/**
 * Finding answers, and proving there is only one.
 *
 * A level is only worth shipping if it has exactly one answer, so this file
 * has to be able to say "one" with confidence rather than "I found one". It
 * searches exhaustively and counts, stopping at a cap so a bad candidate costs
 * milliseconds rather than a hang.
 *
 * The search is a depth-first walk that grows one strand at a time. What makes
 * it finish at all is the pruning: after every run laid, it asks whether the
 * posts still standing can possibly be covered. Four questions, cheapest
 * first, and each of them kills whole subtrees that the raw search would spend
 * minutes inside.
 */

import type { Compiled } from './board.js';

export type SearchResult = {
  /** Up to `cap` distinct answers, canonicalised so each is counted once. */
  readonly solutions: readonly (readonly number[])[][];
  /** Search nodes expanded — the honest difficulty signal. */
  readonly nodes: number;
  /** True if the node budget ran out, so `solutions` may be incomplete. */
  readonly exhausted: boolean;
};

const DEFAULT_NODES = 400_000;

type State = {
  readonly c: Compiled;
  readonly visited: Uint8Array;
  /** How many laid runs conflict with each run; 0 means still available. */
  readonly blocked: Int32Array;
  readonly paths: number[][];
  readonly solutions: number[][][];
  readonly cap: number;
  readonly maxNodes: number;
  nodes: number;
  exhausted: boolean;
  /** Scratch, reused by the pruner so the hot path allocates nothing. */
  readonly queue: Int32Array;
  readonly region: Int32Array;
  readonly reached: Uint8Array;
};

/** Lay a run: mark it used and shut out everything it conflicts with. */
function block(st: State, run: number): void {
  const bits = st.c.conflicts[run];
  for (let w = 0; w < bits.length; w++) {
    let word = bits[w];
    while (word !== 0) {
      const bit = word & -word;
      const idx = (w << 5) + (31 - Math.clz32(bit));
      st.blocked[idx]++;
      word ^= bit;
    }
  }
}

function unblock(st: State, run: number): void {
  const bits = st.c.conflicts[run];
  for (let w = 0; w < bits.length; w++) {
    let word = bits[w];
    while (word !== 0) {
      const bit = word & -word;
      const idx = (w << 5) + (31 - Math.clz32(bit));
      st.blocked[idx]--;
      word ^= bit;
    }
  }
}

/** Is the run between a and b still available, given what is already laid? */
function open(st: State, a: number, b: number): number {
  const id = st.c.runId[a * st.c.n + b];
  if (id < 0) return -1;
  return st.blocked[id] === 0 ? id : -1;
}

/**
 * Could the posts still standing possibly be covered?
 *
 * 1. A post with no way out is already lost.
 * 2. A post with exactly one way out has to be the end of a strand, and there
 *    are only so many ends left to go round.
 * 3. The free posts fall into regions. A strand can only be laid inside one of
 *    them, so a strand whose two ends have ended up in different regions can
 *    never be joined — and the strand being grown has to be able to reach its
 *    own far end.
 * 4. Every post left has to be in a region something can get to.
 *
 * Three was the missing one, and it was worth a great deal. Without it the
 * search would lay a route straight across the board, cutting six strands off
 * from their own far ends, and then explore every arrangement of the wreckage
 * before finding out. It is what the cost of a big lattice was mostly being
 * spent on.
 *
 * All four are necessary conditions, never sufficient, so this only ever
 * prunes branches that genuinely cannot work.
 */
function feasible(st: State, head: number, strand: number): boolean {
  const { c, visited } = st;
  const n = c.n;
  const strands = c.board.strands;

  // Ends still available to land on a leftover post: the current strand has
  // one left to place, and each strand not yet started has two.
  let endsLeft = 1;
  for (let s = strand + 1; s < strands.length; s++) endsLeft += 2;

  let onlyOneWayOut = 0;
  for (let p = 0; p < n; p++) {
    if (visited[p]) continue;
    let deg = 0;
    for (const q of c.neighbours[p]) {
      if (!visited[q] || q === head) {
        if (open(st, p, q) >= 0) { deg++; if (deg > 1) break; }
      }
    }
    if (deg === 0) return false;
    if (deg === 1 && ++onlyOneWayOut > endsLeft) return false;
  }

  /*
   * Label the free posts by region: two are in the same region when a string
   * could run between them over free posts alone. `region` is -1 for a post
   * that is already used.
   */
  const { queue, region } = st;
  region.fill(-1);
  let regions = 0;
  for (let start = 0; start < n; start++) {
    if (visited[start] || region[start] >= 0) continue;
    const id = regions++;
    let qn = 0;
    queue[qn++] = start;
    region[start] = id;
    for (let i = 0; i < qn; i++) {
      const p = queue[i];
      for (const q of c.neighbours[p]) {
        if (visited[q] || region[q] >= 0) continue;
        if (open(st, p, q) >= 0) { region[q] = id; queue[qn++] = q; }
      }
    }
  }
  if (regions === 0) return true;

  // Which regions the growing strand can still get into.
  const reachable = st.reached;
  reachable.fill(0, 0, regions);
  let anyFromHead = false;
  for (const q of c.neighbours[head]) {
    if (visited[q] || region[q] < 0) continue;
    if (open(st, head, q) >= 0) { reachable[region[q]] = 1; anyFromHead = true; }
  }

  // The strand being grown has to be able to reach its own far end.
  const mine = strands[strand];
  if (mine.to >= 0 && !visited[mine.to]) {
    if (!anyFromHead || region[mine.to] < 0 || !reachable[region[mine.to]]) return false;
  }

  // A strand not yet started has to have both its ends in one region, and that
  // region is then somewhere a string can be laid.
  for (let s = strand + 1; s < strands.length; s++) {
    const spec = strands[s];
    if (spec.from < 0 || spec.to < 0) continue;
    if (visited[spec.from] || visited[spec.to]) return false;
    if (region[spec.from] !== region[spec.to]) return false;
    reachable[region[spec.from]] = 1;
  }

  /*
   * An unpinned strand can start anywhere, so it does not narrow the regions
   * down — it only says one more of them can be covered.
   */
  let free = 0;
  for (let s = strand + 1; s < strands.length; s++) {
    if (strands[s].from < 0) free++;
  }
  let unreached = 0;
  for (let r = 0; r < regions; r++) if (!reachable[r]) unreached++;
  if (unreached > free) return false;
  return true;
}

function allVisited(st: State): boolean {
  for (let p = 0; p < st.c.n; p++) if (!st.visited[p]) return false;
  return true;
}

function record(st: State): void {
  st.solutions.push(st.paths.map((p) => p.slice()));
}

/** Grow strand `s`, whose head is the last post on its path. */
function walk(st: State, s: number): void {
  if (st.nodes >= st.maxNodes) { st.exhausted = true; return; }
  if (st.solutions.length >= st.cap) return;
  st.nodes++;

  const strands = st.c.board.strands;
  const path = st.paths[s];
  const head = path[path.length - 1];
  const spec = strands[s];

  // A pinned strand is finished the moment it reaches its far end.
  if (spec.to >= 0 && head === spec.to) {
    if (s + 1 < strands.length) { startStrand(st, s + 1); return; }
    if (allVisited(st)) record(st);
    return;
  }

  // Classic pins nothing, so its strand finishes when the board is covered.
  if (spec.to < 0 && allVisited(st)) {
    // Count each answer once: a path and its reverse are the same string.
    if (path[0] < head) record(st);
    return;
  }

  if (!feasible(st, head, s)) return;

  for (const next of st.c.neighbours[head]) {
    if (st.visited[next]) continue;
    const run = open(st, head, next);
    if (run < 0) continue;
    st.visited[next] = 1;
    path.push(next);
    block(st, run);
    walk(st, s);
    unblock(st, run);
    path.pop();
    st.visited[next] = 0;
    if (st.solutions.length >= st.cap) return;
    // Running out of budget mid-loop means the rest of this subtree was never
    // looked at. Without saying so here, the search can unwind all the way out
    // and report a finished, exhaustive answer for a walk it abandoned — and a
    // board would ship whose second answer simply had not been reached yet.
    if (st.nodes >= st.maxNodes) { st.exhausted = true; return; }
  }
}

/** Begin strand `s` at its pinned start, or at every post in turn. */
function startStrand(st: State, s: number): void {
  const spec = st.c.board.strands[s];
  if (spec.from >= 0) {
    if (st.visited[spec.from]) return;
    st.visited[spec.from] = 1;
    st.paths[s] = [spec.from];
    walk(st, s);
    st.paths[s] = [];
    st.visited[spec.from] = 0;
    return;
  }
  for (let p = 0; p < st.c.n; p++) {
    if (st.visited[p]) continue;
    st.visited[p] = 1;
    st.paths[s] = [p];
    walk(st, s);
    st.paths[s] = [];
    st.visited[p] = 0;
    if (st.solutions.length >= st.cap) return;
    if (st.nodes >= st.maxNodes) { st.exhausted = true; return; }
  }
}

/**
 * Search the board. `cap` stops once that many answers are found — pass 2 to
 * ask "is it unique?", which is the only question generation needs.
 */
export function search(c: Compiled, cap = 2, maxNodes = DEFAULT_NODES): SearchResult {
  const st: State = {
    c,
    visited: new Uint8Array(c.n),
    blocked: new Int32Array(c.runs.length),
    paths: c.board.strands.map(() => [] as number[]),
    solutions: [],
    cap,
    maxNodes,
    nodes: 0,
    exhausted: false,
    queue: new Int32Array(c.n),
    region: new Int32Array(c.n),
    reached: new Uint8Array(c.n + 1),
  };
  if (c.n > 0) startStrand(st, 0);
  return { solutions: st.solutions, nodes: st.nodes, exhausted: st.exhausted };
}

/** True when the board has exactly one answer and the search finished. */
export function isUnique(c: Compiled, maxNodes = DEFAULT_NODES): boolean {
  const r = search(c, 2, maxNodes);
  return !r.exhausted && r.solutions.length === 1;
}
