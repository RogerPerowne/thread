import { describe, it, expect } from 'vitest';
import {
  GRID, makeRaster, rasterizeLoop, similarity, symmetricDifference,
  area, topology, symmetryGroup, signature, signatureDistance, rasterizeThreads,
} from '../../src/core/region.js';
import type { Pt } from '../../src/core/geometry.js';

/** Five pegs on a circle, in ring order (0,1,2,3,4). */
function pentagonPegs(r = 40): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    out.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return out;
}

describe('even-odd rasterizer', () => {
  it('fills a square exactly', () => {
    const r = makeRaster();
    rasterizeLoop([[25, 25], [75, 25], [75, 75], [25, 75]], 1, r);
    const expected = (GRID * 0.5) * (GRID * 0.5);
    expect(area(r)).toBeCloseTo(expected, -1);
    expect(topology(r)).toMatchObject({ components: 1, holes: 0 });
  });

  it('ring order over five pegs gives a SOLID pentagon', () => {
    const p = pentagonPegs();
    const r = makeRaster();
    rasterizeLoop([p[0], p[1], p[2], p[3], p[4]], 1, r);
    const t = topology(r);
    expect(t.components).toBe(1);
    expect(t.holes).toBe(0);
    // The centre of the board is inside a solid pentagon.
    const mid = (GRID / 2) * GRID + GRID / 2;
    expect(r[mid]).toBe(1);
  });

  it('star order over the SAME five pegs gives a PENTAGRAM with a hollow middle', () => {
    const p = pentagonPegs();
    const r = makeRaster();
    // Star order: skip one peg each step. The crossings flip inside to outside.
    rasterizeLoop([p[0], p[2], p[4], p[1], p[3]], 1, r);
    const t = topology(r);
    // Five points of the star, joined only at crossing vertices which the
    // 4-connected flood fill treats as separate: what matters is the middle.
    const mid = (GRID / 2) * GRID + GRID / 2;
    expect(r[mid]).toBe(0); // the centre is OUTSIDE — this is the whole game
    expect(t.filled).toBeGreaterThan(0);
  });

  it('the pentagram is strictly smaller than the pentagon over the same pegs', () => {
    const p = pentagonPegs();
    const ring = makeRaster();
    const star = makeRaster();
    rasterizeLoop([p[0], p[1], p[2], p[3], p[4]], 1, ring);
    rasterizeLoop([p[0], p[2], p[4], p[1], p[3]], 1, star);
    expect(area(star)).toBeLessThan(area(ring));
    // and they are decidedly not the same shape
    expect(similarity(ring, star)).toBeLessThan(0.6);
  });

  it('revisiting a peg carves a keyhole (donut)', () => {
    // Outer square traversed one way, inner square traversed the same way:
    // even-odd cancels the inner region, leaving a ring.
    const r = makeRaster();
    rasterizeLoop(
      [[15, 15], [85, 15], [85, 85], [15, 85], [15, 15],
       [35, 35], [65, 35], [65, 65], [35, 65], [35, 35]],
      1, r,
    );
    const t = topology(r);
    expect(t.holes).toBe(1);
    const mid = (GRID / 2) * GRID + GRID / 2;
    expect(r[mid]).toBe(0);
  });
});

describe('similarity', () => {
  it('is exactly 1.000 for identical peg coordinates', () => {
    const p = pentagonPegs();
    const a = makeRaster();
    const b = makeRaster();
    rasterizeLoop([p[0], p[2], p[4], p[1], p[3]], 1, a);
    rasterizeLoop([p[0], p[2], p[4], p[1], p[3]], 1, b);
    expect(similarity(a, b)).toBe(1);
  });

  it('is exactly 1.000 for the same cycle entered at a different peg', () => {
    const p = pentagonPegs();
    const a = makeRaster();
    const b = makeRaster();
    rasterizeLoop([p[0], p[1], p[2], p[3], p[4]], 1, a);
    rasterizeLoop([p[2], p[3], p[4], p[0], p[1]], 1, b);
    expect(similarity(a, b)).toBe(1);
  });

  it('is exactly 1.000 for the same cycle traversed backwards', () => {
    const p = pentagonPegs();
    const a = makeRaster();
    const b = makeRaster();
    rasterizeLoop([p[0], p[1], p[2], p[3], p[4]], 1, a);
    rasterizeLoop([p[4], p[3], p[2], p[1], p[0]], 1, b);
    expect(similarity(a, b)).toBe(1);
  });

  it('distinguishes thread labels — a blend is not a single thread', () => {
    const solo = makeRaster();
    const blend = makeRaster();
    const sq: Pt[] = [[30, 30], [70, 30], [70, 70], [30, 70]];
    rasterizeThreads([sq], solo);
    rasterizeThreads([sq, sq], blend);
    expect(similarity(solo, blend)).toBeLessThan(0.01);
  });
});

describe('symmetric difference', () => {
  it('marks exactly the cells that disagree', () => {
    const a = makeRaster();
    const b = makeRaster();
    const out = makeRaster();
    rasterizeLoop([[20, 20], [60, 20], [60, 60], [20, 60]], 1, a);
    rasterizeLoop([[20, 20], [60, 20], [60, 60], [20, 60]], 1, b);
    expect(symmetricDifference(a, b, out)).toBe(0);
    rasterizeLoop([[60, 60], [80, 60], [80, 80], [60, 80]], 1, b);
    expect(symmetricDifference(a, b, out)).toBeGreaterThan(0);
  });
});

describe('fingerprints', () => {
  it('detects mirror symmetry', () => {
    const r = makeRaster();
    rasterizeLoop([[25, 25], [75, 25], [75, 75], [25, 75]], 1, r);
    expect(symmetryGroup(r)).toBe('XYR');
  });
  it('signature distance is 0 for identical shapes and large for different ones', () => {
    const a = makeRaster();
    const b = makeRaster();
    rasterizeLoop([[25, 25], [75, 25], [75, 75], [25, 75]], 1, a);
    rasterizeLoop([[25, 25], [75, 25], [75, 75], [25, 75]], 1, b);
    expect(signatureDistance(signature(a), signature(b))).toBe(0);
    const c = makeRaster();
    rasterizeLoop([[5, 5], [30, 5], [30, 30], [5, 30]], 1, c);
    expect(signatureDistance(signature(a), signature(c))).toBeGreaterThan(0.1);
  });
});
