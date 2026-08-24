/**
 * Legality. Every mechanic that constrains play is decided here, in pure TS,
 * so the game, the solver, the level gate and the tests all agree on what is
 * legal — there is exactly one implementation of the rules.
 */

import type { Pt } from './geometry.js';
import {
  segmentsCross, pointSegmentDistance, segmentHitsDisc, dist,
  selfCrossings, mutualCrossings,
} from './geometry.js';
import { type Level, isPortalEdge, cycleLength } from './level.js';
import { makeRaster, rasterizeLoop, similarity, type Raster } from './region.js';

/** A correct solve scores exactly 1.000; the gate proves no near-miss reaches this. */
export const WIN_THRESHOLD = 0.995;

/** How close a segment may pass to a thorn peg before it pops the string. */
export const THORN_RADIUS = 2.2;

export type ThreadState = {
  /** Peg indices in the order they were threaded. */
  pegs: number[];
  closed: boolean;
};

export type PlayState = {
  threads: ThreadState[];
  active: number;
  /** Board-space overrides for pegs sitting on rails. */
  railPos: Record<number, [number, number]>;
};

export function initialState(level: Level): PlayState {
  return {
    threads: level.threads.map(() => ({ pegs: [], closed: false })),
    active: 0,
    railPos: {},
  };
}

/** Where a peg actually is, honouring any rail the player has slid it along. */
export function pegPos(level: Level, state: PlayState, i: number): Pt {
  return (state.railPos[i] ?? level.pegs[i]) as Pt;
}

export function threadPoints(level: Level, state: PlayState, t: number): Pt[] {
  return state.threads[t].pegs.map((i) => pegPos(level, state, i));
}

export type Reject =
  | 'ok'
  | 'thorn-peg'
  | 'thorn-contact'
  | 'post-blocked'
  | 'self-cross'
  | 'thread-cross'
  | 'over-budget'
  | 'repeat-peg'
  | 'too-short'
  | 'no-such-peg';

export type Verdict = { ok: boolean; reason: Reject };

const OK: Verdict = { ok: true, reason: 'ok' };
const no = (reason: Reject): Verdict => ({ ok: false, reason });

/** Human-readable reason, for the toast. */
export const REJECT_TEXT: Record<Reject, string> = {
  'ok': '',
  'thorn-peg': 'Thorns pop the string',
  'thorn-contact': 'Too close to a thorn',
  'post-blocked': 'A post is in the way',
  'self-cross': 'The string may not cross itself here',
  'thread-cross': 'These threads must stay apart',
  'over-budget': 'Not enough string',
  'repeat-peg': "You're already there",
  'too-short': 'A loop needs three pegs',
  'no-such-peg': '',
};

/** Would the segment a->b be blocked by a post or graze a thorn? */
export function segmentBlocked(level: Level, state: PlayState, a: Pt, b: Pt): Reject {
  if (level.posts) {
    for (const [px, py, r] of level.posts) {
      if (segmentHitsDisc(a, b, [px, py], r)) return 'post-blocked';
    }
  }
  if (level.thorn) {
    for (const ti of level.thorn) {
      const p = pegPos(level, state, ti);
      // Endpoints are pegs the string legitimately sits on; only the span matters.
      if (dist(p, a) < 1e-6 || dist(p, b) < 1e-6) continue;
      if (pointSegmentDistance(p, a, b) < THORN_RADIUS) return 'thorn-contact';
    }
  }
  return 'ok';
}

/** Total string used so far by every thread, portal hops free. */
export function lengthUsed(level: Level, state: PlayState, includeClosing = true): number {
  let total = 0;
  for (let t = 0; t < state.threads.length; t++) {
    const st = state.threads[t];
    const closed = st.closed && includeClosing;
    total += openLength(level, state, st.pegs, closed);
  }
  return total;
}

function openLength(level: Level, state: PlayState, pegs: number[], closed: boolean): number {
  let total = 0;
  const n = pegs.length;
  const stop = closed ? n : n - 1;
  for (let i = 0; i < stop; i++) {
    const a = pegs[i];
    const b = pegs[(i + 1) % n];
    if (isPortalEdge(level, a, b)) continue;
    total += dist(pegPos(level, state, a), pegPos(level, state, b));
  }
  return total;
}

