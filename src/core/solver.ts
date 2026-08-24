/**
 * Cycle search over the pegboard. Powers three things: the level gate's
 * uniqueness and optimality checks, the static difficulty estimator, and the
 * generators (which propose a shape and then ask whether it is a fair puzzle).
 */

import type { Pt } from './geometry.js';
import { makeRaster, rasterizeLoop, similarity, type Raster } from './region.js';
import { type Level, cycleLength, effectiveLoop, isPortalEdge } from './level.js';
import { canAdd, canClose, initialState, type PlayState } from './rules.js';

export type SearchOpts = {
  /** Longest cycle to consider, in pegs. */
  maxLen?: number;
  /**
   * Longest cycle to consider, in board-space length. This is the prune that
   * makes the search tractable: any partial path already longer than the
   * intended solution — plus the cost of getting home, by the triangle
   * inequality — can never become a shorter answer, so it is abandoned.
   */
  maxLength?: number;
  /** Wall-clock budget in ms. The gate gives each level 2 s. */
  budgetMs?: number;
  /** How many times one peg may appear — 2 lets keyhole solutions be found. */
  maxVisits?: number;
  /**
   * Total extra visits allowed across the whole cycle. A keyhole revisits two
   * pegs, not every peg, so bounding the repeats rather than only the
   * per-peg limit cuts the search space by orders of magnitude.
   */
  maxRepeats?: number;
  /** Stop once this many matches are found. */
  limit?: number;
  /** Region match tolerance. */
  tolerance?: number;
  now?: () => number;
};

export type Match = {
  sol: number[];
  length: number;
  similarity: number;
};

export type SearchResult = {
  matches: Match[];
  /** Cycles examined — a rough proxy for how big the space really is. */
  examined: number;
  exhausted: boolean;
};

/**
 * Canonical form of a cycle: rotate so the smallest peg leads, then take the
 * lexicographically smaller of the two directions. Two threadings that draw
 * the same picture collapse to one key.
 */
export function canonicalCycle(sol: readonly number[]): string {
  const n = sol.length;
  let best: number[] | null = null;
  for (const seq of [sol, [...sol].reverse()]) {
    for (let r = 0; r < n; r++) {
      const rot: number[] = [];
      for (let i = 0; i < n; i++) rot.push(seq[(r + i) % n]);
      if (best === null || less(rot, best)) best = rot;
    }
  }
  return best!.join(',');
}

