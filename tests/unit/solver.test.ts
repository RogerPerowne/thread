import { describe, it, expect } from 'vitest';
import {
  canonicalCycle, findMatchingCycles, nearMisses, worstNearMiss,
  greedySolves, branchingFactor,
} from '../../src/core/solver.js';
import { deriveTarget, validateLevel, type Level } from '../../src/core/level.js';
import { WIN_THRESHOLD } from '../../src/core/rules.js';

const ring = (n: number, r = 35): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return out;
};

describe('canonical cycles', () => {
  it('collapses rotations', () => {
    expect(canonicalCycle([2, 3, 0, 1])).toBe(canonicalCycle([0, 1, 2, 3]));
  });
  it('collapses reversals — the same picture is the same solution', () => {
    expect(canonicalCycle([3, 2, 1, 0])).toBe(canonicalCycle([0, 1, 2, 3]));
  });
  it('keeps genuinely different orderings apart', () => {
    expect(canonicalCycle([0, 2, 1, 3])).not.toBe(canonicalCycle([0, 1, 2, 3]));
  });
});

describe('cycle search', () => {
  it('finds the pentagram and rejects the pentagon', () => {
    const l = validateLevel({
      id: 'star', mode: 'classic', chapter: 3, allowCross: true,
      pegs: ring(5), threads: [{ color: '#000', sol: [0, 2, 4, 1, 3] }],
    }) as Level;
    const target = deriveTarget(l).raster;
    const { matches } = findMatchingCycles(l, target, { budgetMs: 3000 });
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(canonicalCycle(m.sol)).toBe(canonicalCycle([0, 2, 4, 1, 3]));
    }
  });

  it('finds the intended solution among the shortest', () => {
    const l = validateLevel({
      id: 'hex', mode: 'classic', chapter: 1,
      pegs: ring(6), threads: [{ color: '#000', sol: [0, 1, 2, 3, 4, 5] }],
    }) as Level;
    const target = deriveTarget(l).raster;
    const { matches } = findMatchingCycles(l, target, { budgetMs: 3000 });
    expect(matches.length).toBeGreaterThan(0);
    const shortest = matches[0].length;
    const intended = matches.find((m) => canonicalCycle(m.sol) === canonicalCycle([0, 1, 2, 3, 4, 5]));
    expect(intended).toBeDefined();
    expect(intended!.length).toBeLessThanOrEqual(shortest + 1e-6);
  });

  it('respects the time budget rather than hanging', () => {
    const l = validateLevel({
      id: 'big', mode: 'classic', chapter: 1, allowCross: true,
      pegs: ring(14), threads: [{ color: '#000', sol: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }],
    }) as Level;
    const target = deriveTarget(l).raster;
    const t0 = Date.now();
    findMatchingCycles(l, target, { budgetMs: 300 });
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});

describe('near misses', () => {
  const l = validateLevel({
    id: 'sq', mode: 'classic', chapter: 1,
    pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 50]],
    threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
  }) as Level;

  it('generates drops, swaps, substitutions and insertions', () => {
    const n = nearMisses(l, [0, 1, 2, 3]);
    expect(n.length).toBeGreaterThan(5);
    for (const c of n) expect(canonicalCycle(c)).not.toBe(canonicalCycle([0, 1, 2, 3]));
  });

  it('no near miss of a well-formed level reaches the win threshold', () => {
    const target = deriveTarget(l).raster;
    const { sim } = worstNearMiss(l, [0, 1, 2, 3], target);
    expect(sim).toBeLessThan(WIN_THRESHOLD);
  });

  it('CATCHES the prototype bug: a hexagonal hole passing as a pentagonal one', () => {
    // Two concentric rings; the inner ring is the keyhole. Dropping one inner
    // peg changes a hexagonal hole into a pentagonal one — visually near
    // identical, and it scored 0.9885 in the prototype, which sailed past a
    // 0.975 threshold. At 0.995 it is correctly rejected.
    const outer = ring(6, 42);
    const inner = ring(6, 16);
    const l2 = validateLevel({
      id: 'donut', mode: 'classic', chapter: 4, allowCross: true,
      pegs: [...outer, ...inner],
      threads: [{ color: '#000', sol: [0, 1, 2, 3, 4, 5, 0, 6, 7, 8, 9, 10, 11] }],
    }) as Level;
    const target = deriveTarget(l2).raster;
    const { sim } = worstNearMiss(l2, l2.threads[0].sol, target);
    expect(sim).toBeGreaterThan(0.95);      // it really is that close
    expect(sim).toBeLessThan(WIN_THRESHOLD); // and 0.995 still rejects it
  });
});

describe('difficulty signals', () => {
  it('a plain ring is found by the greedy nearest-peg walk', () => {
    const l = validateLevel({
      id: 'ring', mode: 'classic', chapter: 1,
      pegs: ring(6), threads: [{ color: '#000', sol: [0, 1, 2, 3, 4, 5] }],
    }) as Level;
    expect(greedySolves(l, deriveTarget(l).raster)).toBe(true);
  });
  it('a star is not', () => {
    const l = validateLevel({
      id: 'star2', mode: 'classic', chapter: 3, allowCross: true,
      pegs: ring(5), threads: [{ color: '#000', sol: [0, 2, 4, 1, 3] }],
    }) as Level;
    expect(greedySolves(l, deriveTarget(l).raster)).toBe(false);
  });
  it('branching factor rises with peg count', () => {
    const small = validateLevel({
      id: 'a', mode: 'classic', chapter: 1, pegs: ring(4),
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    }) as Level;
    const big = validateLevel({
      id: 'b', mode: 'classic', chapter: 1, pegs: ring(10),
      threads: [{ color: '#000', sol: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }],
    }) as Level;
    expect(branchingFactor(big, big.threads[0].sol)).toBeGreaterThan(
      branchingFactor(small, small.threads[0].sol),
    );
  });
});
