/**
 * The level designers.
 *
 * Each chapter introduces exactly ONE new idea and then exhausts it. A
 * designer proposes candidates from a family of shapes; the six-check gate
 * disposes of the ones that do not earn their place. Nothing is accepted that
 * repeats an earlier level's mechanic tuple, topology and silhouette.
 */

import type { Pt } from './geometry.js';
import { pointSegmentDistance, segmentHitsDisc, dist, selfCrossings, mutualCrossings } from './geometry.js';
import type { Level, ThreadSpec } from './level.js';
import { cycleLength } from './level.js';
import { THORN_RADIUS, allCrossings } from './rules.js';
import type { Rng } from './rng.js';
import { THREAD_COLORS } from '../render/theme.js';
import {
  ringPoints, ovalPoints, starPoints, starOrder, rect, lShape, plusShape, chevron,
  arrow, house, trapezoid, staircase, comb, bowtie, propeller, donutOrder, band,
  rotateAll, scaleAll, fitToBoard, quantize, scatterDecoys, edgeDecoys, minSeparation,
} from './shapes.js';

export type Body = Omit<Level, 'id' | 'mode' | 'chapter'>;
export type Maker = (rng: Rng, i: number) => Body | null;
export type ChapterSpec = { chapter: number; name: string; idea: string; count: number; make: Maker };

const C = THREAD_COLORS;

/**
 * A peg lying on a solution edge gets picked up by a drag along that edge, so
 * the obvious gesture quietly produces a different loop from the one it looks
 * like. Every maker funnels through here, so this is where it is caught.
 */
const SNAG_CLEARANCE = 4.6;

function hasSnag(
  pegs: ReadonlyArray<readonly number[]>,
  sols: number[][],
  /** Portal hops are teleports, so nothing travels along them. */
  portals: Array<[number, number]> = [],
): boolean {
  const isPortal = (a: number, b: number) =>
    portals.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  for (const sol of sols) {
    for (let i = 0; i < sol.length; i++) {
      const from = sol[i];
      const to = sol[(i + 1) % sol.length];
      if (from === to) continue;
      if (isPortal(from, to)) continue;
      const a = pegs[from] as Pt;
      const b = pegs[to] as Pt;
      for (let p = 0; p < pegs.length; p++) {
        if (p === from || p === to) continue;
        if (pointSegmentDistance(pegs[p] as Pt, a, b) < SNAG_CLEARANCE) return true;
      }
    }
  }
  return false;
}

/** Assemble a level body from solution points plus decoys. */
function body(loop: Pt[], decoys: Pt[], extra: Partial<Body> = {}, order?: number[]): Body | null {
  const pegs = quantize([...loop, ...decoys]);
  if (minSeparation(pegs as unknown as Pt[]) < 7) return null; // pegs too close to tell apart
  for (const [x, y] of pegs) if (x < 4 || x > 96 || y < 4 || y > 96) return null;
  const sol = order ?? loop.map((_, i) => i);
  if (hasSnag(pegs, [sol], extra.portals as Array<[number, number]> | undefined)) return null;
  const threads: ThreadSpec[] = [{ color: C[0], sol }];
  return { pegs, threads, ...extra };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A loop, fitted to the board with a healthy margin. */
function fit(pts: Pt[], margin = 14): Pt[] {
  return fitToBoard(pts, margin);
}

// ---------------------------------------------------------------------------
// Chapter 1 — Loops. Taut string; close the loop; match the shape.
// ---------------------------------------------------------------------------

const SIMPLE_FAMILIES: Array<(rng: Rng, i: number) => Pt[]> = [
  (r) => ringPoints(3 + r.int(3), 30 + r.range(0, 6), r.range(0, 1)),
  (r) => ovalPoints(5 + r.int(4), 34, 22, r.range(0, 1)),
  (r) => rect(40 + r.range(0, 20), 28 + r.range(0, 22)),
  (r) => lShape(56, 18 + r.range(0, 8), r.int(4) as 0 | 1 | 2 | 3),
  (r) => plusShape(58, 20 + r.range(0, 8)),
  (r) => chevron(58, 40, 12 + r.range(0, 6)),
  (r) => arrow(48, 54 + r.range(0, 8)),
  (r) => house(48 + r.range(0, 10), 48),
  (r) => trapezoid(24 + r.range(0, 10), 52, 38),
  (r) => staircase(2 + r.int(3), 48),
  (r) => comb(2 + r.int(3), 56, 40, 14 + r.range(0, 8)),
  (r) => rotateAll(ringPoints(6 + r.int(3), 32), r.range(0, 1)),
];

const chapter1: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0));
  if (loop.length < 3 || loop.length > 12) return null;
  const decoys = scatterDecoys(rng, loop, 2 + rng.int(5), 12, loop, 70);
  return body(loop, decoys);
};