/** May the active thread be extended to `peg`? */
export function canAdd(level: Level, state: PlayState, peg: number): Verdict {
  if (peg < 0 || peg >= level.pegs.length) return no('no-such-peg');
  const t = state.active;
  const st = state.threads[t];
  if (st.closed) return no('no-such-peg');
  if (level.thorn?.includes(peg)) return no('thorn-peg');

  const pegs = st.pegs;
  if (pegs.length === 0) return OK;
  const last = pegs[pegs.length - 1];
  if (last === peg) return no('repeat-peg');

  const a = pegPos(level, state, last);
  const b = pegPos(level, state, peg);

  const blocked = segmentBlocked(level, state, a, b);
  if (blocked !== 'ok') return no(blocked);

  if (!level.allowCross) {
    // Existing segments of this thread, excluding the one that shares `last`.
    for (let i = 0; i + 1 < pegs.length - 1; i++) {
      const c = pegPos(level, state, pegs[i]);
      const d = pegPos(level, state, pegs[i + 1]);
      if (segmentsCross(a, b, c, d)) return no('self-cross');
    }
  }
  if (level.apart) {
    for (let o = 0; o < state.threads.length; o++) {
      if (o === t) continue;
      const other = state.threads[o];
      const n = other.pegs.length;
      const stop = other.closed ? n : n - 1;
      for (let i = 0; i < stop; i++) {
        const c = pegPos(level, state, other.pegs[i]);
        const d = pegPos(level, state, other.pegs[(i + 1) % n]);
        if (segmentsCross(a, b, c, d)) return no('thread-cross');
      }
    }
  }
  if (level.budget !== undefined) {
    const added = isPortalEdge(level, last, peg) ? 0 : dist(a, b);
    if (lengthUsed(level, state) + added > level.budget + 1e-6) return no('over-budget');
  }
  return OK;
}

/** May the active thread be tied off where it stands? */
export function canClose(level: Level, state: PlayState): Verdict {
  const t = state.active;
  const st = state.threads[t];
  if (st.closed) return no('no-such-peg');
  const pegs = st.pegs;
  if (pegs.length < 3) return no('too-short');

  const last = pegs[pegs.length - 1];
  const first = pegs[0];
  if (last === first) {
    // The player walked all the way back onto the start peg. The polygon is
    // already closed at that vertex, so there is no closing edge to check —
    // just a duplicate to drop. Dragging round and back is far too natural a
    // gesture to leave in a dead state.
    return pegs.length >= 4 ? OK : no('too-short');
  }

  const a = pegPos(level, state, last);
  const b = pegPos(level, state, first);
  const blocked = segmentBlocked(level, state, a, b);
  if (blocked !== 'ok') return no(blocked);

  if (!level.allowCross) {
    for (let i = 1; i + 1 < pegs.length - 1; i++) {
      const c = pegPos(level, state, pegs[i]);
      const d = pegPos(level, state, pegs[i + 1]);
      if (segmentsCross(a, b, c, d)) return no('self-cross');
    }
  }
  if (level.apart) {
    for (let o = 0; o < state.threads.length; o++) {
      if (o === t) continue;
      const other = state.threads[o];
      const n = other.pegs.length;
      const stop = other.closed ? n : n - 1;
      for (let i = 0; i < stop; i++) {
        const c = pegPos(level, state, other.pegs[i]);
        const d = pegPos(level, state, other.pegs[(i + 1) % n]);
        if (segmentsCross(a, b, c, d)) return no('thread-cross');
      }
    }
  }
  if (level.budget !== undefined) {
    const added = isPortalEdge(level, last, first) ? 0 : dist(a, b);
    if (lengthUsed(level, state) + added > level.budget + 1e-6) return no('over-budget');
  }
  return OK;
}

/** Drop a trailing duplicate of the start peg, once the loop is tied. */
export function normalizeClosedPath(pegs: number[]): number[] {
  if (pegs.length >= 4 && pegs[0] === pegs[pegs.length - 1]) return pegs.slice(0, -1);
  return pegs;
}

/**
 * Whether closing at the START peg should tie the loop automatically.
 * On crossing levels the solution often revisits the start mid-loop — that is
 * how a keyhole is cut — so start-peg-tap must not auto-close there.
 */
export function startTapCloses(level: Level): boolean {
  return !level.allowCross;
}

// ---------------------------------------------------------------------------
// Weave
// ---------------------------------------------------------------------------

export type CrossingRef = {
  /** thread index and segment index of the two strands, canonically ordered */
  ta: number; sa: number; tb: number; sb: number;
  point: Pt;
};

