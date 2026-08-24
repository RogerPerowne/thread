/**
 * Pure 2D geometry for the pegboard. Board space is 0..100 on both axes.
 * ZERO DOM imports — this file must run in plain Node.
 */

export type Pt = readonly [number, number];

export const EPS = 1e-9;

export function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}

export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function dist2(a: Pt, b: Pt): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** Length of the open polyline through `pts`. */
export function pathLength(pts: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** Length of the closed polygon through `pts` (includes the closing edge). */
export function loopLength(pts: readonly Pt[]): number {
  if (pts.length < 2) return 0;
  return pathLength(pts) + dist(pts[pts.length - 1], pts[0]);
}

/** Shortest distance from point `p` to the segment `a`-`b`. */
export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  if (len2 < EPS) return Math.hypot(wx, wy);
  let t = (wx * vx + wy * vy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(wx - t * vx, wy - t * vy);
}

export type Crossing = {
  /** Parameter along the first segment, 0..1 */
  ta: number;
  /** Parameter along the second segment, 0..1 */
  tb: number;
  point: Pt;
};

/**
 * Proper intersection of two open segments. Returns null when they merely touch
 * at a shared endpoint, are collinear, or do not meet at all. "Proper" is the
 * right notion here: two thread segments that share a peg are not a crossing,
 * because the string simply turns at that peg.
 */
export function segmentIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Crossing | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const denom = cross(d1x, d1y, d2x, d2y);
  if (Math.abs(denom) < 1e-12) return null; // parallel or collinear

  const ex = p3[0] - p1[0];
  const ey = p3[1] - p1[1];
  const ta = cross(ex, ey, d2x, d2y) / denom;
  const tb = cross(ex, ey, d1x, d1y) / denom;

  const tol = 1e-7;
  if (ta <= tol || ta >= 1 - tol) return null;
  if (tb <= tol || tb >= 1 - tol) return null;

  return { ta, tb, point: [p1[0] + ta * d1x, p1[1] + ta * d1y] };
}

/** Do two segments properly cross? */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  return segmentIntersection(p1, p2, p3, p4) !== null;
}

export type SelfCrossing = Crossing & { i: number; j: number };

/**
 * All proper self-crossings of a polyline (or polygon when `closed`).
 * Adjacent segments are skipped — they share a peg by construction.
 */
export function selfCrossings(pts: readonly Pt[], closed: boolean): SelfCrossing[] {
  const out: SelfCrossing[] = [];
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  if (segCount < 2) return out;
  for (let i = 0; i < segCount; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < segCount; j++) {
      if (closed && i === 0 && j === segCount - 1) continue; // adjacent around the loop
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      const x = segmentIntersection(a1, a2, b1, b2);
      if (x) out.push({ ...x, i, j });
    }
  }
  return out;
}

/** Crossings between two distinct polylines/polygons. */
export function mutualCrossings(
  a: readonly Pt[],
  b: readonly Pt[],
  aClosed: boolean,
  bClosed: boolean,
): Array<Crossing & { i: number; j: number }> {
  const out: Array<Crossing & { i: number; j: number }> = [];
  const an = aClosed ? a.length : a.length - 1;
  const bn = bClosed ? b.length : b.length - 1;
  for (let i = 0; i < an; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < bn; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      const x = segmentIntersection(a1, a2, b1, b2);
      if (x) out.push({ ...x, i, j });
    }
  }
  return out;
}

/** Signed area (shoelace). Positive when counter-clockwise in a y-down space. */
export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Does the segment a-b pass through the disc at `c` with radius `r`? */
export function segmentHitsDisc(a: Pt, b: Pt, c: Pt, r: number): boolean {
  return pointSegmentDistance(c, a, b) < r;
}

/** Rotate a point about the board centre (50,50) by 0/90/180/270 degrees. */
export function rotateAboutCentre(p: Pt, degrees: 0 | 90 | 180 | 270): Pt {
  const dx = p[0] - 50;
  const dy = p[1] - 50;
  switch (degrees) {
    case 0: return p;
    case 90: return [50 - dy, 50 + dx];
    case 180: return [50 - dx, 50 - dy];
    case 270: return [50 + dy, 50 - dx];
  }
}

/** Mirror a point across the board's vertical ('x') or horizontal ('y') axis. */
export function mirrorPoint(p: Pt, axis: 'x' | 'y'): Pt {
  return axis === 'x' ? [100 - p[0], p[1]] : [p[0], 100 - p[1]];
}