// ---------------------------------------------------------------------------
// Chapter 2 — Tight. A length budget: the spool.
// ---------------------------------------------------------------------------

const chapter2: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0), 18);
  if (loop.length < 4 || loop.length > 8) return null;

  // Decoys sit just outside the edges: the tempting detour that costs string.
  // Only long edges get one, so the detour is a visible bulge rather than a
  // sliver, and the peg does not crowd the vertices it sits between.
  const detours: Pt[] = [];
  const costs: number[] = [];
  const cx = loop.reduce((t, p) => t + p[0], 0) / loop.length;
  const cy = loop.reduce((t, p) => t + p[1], 0) / loop.length;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const edgeLen = dist(a, b);
    if (edgeLen < 20) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    const out = 6.5 + rng.range(0, 3);
    const p: Pt = [mx + (dx / len) * out, my + (dy / len) * out];
    if (p[0] < 8 || p[0] > 92 || p[1] < 8 || p[1] > 92) continue;
    detours.push(p);
    costs.push(dist(a, p) + dist(p, b) - edgeLen);
  }
  if (detours.length === 0) return null;

  // The budget sits between the solution and the cheapest possible detour, so
  // ANY detour busts the spool. That is what makes the mechanic load-bearing
  // rather than decorative.
  const par = polyLength(loop);
  const cheapest = Math.min(...costs);
  const budget = round1(par + cheapest * 0.55);
  return body(loop, detours, { budget });
};

function polyLength(pts: Pt[]): number {
  let n = 0;
  for (let i = 0; i < pts.length; i++) n += dist(pts[i], pts[(i + 1) % pts.length]);
  return n;
}

// ---------------------------------------------------------------------------
// Chapter 3 — Crossings. Even-odd: crossing the string flips inside to outside.
// ---------------------------------------------------------------------------

const chapter3: Maker = (rng) => {
  const kind = rng.int(4);
  let loop: Pt[];
  if (kind === 0) {
    // A star polygon {n/k}. The whole chapter in one construction.
    const n = [5, 7, 7, 8, 9, 9, 11, 11][rng.int(8)];
    const ks = [2, 3, 4, 5].filter((k) => k < n / 2 && gcd(n, k) === 1);
    const k = ks[rng.int(ks.length)];
    loop = fit(starPoints(n, k, 34, rng.range(0, 0.6)));
  } else if (kind === 1) {
    loop = fit(bowtie(52 + rng.range(0, 12), 40 + rng.range(0, 14)));
  } else if (kind === 2) {
    loop = fit(propeller(3 + rng.int(2), 34, 13 + rng.range(0, 6)));
  } else {
    // An hourglass: a ring re-ordered so one pair of edges crosses.
    const n = 6 + rng.int(3);
    const ring = ringPoints(n, 33, rng.range(0, 0.5));
    const order = ring.map((_, i) => i);
    const a = 1 + rng.int(n - 2);
    [order[a], order[a + 1]] = [order[a + 1], order[a]];
    loop = fit(order.map((i) => ring[i]));
  }
  if (selfCrossings(loop, true).length === 0) return null;
  const decoys = scatterDecoys(rng, loop, rng.int(4), 12, loop, 70);
  return body(loop, decoys, { allowCross: true });
};

// ---------------------------------------------------------------------------
// Chapter 4 — Keyholes. Revisit a peg to cut a hole.
// ---------------------------------------------------------------------------

const chapter4: Maker = (rng) => {
  const outerN = 4 + rng.int(3);
  const innerN = 3 + rng.int(2);
  const R = 34 + rng.range(0, 5);
  const r = 12 + rng.range(0, 8);
  const rot = rng.range(0, 0.8);
  const offset = rng.chance(0.35) ? rng.range(-7, 7) : 0;
  const outer = ringPoints(outerN, R, rot);
  const inner = ringPoints(innerN, r, rot + rng.range(0, 0.7), 50 + offset, 50 + offset * 0.6);
  const loop = [...outer, ...inner];
  if (minSeparation(loop) < 9) return null;
  const order = donutOrder(outerN, innerN);
  const decoys = scatterDecoys(rng, loop, rng.int(3), 11, loop, 70);
  // allowCross is what tells the gesture layer that revisiting the start peg
  // is a legitimate move here rather than a request to tie off.
  return body(loop, decoys, { allowCross: true }, order);
};