/**
 * Every crossing on the board, in a canonical order that does not depend on
 * the order the player threaded the pegs. Two solutions that draw the same
 * picture therefore produce the same crossing list.
 */
export function allCrossings(loops: ReadonlyArray<readonly Pt[]>): CrossingRef[] {
  const out: CrossingRef[] = [];
  for (let t = 0; t < loops.length; t++) {
    for (const x of selfCrossings(loops[t], true)) {
      out.push({ ta: t, sa: x.i, tb: t, sb: x.j, point: x.point });
    }
    for (let u = t + 1; u < loops.length; u++) {
      for (const x of mutualCrossings(loops[t], loops[u], true, true)) {
        out.push({ ta: t, sa: x.i, tb: u, sb: x.j, point: x.point });
      }
    }
  }
  out.sort((p, q) =>
    p.point[1] - q.point[1] || p.point[0] - q.point[0] || p.ta - q.ta || p.tb - q.tb,
  );
  return out;
}

/**
 * '1' where the first strand of the crossing passes over. On weave levels the
 * target shows the weave, so this string must match as well as the region.
 */
export function weaveSignature(crossings: CrossingRef[], over: ReadonlySet<number>): string {
  let s = '';
  for (let i = 0; i < crossings.length; i++) s += over.has(i) ? '1' : '0';
  return s;
}

export function solutionWeaveSet(level: Level): Set<number> {
  const set = new Set<number>();
  level.threads.forEach((t) => t.over?.forEach((i) => set.add(i)));
  return set;
}

// ---------------------------------------------------------------------------
// Scoring a closed attempt
// ---------------------------------------------------------------------------

export type Evaluation = {
  win: boolean;
  similarity: number;
  raster: Raster;
  /** Why it was not a win, when it was not. */
  fault: 'none' | 'shape' | 'gold' | 'weave' | 'budget' | 'incomplete';
  lengthUsed: number;
};

const evalRaster = makeRaster();

/** Score every closed thread against the target. */
export function evaluate(
  level: Level,
  state: PlayState,
  target: Raster,
  overSet: ReadonlySet<number> = new Set(),
): Evaluation {
  const used = lengthUsed(level, state);
  const allClosed = state.threads.every((t) => t.closed && t.pegs.length >= 3);
  evalRaster.fill(0);
  const loops: Pt[][] = [];
  for (let t = 0; t < state.threads.length; t++) {
    const pts = threadPoints(level, state, t);
    loops.push(pts);
    if (state.threads[t].closed && pts.length >= 3) rasterizeLoop(pts, 1 << t, evalRaster);
  }
  const sim = similarity(evalRaster, target);

  if (!allClosed) {
    return { win: false, similarity: sim, raster: evalRaster, fault: 'incomplete', lengthUsed: used };
  }
  if (level.budget !== undefined && used > level.budget + 1e-6) {
    return { win: false, similarity: sim, raster: evalRaster, fault: 'budget', lengthUsed: used };
  }
  if (level.gold?.length) {
    const on = new Set(state.threads.flatMap((t) => t.pegs));
    for (const g of level.gold) {
      if (!on.has(g)) {
        return { win: false, similarity: sim, raster: evalRaster, fault: 'gold', lengthUsed: used };
      }
    }
  }
  if (sim < WIN_THRESHOLD) {
    return { win: false, similarity: sim, raster: evalRaster, fault: 'shape', lengthUsed: used };
  }
  if (level.weave) {
    const want = weaveSignature(allCrossings(level.threads.map((t) => t.sol.map((i) => level.pegs[i] as Pt))), solutionWeaveSet(level));
    const got = weaveSignature(allCrossings(loops), overSet);
    if (want !== got) {
      return { win: false, similarity: sim, raster: evalRaster, fault: 'weave', lengthUsed: used };
    }
  }
  return { win: true, similarity: sim, raster: evalRaster, fault: 'none', lengthUsed: used };
}

/** Is this peg cycle legal end-to-end? Used by the solver and the level gate. */
export function cycleLegal(level: Level, sol: readonly number[], threadIndex = 0): boolean {
  const state = initialState(level);
  state.active = threadIndex;
  for (const p of sol) {
    const v = canAdd(level, state, p);
    if (!v.ok) return false;
    state.threads[threadIndex].pegs.push(p);
  }
  const c = canClose(level, state);
  if (!c.ok) return false;
  if (level.budget !== undefined && cycleLength(level, sol) > level.budget + 1e-6) return false;
  return true;
}
