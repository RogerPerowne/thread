/**
 * Shape and peg-layout families. Shared by the build-time level designers and
 * the runtime generators (Daily, Blitz, Zen, One Life), so a generated puzzle
 * is made of exactly the same material as a hand-designed one.
 *
 * Every family returns an ORDERED list of points: the order is the solution,
 * and the target is derived from it. Nothing here authors a target.
 */

import type { Pt } from './geometry.js';
import type { Rng } from './rng.js';
import { pointSegmentDistance } from './geometry.js';

export type Design = {
  /** Ordered solution points. */
  loop: Pt[];
  /** Points that exist to be chosen against. */
  decoys: Pt[];
  /** How the solution indexes into the final peg list; set by `assemble`. */
  name: string;
};

const TAU = Math.PI * 2;

export function polar(cx: number, cy: number, r: number, a: number): Pt {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** n points on a circle, starting at the top. */
export function ringPoints(n: number, r: number, rot = 0, cx = 50, cy = 50): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(polar(cx, cy, r, -Math.PI / 2 + rot + (i * TAU) / n));
  return out;
}

/** An ellipse, so not every round shape is a circle. */
export function ovalPoints(n: number, rx: number, ry: number, rot = 0, cx = 50, cy = 50): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * TAU) / n;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}

/**
 * The star polygon {n/k}: visit every k-th peg. This is chapter 3 in one line —
 * the same pegs as the ring, a different order, and the crossings carve the
 * middle out.
 */
export function starOrder(n: number, k: number): number[] {
  const out: number[] = [];
  let i = 0;
  do {
    out.push(i);
    i = (i + k) % n;
  } while (i !== 0);
  return out;
}

export function starPoints(n: number, k: number, r: number, rot = 0, cx = 50, cy = 50): Pt[] {
  const ring = ringPoints(n, r, rot, cx, cy);
  return starOrder(n, k).map((i) => ring[i]);
}

export function rect(w: number, h: number, cx = 50, cy = 50): Pt[] {
  return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
}

/** An L, in one of four rotations. */
export function lShape(size: number, thick: number, turn: 0 | 1 | 2 | 3): Pt[] {
  const s = size / 2;
  const t = thick;
  const base: Pt[] = [
    [-s, -s], [-s + t, -s], [-s + t, s - t], [s, s - t], [s, s], [-s, s],
  ];
  return base.map((p) => rotateLocal(p, turn)).map(([x, y]) => [50 + x, 50 + y] as Pt);
}

/** A plus/cross with adjustable arms. */
export function plusShape(arm: number, thick: number): Pt[] {
  const a = arm / 2;
  const t = thick / 2;
  const pts: Pt[] = [
    [-t, -a], [t, -a], [t, -t], [a, -t], [a, t], [t, t],
    [t, a], [-t, a], [-t, t], [-a, t], [-a, -t], [-t, -t],
  ];
  return pts.map(([x, y]) => [50 + x, 50 + y] as Pt);
}

export function chevron(w: number, h: number, thick: number): Pt[] {
  const pts: Pt[] = [
    [-w / 2, -h / 2], [0, h / 2 - thick], [w / 2, -h / 2],
    [w / 2, -h / 2 + thick], [0, h / 2], [-w / 2, -h / 2 + thick],
  ];
  return pts.map(([x, y]) => [50 + x, 50 + y] as Pt);
}

export function arrow(w: number, h: number): Pt[] {
  const pts: Pt[] = [
    [0, -h / 2], [w / 2, 0], [w / 5, 0], [w / 5, h / 2],
    [-w / 5, h / 2], [-w / 5, 0], [-w / 2, 0],
  ];
  return pts.map(([x, y]) => [50 + x, 50 + y] as Pt);
}

export function house(w: number, h: number): Pt[] {
  const pts: Pt[] = [[0, -h / 2], [w / 2, -h / 6], [w / 2, h / 2], [-w / 2, h / 2], [-w / 2, -h / 6]];
  return pts.map(([x, y]) => [50 + x, 50 + y] as Pt);
}

export function trapezoid(top: number, bottom: number, h: number): Pt[] {
  return [
    [50 - top / 2, 50 - h / 2], [50 + top / 2, 50 - h / 2],
    [50 + bottom / 2, 50 + h / 2], [50 - bottom / 2, 50 + h / 2],
  ];
}

export function staircase(steps: number, size: number): Pt[] {
  const step = size / steps;
  const pts: Pt[] = [];
  let x = -size / 2;
  let y = size / 2;
  pts.push([x, y]);
  for (let i = 0; i < steps; i++) {
    y -= step;
    pts.push([x, y]);
    x += step;
    pts.push([x, y]);
  }
  pts.push([x, size / 2]);
  return pts.map(([px, py]) => [50 + px, 50 + py] as Pt);
}

export function comb(teeth: number, w: number, h: number, depth: number): Pt[] {
  const pts: Pt[] = [];
  const step = w / (teeth * 2 - 1);
  let x = -w / 2;
  pts.push([x, h / 2]);
  for (let i = 0; i < teeth; i++) {
    pts.push([x, -h / 2]);
    x += step;
    pts.push([x, -h / 2]);
    if (i < teeth - 1) {
      pts.push([x, -h / 2 + depth]);
      x += step;
      pts.push([x, -h / 2 + depth]);
    }
  }
  pts.push([x, h / 2]);
  return pts.map(([px, py]) => [50 + px, 50 + py] as Pt);
}

