import { describe, it, expect } from 'vitest';
import {
  segmentIntersection, segmentsCross, selfCrossings, mutualCrossings,
  pointSegmentDistance, pathLength, loopLength, rotateAboutCentre, mirrorPoint,
} from '../../src/core/geometry.js';
import type { Pt } from '../../src/core/geometry.js';

describe('segment intersection', () => {
  it('finds a proper crossing', () => {
    const x = segmentIntersection([0, 0], [10, 10], [0, 10], [10, 0]);
    expect(x).not.toBeNull();
    expect(x!.point[0]).toBeCloseTo(5);
    expect(x!.point[1]).toBeCloseTo(5);
  });
  it('does NOT count a shared endpoint as a crossing (the string just turns)', () => {
    expect(segmentsCross([0, 0], [10, 0], [10, 0], [10, 10])).toBe(false);
    expect(segmentsCross([0, 0], [10, 0], [0, 0], [0, 10])).toBe(false);
  });
  it('rejects parallel and collinear segments', () => {
    expect(segmentsCross([0, 0], [10, 0], [0, 5], [10, 5])).toBe(false);
    expect(segmentsCross([0, 0], [10, 0], [5, 0], [15, 0])).toBe(false);
  });
  it('rejects segments that would meet beyond their ends', () => {
    expect(segmentsCross([0, 0], [1, 1], [8, 10], [10, 8])).toBe(false);
  });
});

describe('self crossings', () => {
  const pent = (): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      out.push([50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)]);
    }
    return out;
  };
  it('a convex pentagon has none', () => {
    expect(selfCrossings(pent(), true)).toHaveLength(0);
  });
  it('a pentagram has exactly five', () => {
    const p = pent();
    expect(selfCrossings([p[0], p[2], p[4], p[1], p[3]], true)).toHaveLength(5);
  });
  it('a figure-eight has exactly one', () => {
    expect(selfCrossings([[0, 0], [10, 10], [0, 10], [10, 0]] as Pt[], true)).toHaveLength(1);
  });
});

describe('mutual crossings', () => {
  it('counts crossings between two interlocked squares', () => {
    const a: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: Pt[] = [[5, 5], [15, 5], [15, 15], [5, 15]];
    expect(mutualCrossings(a, b, true, true).length).toBe(2);
  });
  it('finds none for disjoint squares', () => {
    const a: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: Pt[] = [[20, 20], [30, 20], [30, 30], [20, 30]];
    expect(mutualCrossings(a, b, true, true)).toHaveLength(0);
  });
});

describe('measurement', () => {
  it('point-segment distance clamps to the endpoints', () => {
    expect(pointSegmentDistance([5, 5], [0, 0], [10, 0])).toBeCloseTo(5);
    expect(pointSegmentDistance([-5, 0], [0, 0], [10, 0])).toBeCloseTo(5);
    expect(pointSegmentDistance([15, 0], [0, 0], [10, 0])).toBeCloseTo(5);
  });
  it('path and loop length', () => {
    const sq: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pathLength(sq)).toBeCloseTo(30);
    expect(loopLength(sq)).toBeCloseTo(40);
  });
});

describe('transforms', () => {
  it('rotation is a bijection of order 4', () => {
    const p: Pt = [70, 30];
    let q = p;
    for (let i = 0; i < 4; i++) q = rotateAboutCentre(q, 90);
    expect(q[0]).toBeCloseTo(p[0]);
    expect(q[1]).toBeCloseTo(p[1]);
  });
  it('mirroring twice is the identity', () => {
    const p: Pt = [70, 30];
    expect(mirrorPoint(mirrorPoint(p, 'x'), 'x')).toEqual(p);
  });
});