// ---------------------------------------------------------------------------
// Chapter 5 — Posts. Obstacles the string cannot pass through.
// ---------------------------------------------------------------------------

const chapter5: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0), 16);
  if (loop.length < 4 || loop.length > 9) return null;
  const posts = placePosts(rng, loop, 1 + rng.int(2));
  if (posts.length === 0) return null;
  const decoys = scatterDecoys(rng, [...loop, ...posts.map(([x, y]) => [x, y] as Pt)], rng.int(3), 12, loop, 70);
  return body(loop, decoys, { posts });
};

/** Posts on the tempting chords, never on an edge the solution uses. */
function placePosts(rng: Rng, loop: Pt[], want: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = loop.length;
  const chords: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      chords.push([i, j]);
    }
  }
  rng.shuffle(chords);
  for (const [i, j] of chords) {
    if (out.length >= want) break;
    const mid: Pt = [(loop[i][0] + loop[j][0]) / 2, (loop[i][1] + loop[j][1]) / 2];
    const radius = 4.5 + rng.range(0, 3);
    if (!clearOfSolution(mid, radius + 1.5, loop)) continue;
    if (out.some(([x, y, r]) => dist([x, y], mid) < r + radius + 3)) continue;
    if (loop.some((p) => dist(p, mid) < radius + 4)) continue;
    out.push([round1(mid[0]), round1(mid[1]), round1(radius)]);
  }
  return out;
}

function clearOfSolution(p: Pt, radius: number, loop: Pt[]): boolean {
  for (let i = 0; i < loop.length; i++) {
    if (pointSegmentDistance(p, loop[i], loop[(i + 1) % loop.length]) < radius) return false;
  }
  return true;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Chapter 6 — Gold & Thorn.
// ---------------------------------------------------------------------------

const chapter6: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0), 16);
  if (loop.length < 4 || loop.length > 8) return null;
  const useGold = rng.chance(0.55);

  if (useGold) {
    // A gold peg on an edge: the shape is identical without it, so the only
    // thing making the player go there is the rule.
    const e = rng.int(loop.length);
    const a = loop[e];
    const b = loop[(e + 1) % loop.length];
    const t = 0.38 + rng.range(0, 0.24);
    const goldPt: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (dist(goldPt, a) < 9 || dist(goldPt, b) < 9) return null;
    const pts = [...loop];
    pts.splice(e + 1, 0, goldPt);
    const order = pts.map((_, i) => i);
    const decoys = scatterDecoys(rng, pts, 1 + rng.int(3), 12, loop, 70);
    return body(pts, decoys, { gold: [e + 1] }, order);
  }

  // Thorns guarding the shortcuts.
  const thorns: Pt[] = [];
  const n = loop.length;
  const chords: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) chords.push([i, j]);
  rng.shuffle(chords);
  for (const [i, j] of chords) {
    if (thorns.length >= 1 + rng.int(2)) break;
    const mid: Pt = [(loop[i][0] + loop[j][0]) / 2, (loop[i][1] + loop[j][1]) / 2];
    if (!clearOfSolution(mid, THORN_RADIUS + 2.5, loop)) continue;
    if (loop.some((p) => dist(p, mid) < 10)) continue;
    if (thorns.some((p) => dist(p, mid) < 12)) continue;
    thorns.push(mid);
  }
  if (thorns.length === 0) return null;
  const pts = [...loop, ...thorns];
  const decoys = scatterDecoys(rng, pts, rng.int(3), 12, loop, 70);
  return body(pts, decoys, { thorn: thorns.map((_, k) => loop.length + k) }, loop.map((_, i) => i));
};

// ---------------------------------------------------------------------------
// Chapter 7 — Two Threads.
// ---------------------------------------------------------------------------

