import { describe, it, expect } from 'vitest';
import {
  initialState, canAdd, canClose, evaluate, cycleLegal, startTapCloses,
  lengthUsed, allCrossings, weaveSignature, WIN_THRESHOLD,
} from '../../src/core/rules.js';
import { deriveTarget, validateLevel, parLength, type Level } from '../../src/core/level.js';
import type { Pt } from '../../src/core/geometry.js';

const ring = (n: number, r = 35): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return out;
};

const base = (over: Partial<Level> = {}): Level => validateLevel({
  id: 'test', mode: 'classic', chapter: 1,
  pegs: ring(6),
  threads: [{ color: '#000', sol: [0, 1, 2, 3, 4, 5] }],
  ...over,
});

function play(level: Level, pegs: number[]) {
  const st = initialState(level);
  for (const p of pegs) {
    const v = canAdd(level, st, p);
    if (!v.ok) return { st, failedAt: p, reason: v.reason };
    st.threads[0].pegs.push(p);
  }
  return { st, failedAt: -1, reason: 'ok' as const };
}

describe('basic legality', () => {
  it('accepts the authored solution', () => {
    const l = base();
    expect(cycleLegal(l, l.threads[0].sol)).toBe(true);
  });
  it('refuses to sit on the peg you are already on', () => {
    const l = base();
    const { st } = play(l, [0, 1]);
    expect(canAdd(l, st, 1).reason).toBe('repeat-peg');
  });
  it('a loop needs three pegs', () => {
    const l = base();
    const { st } = play(l, [0, 1]);
    expect(canClose(l, st).reason).toBe('too-short');
    st.threads[0].pegs.push(2);
    expect(canClose(l, st).ok).toBe(true);
  });
});

describe('crossings', () => {
  it('blocks a self-crossing when allowCross is off', () => {
    // Square corners 0=(0,0) 1=(10,0) 2=(10,10) 3=(0,10).
    const l = base({
      pegs: [[0, 0], [10, 0], [10, 10], [0, 10]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    expect(play(l, [0, 1, 2, 3]).failedAt).toBe(-1); // the ring is fine
    // 0->2 is a diagonal; 1->3 is the other diagonal and must be refused.
    const { st } = play(l, [0, 2, 1]);
    expect(canAdd(l, st, 3).reason).toBe('self-cross');
  });
  it('permits it when allowCross is on — that is how stars are made', () => {
    const l = base({
      pegs: ring(5), allowCross: true,
      threads: [{ color: '#000', sol: [0, 2, 4, 1, 3] }],
    });
    expect(cycleLegal(l, [0, 2, 4, 1, 3])).toBe(true);
  });
  it('start-tap closes only on non-crossing levels', () => {
    expect(startTapCloses(base())).toBe(true);
    expect(startTapCloses(base({ allowCross: true }))).toBe(false);
  });
});

describe('posts', () => {
  const l = base({
    pegs: [[10, 10], [90, 10], [90, 90], [10, 90]],
    posts: [[50, 50, 12]],
    threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
  });
  it('lets the string round the outside', () => {
    expect(cycleLegal(l, [0, 1, 2, 3])).toBe(true);
  });
  it('blocks the diagonal that runs through the post', () => {
    const { reason } = play(l, [0, 2]);
    expect(reason).toBe('post-blocked');
  });
});

describe('thorns', () => {
  const l = base({
    pegs: [[10, 10], [90, 10], [90, 90], [10, 90], [50, 50]],
    thorn: [4],
    threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
  });
  it('will not thread a thorn peg', () => {
    expect(play(l, [0, 4]).reason).toBe('thorn-peg');
  });
  it('pops when a segment grazes a thorn', () => {
    expect(play(l, [0, 2]).reason).toBe('thorn-contact');
  });
  it('rejects a level whose own solution touches a thorn', () => {
    expect(() => validateLevel({
      id: 'bad', mode: 'classic', chapter: 1,
      pegs: [[10, 10], [90, 10], [90, 90]], thorn: [2],
      threads: [{ color: '#000', sol: [0, 1, 2] }],
    })).toThrow(/thorn/);
  });
});

describe('budget', () => {
  const pegs = ring(6);
  it('refuses a peg the spool cannot reach', () => {
    // hexagon side 35; solution 0-1-2 costs 35+35+60.6 = 130.6, budget 140
    const l = base({ pegs, budget: 140, threads: [{ color: '#000', sol: [0, 1, 2] }] });
    const r = play(l, [0, 1, 2, 3, 4, 5]);
    expect(r.reason).toBe('over-budget');
    expect(r.failedAt).toBe(5); // 0..4 costs 140 exactly; the sixth peg is one too many
  });

  it('and refuses to tie off a loop that would overspend', () => {
    const l = base({ pegs, budget: 140, threads: [{ color: '#000', sol: [0, 1, 2] }] });
    const r = play(l, [0, 1, 2, 3]);
    expect(r.failedAt).toBe(-1);           // the walk fits
    expect(canClose(l, r.st).reason).toBe('over-budget'); // the closing edge does not
  });
  it('a level may not have a budget shorter than its own solution', () => {
    expect(() => validateLevel({
      id: 'bad', mode: 'classic', chapter: 2, budget: 5,
      pegs, threads: [{ color: '#000', sol: [0, 2, 4] }],
    })).toThrow(/shorter than its own solution/);
  });
  it('reports length used', () => {
    const l = base({ pegs });
    const { st } = play(l, [0, 1, 2]);
    expect(lengthUsed(l, st)).toBeGreaterThan(0);
    expect(lengthUsed(l, st)).toBeLessThan(parLength(l));
  });
});

describe('gold', () => {
  it('a shape-correct loop that misses a gold peg is not a win', () => {
    // Square target; the gold peg sits mid-edge so it can be skipped without
    // changing the region at all.
    const l = base({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 20]],
      gold: [4],
      threads: [{ color: '#000', sol: [0, 4, 1, 2, 3] }],
    });
    const target = deriveTarget(l).raster;
    const st = initialState(l);
    st.threads[0].pegs = [0, 1, 2, 3];
    st.threads[0].closed = true;
    const e = evaluate(l, st, target);
    expect(e.similarity).toBeGreaterThan(WIN_THRESHOLD); // the shape IS right
    expect(e.win).toBe(false);
    expect(e.fault).toBe('gold');
  });
  it('and the same loop through the gold peg is', () => {
    const l = base({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 20]],
      gold: [4],
      threads: [{ color: '#000', sol: [0, 4, 1, 2, 3] }],
    });
    const target = deriveTarget(l).raster;
    const st = initialState(l);
    st.threads[0].pegs = [0, 4, 1, 2, 3];
    st.threads[0].closed = true;
    expect(evaluate(l, st, target).win).toBe(true);
  });
});

