/**
 * Hexagony's solver, and its measure of how hard a board is to think about.
 *
 * The puzzle is an assignment: every tile goes to exactly one space and every
 * space takes exactly one tile, subject to the touching pairs agreeing. So the
 * search places tiles into spaces, and the order it fills them in is what
 * makes it fast — always the space with the most neighbours already filled,
 * because that is the space with the fewest tiles that could possibly go
 * there.
 *
 * `analyse` plays the deduction instead: work out which tiles could still go
 * in which spaces, cross out the ones the neighbours rule out, repeat. That is
 * what a person does — "this tile has a five on its west face, and only two
 * spaces want a five on the west" — and it is what the ladder is ordered by.
 */

import { agree, neighboursOf, joinsOf, type Hex } from './model.js';

export type Found = {
  readonly count: number;
  readonly first: number[] | null;
  readonly nodes: number;
  /** True when the search finished rather than running out of budget. */
  readonly exhausted: boolean;
};

/** One answer, and the search proved it. Never "one so far". */
export function isUnique(found: Found): boolean {
  return found.count === 1 && found.exhausted;
}

/**
 * Every way of filling the board, up to `limit`.
 *
 * Spaces are taken in a fixed order chosen up front: start at the space with
 * the most neighbours, then always take the space that touches the most spaces
 * already chosen. Fixing the order once rather than choosing dynamically keeps
 * the search simple, and for these boards the difference does not show.
 */
export function search(hex: Hex, limit = 2, budget = 2_000_000): Found {
  const n = hex.cells.length;
  const near = neighboursOf(hex);

  const order: number[] = [];
  const taken = new Uint8Array(n);
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (taken[i]) continue;
      let score = near[i].filter((x) => taken[x.at]).length * 100 + near[i].length;
      if (step === 0) score = near[i].length;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    taken[best] = 1;
    order.push(best);
  }

  /** For each space in `order`, the neighbours already placed by then. */
  const before: { at: number; dir: number }[][] = [];
  const placedBy = new Uint8Array(n);
  for (const at of order) {
    before.push(near[at].filter((x) => placedBy[x.at]));
    placedBy[at] = 1;
  }

  const placed = new Array<number>(n).fill(-1);
  const used = new Uint8Array(hex.tiles.length);
  let count = 0;
  let nodes = 0;
  let cutOff = false;
  let first: number[] | null = null;

  const go = (step: number): void => {
    if (count >= limit) return;
    if (nodes > budget) { cutOff = true; return; }
    if (step === n) {
      count++;
      if (!first) first = placed.slice();
      return;
    }
    const at = order[step];
    for (let t = 0; t < hex.tiles.length; t++) {
      if (used[t]) continue;
      nodes++;
      let ok = true;
      for (const nb of before[step]) {
        if (!agree(hex.tiles, t, placed[nb.at], nb.dir)) { ok = false; break; }
      }
      if (!ok) continue;
      used[t] = 1;
      placed[at] = t;
      go(step + 1);
      placed[at] = -1;
      used[t] = 0;
      if (count >= limit) return;
      if (nodes > budget) { cutOff = true; return; }
    }
  };

  go(0);
  return { count, first, nodes, exhausted: !cutOff };
}

// ---------------------------------------------------------------------------
// How hard it is to think about
// ---------------------------------------------------------------------------

export type Reading = {
  /** True when crossing out alone finishes the board. */
  readonly byReason: boolean;
  readonly rounds: number;
  /** Tiles still possible in the tightest space at the start. */
  readonly entry: number;
  /** Tile-and-space pairs still possible at the start, over the whole board. */
  readonly opening: number;
  /** Spaces still undecided when crossing out ran out of things to say. */
  readonly stuck: number;
};

/**
 * Play the deduction.
 *
 * Three rules, and they are the three a person uses:
 *
 *   - a tile can go in a space only if, for every neighbouring space, SOME
 *     other tile that could go there agrees with it across the join;
 *   - a space that only one tile fits has that tile;
 *   - a tile that fits only one space belongs there, and nowhere else.
 *
 * Repeat until nothing changes. The first rule is the interesting one: it is
 * not "does this tile match its neighbour", because there is no neighbour yet
 * — it is "could this tile ever have a neighbour here", which is the thing you
 * actually reason about with a handful of tiles in your palm.
 */
export function analyse(hex: Hex): Reading {
  const n = hex.cells.length;
  const near = neighboursOf(hex);
  const cand: Set<number>[] = hex.cells.map(() => new Set(hex.tiles.map((_, t) => t)));

  const opening = cand.reduce((s, c) => s + c.size, 0);
  const entry = cand.reduce((m, c) => Math.min(m, c.size), Infinity);

  const supported = (): boolean => {
    let changed = false;
    for (let at = 0; at < n; at++) {
      for (const t of [...cand[at]]) {
        let ok = true;
        for (const nb of near[at]) {
          let any = false;
          for (const u of cand[nb.at]) {
            if (u === t) continue;
            if (agree(hex.tiles, t, u, nb.dir)) { any = true; break; }
          }
          if (!any) { ok = false; break; }
        }
        if (!ok) { cand[at].delete(t); changed = true; }
      }
    }
    return changed;
  };

  const settle = (): boolean => {
    let changed = false;
    /* A space with one tile takes it, and no other space may have it. */
    for (let at = 0; at < n; at++) {
      if (cand[at].size !== 1) continue;
      const [t] = [...cand[at]];
      for (let k = 0; k < n; k++) if (k !== at && cand[k].delete(t)) changed = true;
    }
    /* A tile that fits only one space belongs there. */
    for (let t = 0; t < hex.tiles.length; t++) {
      const homes: number[] = [];
      for (let at = 0; at < n; at++) if (cand[at].has(t)) homes.push(at);
      if (homes.length === 1 && cand[homes[0]].size > 1) {
        cand[homes[0]] = new Set([t]);
        changed = true;
      }
    }
    return changed;
  };

  let rounds = 0;
  for (;;) {
    rounds++;
    const moved = supported() || settle();
    if (!moved || rounds > 60) break;
  }

  let stuck = 0;
  for (let at = 0; at < n; at++) if (cand[at].size !== 1) stuck++;

  return {
    byReason: stuck === 0,
    rounds,
    entry: entry === Infinity ? 0 : entry,
    opening,
    stuck,
  };
}

/** How many joins the board has. Used by the designer to reject thin layouts. */
export function joinCount(hex: Hex): number {
  return joinsOf(hex).length;
}