const chapter7: Maker = (rng) => {
  const apart = rng.chance(0.5);
  const sep = apart ? 26 : 17;
  const aPts = ringPoints(3 + rng.int(3), 15 + rng.range(0, 5), rng.range(0, 1), 50 - sep, 50 - rng.range(0, 10));
  const bPts = ringPoints(3 + rng.int(3), 15 + rng.range(0, 5), rng.range(0, 1), 50 + sep, 50 + rng.range(0, 10));
  const pegs = [...aPts, ...bPts];
  if (minSeparation(pegs) < 9) return null;
  const decoys = scatterDecoys(rng, pegs, rng.int(3), 12);
  const all = quantize([...pegs, ...decoys]);
  for (const [x, y] of all) if (x < 5 || x > 95 || y < 5 || y > 95) return null;
  const sols = [aPts.map((_, i) => i), bPts.map((_, i) => aPts.length + i)];
  if (hasSnag(all, sols)) return null;
  return {
    pegs: all,
    threads: [
      { color: C[0], sol: sols[0] },
      { color: C[1], sol: sols[1] },
    ],
    ...(apart ? { apart: true } : {}),
  };
};

// ---------------------------------------------------------------------------
// Chapter 8 — Over & Under. Threads weave; the target shows the weave.
// ---------------------------------------------------------------------------

function crossingBands(rng: Rng, count: number): Pt[][] {
  const angle = rng.range(0, Math.PI);
  const spread = Math.PI / count;
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    out.push(band(
      54 + rng.range(0, 16),
      12 + rng.range(0, 7),
      angle + i * spread + rng.range(-0.12, 0.12),
      50, 50,
      1 + rng.int(2),
    ));
  }
  return out;
}

const chapter8: Maker = (rng) => {
  // Bands crossing at an angle: clean crossings, and every peg sits well clear
  // of the other band's edges. Two overlapping rings cross too, but they
  // scatter pegs along each other's edges, and a peg on an edge is a peg a
  // drag picks up by accident.
  const loops = crossingBands(rng, 2 + (rng.chance(0.25) ? 1 : 0));
  const pegs = loops.flat();
  if (minSeparation(pegs) < 9) return null;
  let mutual = 0;
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) mutual += mutualCrossings(loops[i], loops[j], true, true).length;
  }
  if (mutual < 2) return null;

  const crossings = allCrossings(loops);
  if (crossings.length === 0) return null;
  // Alternate over and under around the crossings — a real weave, not a stack.
  const over = crossings.map((_, k) => k).filter((k) => k % 2 === 0);

  const all = quantize(pegs);
  for (const [x, y] of all) if (x < 5 || x > 95 || y < 5 || y > 95) return null;
  let base = 0;
  const sols = loops.map((l) => {
    const sol = l.map((_, i) => base + i);
    base += l.length;
    return sol;
  });
  if (hasSnag(all, sols)) return null;
  return {
    pegs: all,
    weave: true,
    allowCross: true,
    threads: sols.map((sol, t) => (t === 0 ? { color: C[0], sol, over } : { color: C[t % C.length], sol })),
  };
};

// ---------------------------------------------------------------------------
// Chapter 9 — Blend. Where two regions overlap the colour mixes.
// ---------------------------------------------------------------------------

const chapter9: Maker = (rng) => {
  const r = 22 + rng.range(0, 7);
  const off = 9 + rng.range(0, 5);
  const aPts = ringPoints(4 + rng.int(3), r, rng.range(0, 1), 50 - off, 50 - rng.range(0, 6));
  const bPts = ringPoints(4 + rng.int(3), r, rng.range(0, 1), 50 + off, 50 + rng.range(0, 6));
  const pegs = [...aPts, ...bPts];
  if (minSeparation(pegs) < 8.5) return null;
  const all = quantize(pegs);
  for (const [x, y] of all) if (x < 5 || x > 95 || y < 5 || y > 95) return null;
  const sols = [aPts.map((_, i) => i), bPts.map((_, i) => aPts.length + i)];
  if (hasSnag(all, sols)) return null;
  return {
    pegs: all,
    allowCross: true,
    threads: [
      { color: C[0], sol: sols[0] },
      { color: C[2], sol: sols[1] },
    ],
  };
};

// ---------------------------------------------------------------------------
// Chapter 10 — Portals. Enter one, emerge from its twin.
// ---------------------------------------------------------------------------