/**
 * A long thin band through the centre at `angle`.
 *
 * Two bands at different angles cross cleanly: every corner sits far from the
 * other band's edges, which is what makes them the right shape for a weave.
 * Two overlapping rings cross too, but they scatter pegs along each other's
 * edges, and a peg on an edge is a peg a drag picks up by accident.
 */
export function band(
  length: number,
  width: number,
  angle: number,
  cx = 50,
  cy = 50,
  /** Extra pegs spaced along each long side; 1 means just the corners. */
  segments = 1,
): Pt[] {
  const hl = length / 2;
  const hw = width / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const put = (x: number, y: number): Pt => [cx + x * c - y * s, cy + x * s + y * c];
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) out.push(put(-hl + (i / segments) * length, -hw));
  for (let i = 0; i <= segments; i++) out.push(put(hl - (i / segments) * length, hw));
  return out;
}

/** A bowtie: two triangles meeting at a crossing. Chapter 3 material. */
export function bowtie(w: number, h: number): Pt[] {
  return [
    [50 - w / 2, 50 - h / 2], [50 + w / 2, 50 + h / 2],
    [50 + w / 2, 50 - h / 2], [50 - w / 2, 50 + h / 2],
  ];
}

/** A propeller: n lobes that cross near the middle. */
export function propeller(lobes: number, r: number, inner: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < lobes; i++) {
    const a = -Math.PI / 2 + (i * TAU) / lobes;
    pts.push(polar(50, 50, r, a));
    pts.push(polar(50, 50, inner, a + TAU / (lobes * 2)));
  }
  // Re-order so consecutive lobes cross.
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(pts[i], pts[(i + 3) % pts.length]);
  return out;
}

/**
 * Donut: an outer ring, a spoke in, an inner ring, and the spoke back out. The
 * two spokes lie on top of each other, so even-odd cancels them and what is
 * left is a ring with a genuine hole.
 */
export function donutOrder(outerCount: number, innerCount: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < outerCount; i++) out.push(i);
  out.push(0);
  for (let i = 0; i < innerCount; i++) out.push(outerCount + i);
  out.push(outerCount);
  return out;
}

export function rotateLocal(p: Pt, turn: 0 | 1 | 2 | 3): Pt {
  switch (turn) {
    case 0: return p;
    case 1: return [-p[1], p[0]];
    case 2: return [-p[0], -p[1]];
    case 3: return [p[1], -p[0]];
  }
}

export function rotateAll(pts: Pt[], radians: number, cx = 50, cy = 50): Pt[] {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c] as Pt;
  });
}

export function scaleAll(pts: Pt[], k: number, cx = 50, cy = 50): Pt[] {
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pt);
}

export function translateAll(pts: Pt[], dx: number, dy: number): Pt[] {
  return pts.map(([x, y]) => [x + dx, y + dy] as Pt);
}

/** Keep everything comfortably inside the board so nothing touches the edge. */
export function fitToBoard(pts: Pt[], margin = 10): Pt[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const span = 100 - margin * 2;
  const k = Math.min(span / Math.max(w, 1e-6), span / Math.max(h, 1e-6), 1.6);
  return pts.map(([x, y]) => [
    margin + (x - minX) * k + (span - w * k) / 2,
    margin + (y - minY) * k + (span - h * k) / 2,
  ] as Pt);
}

/** Round to a tenth so authored levels are stable and diffable. */
export function quantize(pts: Pt[]): [number, number][] {
  return pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as [number, number]);
}

export function minSeparation(pts: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      m = Math.min(m, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
    }
  }
  return m;
}

/**
 * Decoy pegs: pegs that exist so the player has to choose.
 *
 * A decoy is only a decoy if threading through it visibly changes the shape.
 * Inserting a peg between two adjacent solution pegs replaces that edge with
 * two, and the region changes by exactly the triangle they form — so a decoy
 * nearly in line with an edge adds a hair-thin spike and the wrong answer
 * scores 0.997. Rejecting by triangle area, not by distance, is what makes
 * that impossible: distance from the segment is not enough, because a peg can
 * sit far past an edge's end and still be in line with it.
 */
export function triangleArea(a: Pt, b: Pt, c: Pt): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

export function scatterDecoys(
  rng: Rng,
  existing: Pt[],
  count: number,
  minGap = 11,
  loop?: Pt[],
  minSpikeArea = 60,
): Pt[] {
  const out: Pt[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 400) {
    const p: Pt = [rng.range(12, 88), rng.range(12, 88)];
    let ok = true;
    for (const q of [...existing, ...out]) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < minGap) {
        ok = false;
        break;
      }
    }
    if (ok && loop) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        if (triangleArea(a, p, b) < minSpikeArea) {
          ok = false;
          break;
        }
        if (pointSegmentDistance(p, a, b) < 5) {
          ok = false;
          break;
        }
      }
    }
    if (ok) out.push(p);
  }
  return out;
}

/** Decoys placed just outside the loop's edges — the tempting detour. */
export function edgeDecoys(loop: Pt[], out = 6, every = 1): Pt[] {
  const res: Pt[] = [];
  const cx = loop.reduce((s, p) => s + p[0], 0) / loop.length;
  const cy = loop.reduce((s, p) => s + p[1], 0) / loop.length;
  for (let i = 0; i < loop.length; i += every) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    res.push([mx + (dx / len) * out, my + (dy / len) * out]);
  }
  return res;
}
