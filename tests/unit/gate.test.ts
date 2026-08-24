import { describe, it, expect } from 'vitest';
import { checkLevel, auditRepetition, fingerprint, quickCheck, snaggablePeg, SNAG_RADIUS } from '../../src/core/gate.js';
import { initialRailPos } from '../../src/core/level.js';
import { validateLevel, type Level } from '../../src/core/level.js';
import { latticeWires } from '../../src/core/objective.js';

const ring = (n: number, r = 34, cx = 50, cy = 50): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push([Math.round((cx + r * Math.cos(a)) * 10) / 10, Math.round((cy + r * Math.sin(a)) * 10) / 10]);
  }
  return out;
};

const lv = (over: Partial<Level>): Level => validateLevel({
  id: 't', mode: 'classic', chapter: 1,
  pegs: ring(6), threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3, 4, 5] }],
  ...over,
}) as Level;

const failed = (l: Level, name: string) => {
  const r = checkLevel(l, { budgetMs: 300 });
  return r.checks.find((c) => c.name === name && !c.pass);
};

describe('check 1 — solvable', () => {
  it('passes a level whose authored solution really wins', () => {
    expect(failed(lv({}), 'solvable')).toBeUndefined();
  });
  it('fails when a post blocks the solution itself', () => {
    const l = lv({ posts: [[50, 16, 8]] });
    expect(failed(l, 'solvable')).toBeDefined();
  });
});