const chapter10: Maker = (rng) => {
  // Two clusters far apart, linked by a portal pair. The hop is free, so
  // routing through it is the only way to enclose both.
  const n = 3 + rng.int(3);
  const a = ringPoints(n, 12 + rng.range(0, 4), rng.range(0, 1), 24 + rng.range(0, 4), 26 + rng.range(0, 16));
  const b = ringPoints(n, 12 + rng.range(0, 4), rng.range(0, 1), 76 - rng.range(0, 4), 74 - rng.range(0, 16));
  const pegs = [...a, ...b];
  if (minSeparation(pegs) < 9) return null;
  // The portal links the last peg of A to the first peg of B.
  const pa = n - 1;
  const pb = n;
  const order = [...a.map((_, i) => i), ...b.map((_, i) => n + i)];
  // Rotate so the portal edge pa->pb really is consecutive.
  const all = quantize(pegs);
  for (const [x, y] of all) if (x < 5 || x > 95 || y < 5 || y > 95) return null;
  if (hasSnag(all, [order], [[pa, pb]])) return null;
  return {
    pegs: all,
    allowCross: true,
    portals: [[pa, pb]],
    threads: [{ color: C[0], sol: order }],
  };
};

// ---------------------------------------------------------------------------
// Chapter 11 — Sliders. Pegs on rails, moved before you thread.
// ---------------------------------------------------------------------------

const chapter11: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0), 18);
  if (loop.length < 4 || loop.length > 8) return null;
  const k = rng.int(loop.length);
  const home = loop[k];
  // The rail runs through the peg's home; the far end is where it starts, and
  // from there the shape cannot be made, so sliding it is the puzzle.
  const angle = rng.range(0, Math.PI);
  const len = 16 + rng.range(0, 10);
  const a: [number, number] = [round1(home[0] - Math.cos(angle) * len), round1(home[1] - Math.sin(angle) * len)];
  const b: [number, number] = [round1(home[0] + Math.cos(angle) * len * 0.35), round1(home[1] + Math.sin(angle) * len * 0.35)];
  for (const [x, y] of [a, b]) if (x < 8 || x > 92 || y < 8 || y > 92) return null;
  const decoys = scatterDecoys(rng, loop, rng.int(3), 12, loop, 70);
  return body(loop, decoys, { rails: [{ peg: k, a, b }] });
};

// ---------------------------------------------------------------------------
// Chapter 12 — Fog. The target is hidden until you close a loop.
// ---------------------------------------------------------------------------

const chapter12: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0), 16);
  if (loop.length < 4 || loop.length > 8) return null;
  // Fog needs plausible alternatives, or there is nothing to deduce.
  const decoys = [...edgeDecoys(loop, 7, 2), ...scatterDecoys(rng, loop, 1 + rng.int(2), 12, loop, 70)];
  return body(loop, decoys, { fog: true });
};

// ---------------------------------------------------------------------------
// Chapter 13 — Mirror. The board mirrors your loop; you shape both halves.
// ---------------------------------------------------------------------------

const chapter13: Maker = (rng) => {
  const axis: 'x' | 'y' = rng.chance(0.5) ? 'x' : 'y';
  // Build a loop entirely on one side of the axis so the mirror really doubles it.
  const n = 3 + rng.int(3);
  const cx = axis === 'x' ? 28 : 50;
  const cy = axis === 'y' ? 28 : 50;
  const loop = ringPoints(n, 13 + rng.range(0, 6), rng.range(0, 1), cx, cy);
  for (const [x, y] of loop) {
    if (axis === 'x' && x > 44) return null;
    if (axis === 'y' && y > 44) return null;
    if (x < 8 || y < 8) return null;
  }
  const decoys = scatterDecoys(rng, loop, rng.int(3), 11)
    .filter(([x, y]) => (axis === 'x' ? x < 44 : y < 44));
  return body(loop, decoys, { mirror: axis });
};

// ---------------------------------------------------------------------------
// Chapter 14 — Rotation. Recognise a shape independent of its orientation.
// ---------------------------------------------------------------------------

const chapter14: Maker = (rng) => {
  const fam = SIMPLE_FAMILIES[rng.int(SIMPLE_FAMILIES.length)];
  const loop = fit(fam(rng, 0), 16);
  if (loop.length < 4 || loop.length > 9) return null;
  const rot = ([90, 180, 270] as const)[rng.int(3)];
  const decoys = scatterDecoys(rng, loop, rng.int(4), 12, loop, 70);
  return body(loop, decoys, { rotateTarget: rot });
};

// ---------------------------------------------------------------------------
// Chapter 15 — The Loom. Everything at once.
// ---------------------------------------------------------------------------