describe('evaluation', () => {
  it('a correct solve scores exactly 1.000', () => {
    const l = base({ pegs: ring(5), allowCross: true, threads: [{ color: '#000', sol: [0, 2, 4, 1, 3] }] });
    const target = deriveTarget(l).raster;
    const st = initialState(l);
    st.threads[0].pegs = [0, 2, 4, 1, 3];
    st.threads[0].closed = true;
    const e = evaluate(l, st, target);
    expect(e.similarity).toBe(1);
    expect(e.win).toBe(true);
  });
  it('an open loop never wins', () => {
    const l = base();
    const target = deriveTarget(l).raster;
    const st = initialState(l);
    st.threads[0].pegs = [0, 1, 2, 3, 4, 5];
    expect(evaluate(l, st, target).fault).toBe('incomplete');
  });
  it('the pentagon does not pass as the pentagram', () => {
    const l = base({ pegs: ring(5), allowCross: true, threads: [{ color: '#000', sol: [0, 2, 4, 1, 3] }] });
    const target = deriveTarget(l).raster;
    const st = initialState(l);
    st.threads[0].pegs = [0, 1, 2, 3, 4];
    st.threads[0].closed = true;
    const e = evaluate(l, st, target);
    expect(e.win).toBe(false);
    expect(e.fault).toBe('shape');
  });
});

describe('apart', () => {
  it('forbids two threads from crossing when the level says stay apart', () => {
    const l = validateLevel({
      id: 'apart', mode: 'weave', chapter: 1, apart: true,
      pegs: [[10, 10], [40, 10], [40, 40], [10, 40], [60, 10], [90, 10], [90, 40], [60, 40]],
      threads: [
        { color: '#7A4FBF', sol: [0, 1, 2, 3] },
        { color: '#D98324', sol: [4, 5, 6, 7] },
      ],
    }) as Level;
    const st = initialState(l);
    st.threads[0].pegs = [0, 1, 2, 3];
    st.threads[0].closed = true;
    st.active = 1;
    st.threads[1].pegs = [5];
    // 5 -> 3 would slice straight through the first loop
    expect(canAdd(l, st, 3).reason).toBe('thread-cross');
  });
});

describe('weave', () => {
  it('crossing order is canonical regardless of where the player started', () => {
    const p: Pt[] = [[10, 10], [90, 10], [90, 90], [10, 90]];
    const a = allCrossings([[p[0], p[2], p[1], p[3]]]);
    const b = allCrossings([[p[1], p[3], p[0], p[2]]]);
    expect(a.length).toBe(b.length);
    expect(a.map((c) => c.point[0].toFixed(4))).toEqual(b.map((c) => c.point[0].toFixed(4)));
  });
  it('signature flips when the over/under choice flips', () => {
    const p: Pt[] = [[10, 10], [90, 10], [90, 90], [10, 90]];
    const x = allCrossings([[p[0], p[2], p[1], p[3]]]);
    expect(weaveSignature(x, new Set([0]))).not.toBe(weaveSignature(x, new Set()));
  });
});
