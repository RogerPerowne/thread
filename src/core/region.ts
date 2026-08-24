/**
 * Even–odd region rasterizer. This is the heart of the game: crossing the
 * string flips inside to outside, which is exactly what the even–odd fill rule
 * says. Wrap five pegs in ring order -> pentagon. Wrap the same five in star
 * order -> the crossings carve the middle out and you get a pentagram.
 *
 * ZERO DOM imports. Buffers are pre-allocated and reused; nothing here
 * allocates on a hot path, and the rasterizer runs at most once per closed
 * loop — never per frame.
 */

import type { Pt } from './geometry.js';

export const GRID = 128;
export const CELL = 100 / GRID;
export const CELLS = GRID * GRID;

/** A raster cell holds a bitmask: bit t set means thread t covers this cell. */
export type Raster = Uint8Array;

export function makeRaster(): Raster {
  return new Uint8Array(CELLS);
}

/** Reusable scratch so the rasterizer never allocates. */
const xsBuf = new Float64Array(512);

/**
 * OR `bit` into every cell inside the closed polygon `pts`, under the even–odd
 * rule. Cells are sampled at their centres, so two identical polygons always
 * produce bit-identical rasters — which is why a correct solve scores exactly
 * 1.000 rather than 0.9997.
 */
export function rasterizeLoop(pts: readonly Pt[], bit: number, out: Raster): void {
  const n = pts.length;
  if (n < 3) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pts[i][1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  let r0 = Math.floor(minY / CELL);
  let r1 = Math.ceil(maxY / CELL);
  if (r0 < 0) r0 = 0;
  if (r1 > GRID) r1 = GRID;

  for (let r = r0; r < r1; r++) {
    const y = (r + 0.5) * CELL;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ay = a[1];
      const by = b[1];
      // Half-open rule on y keeps vertices from being counted twice.
      if ((ay <= y) === (by <= y)) continue;
      const t = (y - ay) / (by - ay);
      if (count < xsBuf.length) xsBuf[count++] = a[0] + t * (b[0] - a[0]);
    }
    if (count < 2) continue;

    // Insertion sort: crossing counts are tiny (typically < 12).
    for (let i = 1; i < count; i++) {
      const v = xsBuf[i];
      let j = i - 1;
      while (j >= 0 && xsBuf[j] > v) {
        xsBuf[j + 1] = xsBuf[j];
        j--;
      }
      xsBuf[j + 1] = v;
    }

    const rowBase = r * GRID;
    for (let k = 0; k + 1 < count; k += 2) {
      const xa = xsBuf[k];
      const xb = xsBuf[k + 1];
      let c0 = Math.ceil(xa / CELL - 0.5);
      let c1 = Math.ceil(xb / CELL - 0.5);
      if (c0 < 0) c0 = 0;
      if (c1 > GRID) c1 = GRID;
      for (let c = c0; c < c1; c++) out[rowBase + c] |= bit;
    }
  }
}

export function clearRaster(r: Raster): void {
  r.fill(0);
}

/** Rasterize a whole set of thread loops into one labelled raster. */
export function rasterizeThreads(loops: ReadonlyArray<readonly Pt[]>, dest: Raster): Raster {
  dest.fill(0);
  for (let t = 0; t < loops.length; t++) {
    const bit = 1 << t;
    rasterizeLoop(loops[t], bit, dest);
  }
  return dest;
}

/**
 * Labelled intersection-over-union. Cells only count as agreeing when the
 * exact same set of threads covers them, so a blend target (two threads
 * overlapping) cannot be satisfied by a single thread.
 */
export function similarity(a: Raster, b: Raster): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < CELLS; i++) {
    const x = a[i];
    const y = b[i];
    if (x === 0 && y === 0) continue;
    union++;
    if (x === y) inter++;
  }
  if (union === 0) return 1;
  return inter / union;
}