/** Budget that sits between the solution and the cheapest available detour. */
function tightBudget(b: Body, chapter: number): number | null {
  const lvl = { ...b, id: 'x', mode: 'classic', chapter } as Level;
  const sol = b.threads[0].sol;
  const par = cycleLength(lvl, sol);
  const used = new Set(sol);
  let cheapest = Infinity;
  for (let k = 0; k < b.pegs.length; k++) {
    if (used.has(k)) continue;
    for (let e = 0; e < sol.length; e++) {
      const a = b.pegs[sol[e]] as Pt;
      const c = b.pegs[sol[(e + 1) % sol.length]] as Pt;
      const p = b.pegs[k] as Pt;
      cheapest = Math.min(cheapest, dist(a, p) + dist(p, c) - dist(a, c));
    }
  }
  if (!Number.isFinite(cheapest) || cheapest <= 0.5) return null;
  return round1(par + cheapest * 0.55);
}

const LOOM: Maker[] = [
  // A star with a post standing in one of its lanes.
  (rng) => {
    const n = [5, 7, 9, 11][rng.int(4)];
    const ks = [2, 3, 4].filter((k) => k < n / 2 && gcd(n, k) === 1);
    const loop = fit(starPoints(n, ks[rng.int(ks.length)], 34, rng.range(0, 0.5)));
    const posts = placePosts(rng, loop, 1);
    if (!posts.length) return null;
    return body(loop, [], { allowCross: true, posts });
  },
  // A keyhole cut on a spool that will not stretch.
  (rng, i) => {
    const b = chapter4(rng, i);
    if (!b) return null;
    const budget = tightBudget(b, 15);
    return budget === null ? null : { ...b, budget };
  },
  // Two threads that must stay apart, with a post between them.
  (rng, i) => {
    const b = chapter7(rng, i);
    if (!b) return null;
    return { ...b, apart: true, posts: [[50, 50, 6 + round1(rng.range(0, 3))]] as [number, number, number][] };
  },
  // A star in the fog.
  (rng, i) => {
    const b = chapter3(rng, i);
    if (!b) return null;
    const loop = b.threads[0].sol.map((k) => b.pegs[k] as Pt);
    const extra = edgeDecoys(loop, 8, 2).filter(([x, y]) => x > 8 && x < 92 && y > 8 && y < 92);
    if (!extra.length) return null;
    return { ...b, pegs: [...b.pegs, ...quantize(extra)], fog: true };
  },
  // A keyhole shown at the wrong angle.
  (rng, i) => {
    const b = chapter4(rng, i);
    if (!b) return null;
    return { ...b, rotateTarget: ([90, 180, 270] as const)[rng.int(3)] };
  },
  // Half a shape, on a spool, mirrored into the other half.
  (rng, i) => {
    const b = chapter13(rng, i);
    if (!b) return null;
    const budget = tightBudget(b, 15);
    return budget === null ? null : { ...b, budget };
  },
  // Portals with something in the way.
  (rng, i) => {
    const b = chapter10(rng, i);
    if (!b) return null;
    const loop = b.threads[0].sol.map((k) => b.pegs[k] as Pt);
    const posts = placePosts(rng, loop, 1);
    if (!posts.length) return null;
    return { ...b, posts };
  },
  // A star that must pass through a gold peg.
  (rng, i) => {
    const b = chapter3(rng, i);
    if (!b) return null;
    const sol = b.threads[0].sol;
    const e = rng.int(sol.length);
    const a = b.pegs[sol[e]] as Pt;
    const c = b.pegs[sol[(e + 1) % sol.length]] as Pt;
    const t = 0.4 + rng.range(0, 0.2);
    const gp: Pt = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    if (dist(gp, a) < 10 || dist(gp, c) < 10) return null;
    const pegs = [...b.pegs, ...quantize([gp])];
    const newSol = [...sol];
    newSol.splice(e + 1, 0, b.pegs.length);
    return { ...b, pegs, gold: [b.pegs.length], threads: [{ ...b.threads[0], sol: newSol }] };
  },
  // A keyhole guarded by thorns.
  (rng, i) => {
    const b = chapter4(rng, i);
    if (!b) return null;
    const loop = b.threads[0].sol.map((k) => b.pegs[k] as Pt);
    const cx = 50 + rng.range(-4, 4);
    const cy = 50 + rng.range(-4, 4);
    const thorn: Pt = [round1(cx), round1(cy)];
    for (let e = 0; e < loop.length; e++) {
      if (pointSegmentDistance(thorn, loop[e], loop[(e + 1) % loop.length]) < THORN_RADIUS + 2.5) return null;
    }
    if (b.pegs.some(([x, y]) => dist([x, y], thorn) < 9)) return null;
    return { ...b, pegs: [...b.pegs, [thorn[0], thorn[1]] as [number, number]], thorn: [b.pegs.length] };
  },
  // A sliding peg and a spool that leaves no slack.
  (rng, i) => {
    const b = chapter11(rng, i);
    if (!b) return null;
    const budget = tightBudget(b, 15);
    return budget === null ? null : { ...b, budget };
  },
];