describe('check 2 — target derived from the solution', () => {
  it('rejects a target that covers almost nothing', () => {
    const l = lv({
      pegs: [[48, 48], [52, 48], [52, 52], [48, 52]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    expect(failed(l, 'derived-target')).toBeDefined();
  });
  it('rejects a target that swallows the board', () => {
    const l = lv({
      pegs: [[2, 2], [98, 2], [98, 98], [2, 98]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    expect(failed(l, 'derived-target')).toBeDefined();
  });
});

describe('check 3 — uniqueness', () => {
  it('fails when a shorter cut makes the same shape', () => {
    // A donut whose hole is off-centre. The region is the outer square minus
    // the inner one whichever corner the spoke is cut from — so cutting it
    // from the near corner is the same picture for far less string.
    const l = validateLevel({
      id: 'donut', mode: 'classic', chapter: 4, allowCross: true,
      pegs: [
        [15, 15], [85, 15], [85, 85], [15, 85],
        [25, 25], [55, 25], [55, 55], [25, 55],
      ],
      // Cut from the FAR corner: 2 -> 6 is 42.4 long, 0 -> 4 would be 14.1.
      threads: [{ color: '#000', sol: [2, 3, 0, 1, 2, 6, 7, 4, 5, 6] }],
    }) as Level;
    // The search is budget-bounded by design; a keyhole's space is large, so
    // this needs a real budget to find the cheaper cut.
    const r = checkLevel(l, { budgetMs: 1500 });
    const u = r.checks.find((c) => c.name === 'uniqueness');
    expect(u?.pass).toBe(false);
    expect(r.shorterCycle).toBeDefined();
  });

  it('passes when the cut really is the shortest one', () => {
    const l = validateLevel({
      id: 'donut2', mode: 'classic', chapter: 4, allowCross: true,
      pegs: [
        [15, 15], [85, 15], [85, 85], [15, 85],
        [25, 25], [55, 25], [55, 55], [25, 55],
      ],
      threads: [{ color: '#000', sol: [0, 1, 2, 3, 0, 4, 5, 6, 7, 4] }],
    }) as Level;
    const u = checkLevel(l, { budgetMs: 400 }).checks.find((c) => c.name === 'uniqueness');
    expect(u?.pass).toBe(true);
  });
});

describe('check 4 — threshold safety', () => {
  it('accepts a level whose near misses all fall short of 0.995', () => {
    expect(failed(lv({}), 'threshold')).toBeUndefined();
  });
  it('reports the worst near miss', () => {
    const r = checkLevel(lv({}), { budgetMs: 300 });
    expect(r.worstNearMiss).toBeGreaterThan(0);
    expect(r.worstNearMiss).toBeLessThan(0.995);
  });
});

describe('check 4 — a peg a drag would snag', () => {
  it('rejects a peg sitting on a solution edge', () => {
    // Peg 4 sits 2 units off the line from peg 0 to peg 1. Sweeping along that
    // edge picks it up, and the loop the player gets is not the one they drew.
    const l = lv({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 22]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    expect(failed(l, 'threshold')?.detail).toMatch(/snag/);
  });

  it('accepts the same peg once it is clear of the edge', () => {
    const l = lv({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 40]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    expect(failed(l, 'threshold')).toBeUndefined();
  });

  it('does not object to the endpoints of the edge itself', () => {
    expect(failed(lv({}), 'threshold')).toBeUndefined();
  });

  it('checks every thread, not just the first', () => {
    const l = lv({
      pegs: [[15, 15], [45, 15], [45, 45], [60, 60], [90, 60], [90, 90], [75, 60.5]],
      threads: [
        { color: '#000', sol: [0, 1, 2] },
        { color: '#111', sol: [3, 4, 5] },
      ],
    });
    expect(failed(l, 'threshold')?.detail).toMatch(/snag/);
  });
});

describe('check 5 — mechanics are load-bearing', () => {
  it('rejects a post that blocks nothing', () => {
    const l = lv({ posts: [[8, 92, 3]] });
    expect(failed(l, 'mechanics')?.detail).toMatch(/post/);
  });
  it('rejects allowCross when nothing crosses and no peg is revisited', () => {
    expect(failed(lv({ allowCross: true }), 'mechanics')?.detail).toMatch(/allowCross/);
  });
  it('rejects a gold peg the shape needs anyway', () => {
    const l = lv({ gold: [0] });
    expect(failed(l, 'mechanics')?.detail).toMatch(/gold/);
  });
  it('rejects a rotation the shape is invariant under', () => {
    // A regular hexagon looks the same at 180 degrees.
    const l = lv({ rotateTarget: 180 });
    expect(failed(l, 'mechanics')?.detail).toMatch(/rotation/);
  });
  it('accepts a post that really blocks a chord', () => {
    const l = lv({
      pegs: [[15, 15], [85, 15], [85, 85], [15, 85]],
      posts: [[50, 50, 9]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    expect(failed(l, 'mechanics')).toBeUndefined();
  });
});

describe('check 6 — anti-repetition', () => {
  const mk = (id: string, index: number, pegs: [number, number][], sol: number[]) =>
    fingerprint(validateLevel({ id, mode: 'classic', chapter: 1, pegs, threads: [{ color: '#000', sol }] }) as Level, index);

  it('flags two levels that are the same puzzle twice', () => {
    const a = mk('a', 0, ring(6), [0, 1, 2, 3, 4, 5]);
    const b = mk('b', 8, ring(6, 34.2), [0, 1, 2, 3, 4, 5]);
    const issues = auditRepetition([a, b]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('flags a shared topology signature inside five levels of each other', () => {
    const a = mk('a', 0, ring(6), [0, 1, 2, 3, 4, 5]);
    const b = mk('b', 2, ring(6, 20), [0, 1, 2, 3, 4, 5]);
    expect(auditRepetition([a, b]).some((i) => /topology signature/.test(i.reason))).toBe(true);
  });

  it('allows the same topology once the levels are far enough apart', () => {
    const a = mk('a', 0, ring(6), [0, 1, 2, 3, 4, 5]);
    const b = mk('b', 9, ring(6, 20), [0, 1, 2, 3, 4, 5]);
    expect(auditRepetition([a, b])).toHaveLength(0);
  });

  it('allows genuinely different shapes with the same peg count', () => {
    const a = mk('a', 0, ring(5, 36), [0, 1, 2, 3, 4]);
    const b = mk('b', 6, ring(5, 36), [0, 2, 4, 1, 3]);
    expect(auditRepetition([a, b])).toHaveLength(0);
  });
});

describe('the Workshop quick check', () => {
  it('accepts a sound level', () => {
    expect(quickCheck(lv({})).ok).toBe(true);
  });
  it('reports what is wrong rather than throwing', () => {
    const r = quickCheck(lv({ posts: [[8, 92, 3]] }));
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe('rails', () => {
  it('a rail peg starts at the end furthest from where the answer needs it', () => {
    const l = lv({ rails: [{ peg: 0, a: [10, 10], b: [50, 15] }] });
    const start = initialRailPos(l, 0);
    expect(start).toEqual([10, 10]);
  });
  it('and there is no rail position for a peg without a rail', () => {
    expect(initialRailPos(lv({}), 0)).toBeNull();
  });
});

describe('the snag radius', () => {
  it('reports which peg and which edge', () => {
    const l = lv({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 22]],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    });
    const s2 = snaggablePeg(l);
    expect(s2).not.toBeNull();
    expect(s2!.peg).toBe(4);
    expect(s2!.distance).toBeLessThan(SNAG_RADIUS);
  });
});

// ---------------------------------------------------------------------------

describe('check 6 — the objective is a real question', () => {
  const SQUARE: [number, number][] = [[20, 20], [80, 20], [80, 80], [20, 80]];

  it('rejects a silhouette whose obvious order gives the same shape', () => {
    const level = validateLevel({
      id: 'o1', mode: 'shadow', chapter: 1,
      pegs: SQUARE,
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
      objective: { kind: 'silhouette' },
    });
    const r = checkLevel(level, { budgetMs: 200 });
    const c = r.checks.find((x) => x.name === 'objective')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('telling you nothing');
  });

  it('accepts a silhouette whose obvious order gives a different shape', () => {
    // A pentagram: joined by angle it is a pentagon instead.
    const pegs: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * ((2 * Math.PI) / 5);
      pegs.push([+(50 + 34 * Math.cos(a)).toFixed(1), +(50 + 34 * Math.sin(a)).toFixed(1)]);
    }
    const level = validateLevel({
      id: 'o2', mode: 'shadow', chapter: 1,
      pegs,
      allowCross: true,
      threads: [{ color: '#000', sol: [0, 2, 4, 1, 3] }],
      objective: { kind: 'silhouette' },
    });
    const c = checkLevel(level, { budgetMs: 200 }).checks.find((x) => x.name === 'objective')!;
    expect(c.pass).toBe(true);
  });

  it('rejects a par level with nothing to waste a move on', () => {
    const level = validateLevel({
      id: 'o3', mode: 'par', chapter: 1,
      pegs: SQUARE,
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
      objective: { kind: 'par', segments: 4 },
    });
    const c = checkLevel(level, { budgetMs: 200 }).checks.find((x) => x.name === 'objective')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('no spare pegs');
  });

  it('rejects a corral the lazy fence already satisfies', () => {
    // Everything inside: fencing the whole board in meets it by accident.
    const level = validateLevel({
      id: 'o4', mode: 'corral', chapter: 1,
      pegs: [...SQUARE, [50, 50], [45, 55]] as [number, number][],
      thorn: [4, 5],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
      objective: { kind: 'enclose', inside: [4, 5], outside: [], maxSegments: 4 },
    });
    const c = checkLevel(level, { budgetMs: 200 }).checks.find((x) => x.name === 'objective')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('already satisfies it');
  });

  it('rejects a clue board with more than one answer', () => {
    const cols = 3, rows = 3;
    const pegs: [number, number][] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) pegs.push([20 + c * 20, 20 + r * 20]);
    const level = validateLevel({
      id: 'o5', mode: 'wire', chapter: 1,
      pegs,
      wires: latticeWires(cols, rows),
      threads: [{ color: '#000', sol: [0, 1, 5, 4] }],
      // The loop's true counts, with all but one taken away.
      objective: { kind: 'clue', cols, rows, clues: [4, null, null, null, null, null, null, null, null] },
    });
    const c = checkLevel(level, { budgetMs: 200 }).checks.find((x) => x.name === 'objective')!;
    // A 4 pins its own cell down completely, so this one IS unique.
    expect(c.pass).toBe(true);

    const loose = validateLevel({
      ...level, id: 'o6',
      objective: { kind: 'clue', cols, rows, clues: new Array(9).fill(null) },
    });
    const c2 = checkLevel(loose, { budgetMs: 200 }).checks.find((x) => x.name === 'objective')!;
    expect(c2.pass).toBe(false);
    expect(c2.detail).toContain('more than one loop');
  });
});
