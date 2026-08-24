import { describe, it, expect } from 'vitest';
import { encodeLevel, decodeLevel, ShareCodeError } from '../../src/game/sharecode.js';
import { validateLevel, type Level } from '../../src/core/level.js';
import { deriveTarget } from '../../src/core/level.js';
import { similarity } from '../../src/core/region.js';

const ring = (n: number, r = 34): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push([Math.round((50 + r * Math.cos(a)) * 2) / 2, Math.round((50 + r * Math.sin(a)) * 2) / 2]);
  }
  return out;
};

const simple = validateLevel({
  id: 'x', mode: 'classic', chapter: 1,
  pegs: ring(6), threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3, 4, 5] }],
}) as Level;

describe('share codes', () => {
  it('round-trips a simple level', () => {
    const back = decodeLevel(encodeLevel(simple));
    expect(back.pegs).toEqual(simple.pegs);
    expect(back.threads[0].sol).toEqual(simple.threads[0].sol);
  });

  it('is short — a level fits in about thirty characters', () => {
    expect(encodeLevel(simple).length).toBeLessThanOrEqual(36);
  });

  it('preserves the target region exactly', () => {
    const back = decodeLevel(encodeLevel(simple));
    expect(similarity(deriveTarget(back).raster, deriveTarget(simple).raster)).toBe(1);
  });

  it('carries every mechanic', () => {
    const rich = validateLevel({
      id: 'rich', mode: 'classic', chapter: 9,
      pegs: [...ring(5, 36), [50, 50], [20, 20], [80, 80]],
      allowCross: true, apart: true, fog: true, mirror: 'y', rotateTarget: 90,
      budget: 400,
      posts: [[30, 70, 5.5]],
      gold: [1],
      thorn: [6],
      portals: [[2, 3]],
      rails: [{ peg: 4, a: [10, 10], b: [40, 40] }],
      threads: [{ color: '#7A4FBF', sol: [0, 2, 4, 1, 3] }],
    }) as Level;
    const back = decodeLevel(encodeLevel(rich));
    expect(back.allowCross).toBe(true);
    expect(back.apart).toBe(true);
    expect(back.fog).toBe(true);
    expect(back.mirror).toBe('y');
    expect(back.rotateTarget).toBe(90);
    expect(back.budget).toBe(400);
    expect(back.posts).toEqual([[30, 70, 5.5]]);
    expect(back.gold).toEqual([1]);
    expect(back.thorn).toEqual([6]);
    expect(back.portals).toEqual([[2, 3]]);
    expect(back.rails).toEqual([{ peg: 4, a: [10, 10], b: [40, 40] }]);
  });

  it('carries a second thread', () => {
    const two = validateLevel({
      id: 'two', mode: 'weave', chapter: 1,
      pegs: [[10, 10], [40, 10], [40, 40], [60, 60], [90, 60], [90, 90]],
      threads: [
        { color: '#7A4FBF', sol: [0, 1, 2] },
        { color: '#D98324', sol: [3, 4, 5] },
      ],
    }) as Level;
    const back = decodeLevel(encodeLevel(two));
    expect(back.threads).toHaveLength(2);
    expect(back.threads[1].sol).toEqual([3, 4, 5]);
  });

  it('rejects junk loudly rather than half-loading a broken board', () => {
    expect(() => decodeLevel('not-a-real-code!!!')).toThrow();
    expect(() => decodeLevel('')).toThrow(ShareCodeError);
    expect(() => decodeLevel(encodeLevel(simple).slice(0, 6))).toThrow();
  });

  it('rejects a code whose solution references a peg that is not there', () => {
    const code = encodeLevel(simple);
    // Corrupt the last solution byte to an out-of-range peg index.
    const bytes = Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    bytes[bytes.length - 1] = 200;
    const bad = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeLevel(bad)).toThrow();
  });
});