const chapter15: Maker = (rng, i) => LOOM[(i + rng.int(LOOM.length)) % LOOM.length](rng, i);

export const CLASSIC_CHAPTERS: ChapterSpec[] = [
  { chapter: 1, name: 'Loops', idea: 'Taut string; close the loop; match the shape', count: 13, make: chapter1 },
  { chapter: 2, name: 'Tight', idea: 'A length budget — the spool', count: 12, make: chapter2 },
  { chapter: 3, name: 'Crossings', idea: 'Even-odd: crossing flips inside to outside', count: 13, make: chapter3 },
  { chapter: 4, name: 'Keyholes', idea: 'Revisit a peg to cut a hole', count: 12, make: chapter4 },
  { chapter: 5, name: 'Posts', idea: 'Obstacles the string cannot pass through', count: 13, make: chapter5 },
  { chapter: 6, name: 'Gold & Thorn', idea: 'Gold must be on the loop; thorns pop the string', count: 13, make: chapter6 },
  { chapter: 7, name: 'Two Threads', idea: 'A second thread; some interlock, some stay apart', count: 13, make: chapter7 },
  { chapter: 8, name: 'Over & Under', idea: 'Threads weave; the target shows the weave', count: 12, make: chapter8 },
  { chapter: 9, name: 'Blend', idea: 'Where two regions overlap, the colour mixes', count: 12, make: chapter9 },
  { chapter: 10, name: 'Portals', idea: 'Enter one peg, emerge from its twin', count: 12, make: chapter10 },
  { chapter: 11, name: 'Sliders', idea: 'Pegs on rails, moved before you thread', count: 13, make: chapter11 },
  { chapter: 12, name: 'Fog', idea: 'The target is hidden; each attempt reveals more', count: 12, make: chapter12 },
  { chapter: 13, name: 'Mirror', idea: 'The board mirrors your loop across an axis', count: 12, make: chapter13 },
  { chapter: 14, name: 'Rotation', idea: 'Recognise a shape independent of orientation', count: 12, make: chapter14 },
  { chapter: 15, name: 'The Loom', idea: 'Everything at once', count: 14, make: chapter15 },
];

// ---------------------------------------------------------------------------
// Weave mode — the multi-thread campaign
// ---------------------------------------------------------------------------

function multiRings(rng: Rng, count: number, spread: number, radius: number): Pt[][] {
  // Rotations are re-rolled until the pegs are far enough apart to tell one
  // from another; giving up immediately wasted most candidates.
  for (let attempt = 0; attempt < 14; attempt++) {
    const out: Pt[][] = [];
    for (let t = 0; t < count; t++) {
      const a = (t / count) * Math.PI * 2 + rng.range(0, 0.6);
      out.push(ringPoints(
        3 + rng.int(4), radius, rng.range(0, 1),
        50 + Math.cos(a) * spread, 50 + Math.sin(a) * spread,
      ));
    }
    const flat = out.flat();
    if (minSeparation(flat) < 8.5) continue;
    if (flat.some(([x, y]) => x < 7 || x > 93 || y < 7 || y > 93)) continue;
    return out;
  }
  return [];
}

function weaveBody(rng: Rng, loops: Pt[][], extra: Partial<Body> = {}): Body | null {
  if (loops.length === 0) return null;
  const pegs = loops.flat();
  if (minSeparation(pegs) < 8) return null;
  const all = quantize(pegs);
  for (const [x, y] of all) if (x < 5 || x > 95 || y < 5 || y > 95) return null;
  let base = 0;
  const threads: ThreadSpec[] = loops.map((l, t) => {
    const sol = l.map((_, i) => base + i);
    base += l.length;
    return { color: C[t % C.length], sol };
  });
  if (hasSnag(all, threads.map((t) => t.sol))) return null;
  void rng;
  return { pegs: all, threads, ...extra };
}