function less(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

const searchRaster = makeRaster();

/** Every legal cycle whose region matches `target` within tolerance. */
export function findMatchingCycles(
  level: Level,
  target: Raster,
  opts: SearchOpts = {},
): SearchResult {
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + (opts.budgetMs ?? 2000);
  const maxLen = opts.maxLen ?? Math.min(level.pegs.length + 2, 12);
  const maxLength = opts.maxLength ?? Infinity;
  const maxVisits = opts.maxVisits ?? 1;
  const maxRepeats = opts.maxRepeats ?? (maxVisits > 1 ? 2 : 0);
  const limit = opts.limit ?? 64;
  const tol = opts.tolerance ?? 0.995;

  const matches: Match[] = [];
  const seen = new Set<string>();
  let examined = 0;
  let exhausted = true;
  const n = level.pegs.length;
  const visits = new Int8Array(n);
  const state: PlayState = initialState(level);
  state.active = 0;
  const path = state.threads[0].pegs;
  let openLength = 0;
  let repeats = 0;

  const edge = (a: number, b: number): number =>
    isPortalEdge(level, a, b)
      ? 0
      : Math.hypot(level.pegs[a][0] - level.pegs[b][0], level.pegs[a][1] - level.pegs[b][1]);

  const consider = (start: number) => {
    if (path.length < 3) return;
    const total = openLength + edge(path[path.length - 1], start);
    if (total > maxLength + 1e-6) return;
    if (!canClose(level, state).ok) return;
    examined++;
    const key = canonicalCycle(path);
    if (seen.has(key)) return;
    seen.add(key);
    searchRaster.fill(0);
    const pts: Pt[] = effectiveLoop(level, path.map((i) => level.pegs[i] as Pt));
    rasterizeLoop(pts, 1, searchRaster);
    const sim = similarity(searchRaster, target);
    if (sim >= tol) {
      matches.push({ sol: [...path], length: cycleLength(level, path), similarity: sim });
    }
  };

  const dfs = (start: number): boolean => {
    if (now() > deadline) {
      exhausted = false;
      return false;
    }
    if (matches.length >= limit) return false;
    consider(start);
    if (path.length >= maxLen) return true;
    const last = path[path.length - 1];

    // Try the nearest legal peg first. A taut string that makes a clean shape
    // almost always steps to a near neighbour, so nearest-first finds the
    // real answers early and the length bound then prunes the rest.
    const order: number[] = [];
    for (let p = start; p < n; p++) {
      if (visits[p] >= maxVisits) continue;
      if (visits[p] >= 1 && repeats >= maxRepeats) continue;
      order.push(p);
    }
    for (let a = 1; a < order.length; a++) {
      const v = order[a];
      const d = edge(last, v);
      let b = a - 1;
      while (b >= 0 && edge(last, order[b]) > d) {
        order[b + 1] = order[b];
        b--;
      }
      order[b + 1] = v;
    }

    for (const p of order) {
      const step = edge(last, p);
      // Lower bound on any cycle through this partial path: what it has cost
      // so far, plus this step, plus the direct journey home.
      if (openLength + step + edge(p, start) > maxLength + 1e-6) continue;
      if (!canAdd(level, state, p).ok) continue;
      const isRepeat = visits[p] >= 1;
      visits[p]++;
      if (isRepeat) repeats++;
      path.push(p);
      openLength += step;
      const cont = dfs(start);
      openLength -= step;
      path.pop();
      visits[p]--;
      if (isRepeat) repeats--;
      if (!cont) return false;
    }
    return true;
  };

  for (let s = 0; s < n; s++) {
    // Canonicalisation puts the smallest peg first, so only start there.
    visits[s]++;
    path.push(s);
    openLength = 0;
    repeats = 0;
    const cont = dfs(s);
    path.pop();
    visits[s]--;
    if (!cont) break;
  }
  matches.sort((a, b) => a.length - b.length);
  return { matches, examined, exhausted };
}

/** Shortest legal cycle matching the target, if the search finds one. */
export function shortestMatch(level: Level, target: Raster, opts: SearchOpts = {}): Match | null {
  const r = findMatchingCycles(level, target, opts);
  return r.matches[0] ?? null;
}

/**
 * Every plausible mistake a player could make near the intended solution:
 * drop one peg, swap two adjacent pegs, or substitute each peg for each unused
 * one. If any of these scores above the win threshold the level is unfair —
 * this is the check that catches "a hexagonal hole and a pentagonal hole read
 * as the same shape".
 */
export function nearMisses(level: Level, sol: readonly number[]): number[][] {
  const out: number[][] = [];
  const n = sol.length;
  const all = level.pegs.map((_, i) => i);
  const used = new Set(sol);
  const unused = all.filter((i) => !used.has(i));
  const push = (c: number[]) => {
    if (c.length < 3) return;
    for (let i = 0; i < c.length; i++) if (c[i] === c[(i + 1) % c.length]) return;
    if (canonicalCycle(c) === canonicalCycle(sol)) return;
    out.push(c);
  };

  for (let i = 0; i < n; i++) push(sol.filter((_, k) => k !== i));
  for (let i = 0; i < n; i++) {
    const c = [...sol];
    const j = (i + 1) % n;
    [c[i], c[j]] = [c[j], c[i]];
    push(c);
  }
  for (let i = 0; i < n; i++) {
    for (const u of unused) {
      const c = [...sol];
      c[i] = u;
      push(c);
    }
  }
  // Also: one extra peg inserted anywhere — players overshoot as often as they undershoot.
  for (let i = 0; i < n; i++) {
    for (const u of unused) {
      const c = [...sol];
      c.splice(i, 0, u);
      push(c);
    }
  }
  return out;
}

/** Highest similarity reached by any near-miss. Must stay under the threshold. */
export function worstNearMiss(
  level: Level,
  sol: readonly number[],
  target: Raster,
): { sim: number; sol: number[] | null } {
  let worst = 0;
  let which: number[] | null = null;
  for (const c of nearMisses(level, sol)) {
    searchRaster.fill(0);
    rasterizeLoop(effectiveLoop(level, c.map((i) => level.pegs[i] as Pt)), 1, searchRaster);
    const s = similarity(searchRaster, target);
    if (s > worst) {
      worst = s;
      which = c;
    }
  }
  return { sim: worst, sol: which };
}

/**
 * Would a player who simply walks to the nearest legal unvisited peg find it?
 * If yes, the level is easy — that is a real signal for the difficulty model.
 */
export function greedySolves(level: Level, target: Raster, tol = 0.995): boolean {
  const n = level.pegs.length;
  for (let start = 0; start < n; start++) {
    const state = initialState(level);
    state.active = 0;
    const path = state.threads[0].pegs;
    path.push(start);
    const visited = new Set<number>([start]);
    for (let step = 0; step < n; step++) {
      let best = -1;
      let bestD = Infinity;
      const from = level.pegs[path[path.length - 1]] as Pt;
      for (let p = 0; p < n; p++) {
        if (visited.has(p)) continue;
        if (!canAdd(level, state, p).ok) continue;
        const d = Math.hypot(from[0] - level.pegs[p][0], from[1] - level.pegs[p][1]);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best < 0) break;
      visited.add(best);
      path.push(best);
      if (path.length >= 3 && canClose(level, state).ok) {
        searchRaster.fill(0);
        rasterizeLoop(effectiveLoop(level, path.map((i) => level.pegs[i] as Pt)), 1, searchRaster);
        if (similarity(searchRaster, target) >= tol) return true;
      }
    }
  }
  return false;
}

/** Average number of legal continuations along the solution path. */
export function branchingFactor(level: Level, sol: readonly number[]): number {
  const state = initialState(level);
  state.active = 0;
  const path = state.threads[0].pegs;
  let total = 0;
  let steps = 0;
  for (const p of sol) {
    if (path.length > 0) {
      let legal = 0;
      for (let q = 0; q < level.pegs.length; q++) if (canAdd(level, state, q).ok) legal++;
      total += legal;
      steps++;
    }
    path.push(p);
  }
  return steps === 0 ? 0 : total / steps;
}

/** How many distinct near-miss shapes score above 0.9 — the decoy count. */
export function decoyCount(level: Level, sol: readonly number[], target: Raster): number {
  let n = 0;
  for (const c of nearMisses(level, sol)) {
    searchRaster.fill(0);
    rasterizeLoop(effectiveLoop(level, c.map((i) => level.pegs[i] as Pt)), 1, searchRaster);
    if (similarity(searchRaster, target) > 0.9) n++;
  }
  return n;
}