/** Cells where the two rasters disagree — the region the player got wrong. */
export function symmetricDifference(a: Raster, b: Raster, out: Raster): number {
  let count = 0;
  for (let i = 0; i < CELLS; i++) {
    if (a[i] !== b[i]) {
      out[i] = 1;
      count++;
    } else {
      out[i] = 0;
    }
  }
  return count;
}

export function area(r: Raster): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (r[i] !== 0) n++;
  return n;
}

/** Fraction of the board covered, 0..1. Used to reject degenerate levels. */
export function coverage(r: Raster): number {
  return area(r) / CELLS;
}

export function cloneRaster(r: Raster): Raster {
  return new Uint8Array(r);
}

export function rastersEqual(a: Raster, b: Raster): boolean {
  for (let i = 0; i < CELLS; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type Topology = {
  /** Connected filled components (4-connectivity). */
  components: number;
  /** Enclosed voids — the keyhole count. */
  holes: number;
  /** Filled cell count. */
  filled: number;
};

/**
 * Component and hole counts via flood fill. Holes are background components
 * that do not touch the border — a donut has one, a pentagram has none
 * (its middle is genuinely outside, which is the point of chapter 3).
 */
export function topology(r: Raster): Topology {
  const seen = new Uint8Array(CELLS);
  const stack = new Int32Array(CELLS);
  let components = 0;
  let holes = 0;
  let filled = 0;
  for (let i = 0; i < CELLS; i++) if (r[i] !== 0) filled++;

  const flood = (start: number, wantFilled: boolean): boolean => {
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let touchesBorder = false;
    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % GRID;
      const y = (idx / GRID) | 0;
      if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) touchesBorder = true;
      if (x > 0) pushIf(idx - 1);
      if (x < GRID - 1) pushIf(idx + 1);
      if (y > 0) pushIf(idx - GRID);
      if (y < GRID - 1) pushIf(idx + GRID);
    }
    function pushIf(n: number) {
      if (seen[n]) return;
      const isFilled = r[n] !== 0;
      if (isFilled !== wantFilled) return;
      seen[n] = 1;
      stack[sp++] = n;
    }
    return touchesBorder;
  };

  for (let i = 0; i < CELLS; i++) {
    if (seen[i]) continue;
    const isFilled = r[i] !== 0;
    const touched = flood(i, isFilled);
    if (isFilled) components++;
    else if (!touched) holes++;
  }
  return { components, holes, filled };
}

/** Coarse 8x8 occupancy signature — cheap shape fingerprint for the audit. */
export function signature(r: Raster): Uint8Array {
  const S = 8;
  const block = GRID / S;
  const sig = new Uint8Array(S * S);
  for (let by = 0; by < S; by++) {
    for (let bx = 0; bx < S; bx++) {
      let n = 0;
      for (let y = 0; y < block; y++) {
        const row = (by * block + y) * GRID + bx * block;
        for (let x = 0; x < block; x++) if (r[row + x] !== 0) n++;
      }
      sig[by * S + bx] = Math.round((n / (block * block)) * 255);
    }
  }
  return sig;
}

/** Normalised distance between two coarse signatures, 0 (same) .. 1. */
export function signatureDistance(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

/** Which symmetries the region has — part of the anti-repetition fingerprint. */
export function symmetryGroup(r: Raster): string {
  let mx = true;
  let my = true;
  let rot180 = true;
  for (let y = 0; y < GRID && (mx || my || rot180); y++) {
    for (let x = 0; x < GRID; x++) {
      const v = r[y * GRID + x];
      if (mx && v !== r[y * GRID + (GRID - 1 - x)]) mx = false;
      if (my && v !== r[(GRID - 1 - y) * GRID + x]) my = false;
      if (rot180 && v !== r[(GRID - 1 - y) * GRID + (GRID - 1 - x)]) rot180 = false;
      if (!mx && !my && !rot180) break;
    }
  }
  return `${mx ? 'X' : '-'}${my ? 'Y' : '-'}${rot180 ? 'R' : '-'}`;
}