/** How many times do these loops cross one another? */
function crossCount(loops: Pt[][]): number {
  let n = 0;
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) n += mutualCrossings(loops[i], loops[j], true, true).length;
  }
  return n;
}

// Two threads side by side. They do not cross, so allowCross would be
// decoration and is left off.
const weave1: Maker = (rng) => weaveBody(rng, multiRings(rng, 2, 21 + rng.range(0, 5), 15 + rng.range(0, 4)));

const weave2: Maker = (rng) => weaveBody(rng, multiRings(rng, 3, 24 + rng.range(0, 4), 12 + rng.range(0, 3)));

const weave3: Maker = (rng) => {
  const loops = crossingBands(rng, 2 + (rng.chance(0.35) ? 1 : 0));
  if (crossCount(loops) < 2) return null;
  const b = weaveBody(rng, loops, { allowCross: true, weave: true });
  if (!b) return null;
  const crossings = allCrossings(loops);
  if (crossings.length < 2) return null;
  b.threads[0].over = crossings.map((_, k) => k).filter((k) => k % 2 === 0);
  return b;
};

const weave4: Maker = (rng) => {
  const loops = multiRings(rng, 2, 14 + rng.range(0, 4), 19 + rng.range(0, 4));
  if (crossCount(loops) === 0) return null;
  return weaveBody(rng, loops, { allowCross: true });
};

const weave5: Maker = (rng) => {
  // Interlocking: a second loop that lives inside the hole of a donut.
  // Vary every count: an interlock is structurally uniform, and a chapter of a
  // dozen needs more distinct shapes than "donut plus a triangle".
  const outerN = 4 + rng.int(4);
  const innerN = 3 + rng.int(3);
  const secondN = 3 + rng.int(2);
  const outer = ringPoints(outerN, 37 + rng.range(0, 3), rng.range(0, 0.6));
  const inner = ringPoints(innerN, 22 + rng.range(0, 4), rng.range(0, 0.6));
  const second = ringPoints(secondN, 7 + rng.range(0, 3), rng.range(0, 1), 50, 50);
  const pegs = [...outer, ...inner, ...second];
  if (minSeparation(pegs) < 8) return null;
  const all = quantize(pegs);
  for (const [x, y] of all) if (x < 5 || x > 95 || y < 5 || y > 95) return null;
  const sols = [donutOrder(outerN, innerN), second.map((_, i) => outerN + innerN + i)];
  if (hasSnag(all, sols)) return null;
  return {
    pegs: all,
    allowCross: true,
    threads: [
      { color: C[0], sol: sols[0] },
      { color: C[1], sol: sols[1] },
    ],
  };
};

// Four threads that may never cross. `apart` is the rule; nothing else is.
const weave6: Maker = (rng) => weaveBody(rng, multiRings(rng, 4, 25 + rng.range(0, 3), 11 + rng.range(0, 2)), { apart: true });

export const WEAVE_CHAPTERS: ChapterSpec[] = [
  { chapter: 1, name: 'Pair', idea: 'Two threads, side by side', count: 12, make: weave1 },
  { chapter: 2, name: 'Trio', idea: 'A third colour joins', count: 12, make: weave2 },
  { chapter: 3, name: 'Over & Under', idea: 'Choose which thread passes over', count: 12, make: weave3 },
  { chapter: 4, name: 'Overlap', idea: 'Regions mix where they meet', count: 12, make: weave4 },
  { chapter: 5, name: 'Interlock', idea: 'A loop through the hole of a donut', count: 13, make: weave5 },
  { chapter: 6, name: 'No Touch', idea: 'Four threads that may never cross', count: 13, make: weave6 },
];

// ---------------------------------------------------------------------------
// Assessment pool — one mechanic per item, every family covered
// ---------------------------------------------------------------------------

export const ASSESS_FAMILIES: Array<{ family: string; make: Maker }> = [
  { family: 'loop', make: chapter1 },
  { family: 'budget', make: chapter2 },
  { family: 'cross', make: chapter3 },
  { family: 'keyhole', make: chapter4 },
  { family: 'post', make: chapter5 },
  { family: 'gold', make: chapter6 },
  { family: 'multi', make: chapter7 },
  { family: 'portal', make: chapter10 },
  { family: 'rail', make: chapter11 },
  { family: 'mirror', make: chapter13 },
  { family: 'rotate', make: chapter14 },
  { family: 'blend', make: chapter9 },
];

export { placePosts, polyLength, body, fit, starOrder, scaleAll, segmentHitsDisc };
