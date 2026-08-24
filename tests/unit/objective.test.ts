import { describe, it, expect } from 'vitest';
import {
  pointInLoop, distanceToLoop, checkEnclose, checkClues, clueCountsOf,
  latticeWires, latticeIndex, cellWires, usedWires,
} from '../../src/core/objective.js';
import { validateLevel, objectiveOf, mechanicsOf, type Level } from '../../src/core/level.js';
import { evaluate, initialState, canAdd, hasWire } from '../../src/core/rules.js';
import { deriveTarget } from '../../src/core/level.js';
import type { Pt } from '../../src/core/geometry.js';

const SQUARE: Pt[] = [[20, 20], [80, 20], [80, 80], [20, 80]];

describe('inside and outside', () => {
  it('knows a point in the middle from one outside', () => {
    expect(pointInLoop([50, 50], SQUARE)).toBe(true);
    expect(pointInLoop([10, 50], SQUARE)).toBe(false);
    expect(pointInLoop([50, 90], SQUARE)).toBe(false);
  });

  it('uses the even-odd rule, so a star has a hollow middle only where it should', () => {
    // A pentagram: the centre is inside by even-odd (crossed twice... and so
    // reads as outside), the points are inside.
    const pts: Pt[] = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + ((i * 2) % 5) * ((2 * Math.PI) / 5);
      pts.push([50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)]);
    }
    expect(pointInLoop([50, 50], pts)).toBe(false);
    expect(pointInLoop([50, 16], pts)).toBe(true);
  });

  it('measures how near a point comes to the outline', () => {
    expect(distanceToLoop([50, 50], SQUARE)).toBeCloseTo(30, 5);
    expect(distanceToLoop([20, 50], SQUARE)).toBeCloseTo(0, 5);
  });
});

describe('enclose', () => {
  const pegs: Pt[] = [...SQUARE, [50, 50], [5, 5], [50, 40]];
  const spec = { kind: 'enclose', inside: [4, 6], outside: [5], maxSegments: 6 } as const;

  it('passes when the marked pegs land on the right sides', () => {
    const v = checkEnclose(spec, pegs, SQUARE, 4);
    expect(v.ok).toBe(true);
    expect(v.score).toBe(1);
  });

  it('names the pegs on the wrong side rather than just failing', () => {
    const tiny: Pt[] = [[45, 45], [55, 45], [55, 55], [45, 55]];
    const v = checkEnclose(spec, pegs, tiny, 4);
    expect(v.ok).toBe(false);
    expect(v.wrongInside).toEqual([6]);
    expect(v.wrongOutside).toEqual([]);
    expect(v.score).toBeCloseTo(2 / 3, 5);
  });

  it('counts the segment budget', () => {
    const v = checkEnclose(spec, pegs, SQUARE, 7);
    expect(v.ok).toBe(false);
    expect(v.overBudget).toBe(true);
  });
});

describe('the lattice a clue level is played on', () => {
  it('wires every neighbour and nothing else', () => {
    const w = latticeWires(2, 2);
    // 2x2 cells: 3x3 pegs, 12 wires.
    expect(w.length).toBe(12);
    const has = (a: number, b: number) => w.some(([x, y]) => x === a && y === b);
    expect(has(0, 1)).toBe(true);
    expect(has(0, 3)).toBe(true);
    expect(has(0, 4)).toBe(false); // the diagonal is not a wire
  });

  it('gives each cell its own four sides', () => {
    const s = cellWires(2, 0, 0).map(([a, b]) => `${a}-${b}`);
    expect(s).toEqual(['0-1', '3-4', '0-3', '1-4']);
  });

  it('counts the sides a loop uses', () => {
    // The unit square in the top-left of a 2x2 board.
    const loop = [latticeIndex(2, 0, 0), latticeIndex(2, 0, 1), latticeIndex(2, 1, 1), latticeIndex(2, 1, 0)];
    expect(usedWires(loop).size).toBe(4);
    expect(clueCountsOf(2, 2, loop)).toEqual([4, 1, 1, 0]);
  });

  it('checks clues, and says which cells are wrong', () => {
    const loop = [0, 1, 4, 3];
    const spec = { kind: 'clue', cols: 2, rows: 2, clues: [4, 1, 1, 0] } as const;
    expect(checkClues(spec, loop).ok).toBe(true);
    const bad = { kind: 'clue', cols: 2, rows: 2, clues: [3, 1, null, 0] } as const;
    const v = checkClues(bad, loop);
    expect(v.ok).toBe(false);
    expect(v.wrong).toEqual([0]);
    expect(v.score).toBeCloseTo(2 / 3, 5);
  });
});

// ---------------------------------------------------------------------------

function play(level: Level, order: number[]) {
  const st = initialState(level);
  for (const p of order) {
    const verdict = canAdd(level, st, p);
    if (!verdict.ok) return { st, rejected: verdict.reason };
    st.threads[0].pegs.push(p);
  }
  st.threads[0].closed = true;
  return { st, rejected: null as string | null };
}

describe('objectives decide the win', () => {
  const base = {
    id: 't', mode: 'classic' as const, chapter: 1,
    pegs: [...SQUARE, [50, 50], [5, 5]] as [number, number][],
    threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
  };

  it('a par level accepts the short way round', () => {
    const level = validateLevel({ ...base, objective: { kind: 'par', par: 240.001 } });
    const target = deriveTarget(level).raster;
    const r = evaluate(level, play(level, [0, 1, 2, 3]).st, target);
    expect(r.win).toBe(true);
    expect(r.lengthUsed).toBeCloseTo(240, 6);
  });

  it('a par level refuses a longer order even when the shape still matches', () => {
    // A peg just inside the top edge. Going through it leaves the region the
    // same to within the win threshold, but costs a little more string.
    const detour = {
      ...base,
      pegs: [[10, 10], [90, 10], [90, 90], [10, 90], [50, 10.5]] as [number, number][],
      threads: [{ color: '#000', sol: [0, 1, 2, 3] }],
    };
    const level = validateLevel({ ...detour, objective: { kind: 'par', par: 320.001 } });
    const target = deriveTarget(level).raster;

    const direct = evaluate(level, play(level, [0, 1, 2, 3]).st, target);
    expect(direct.win).toBe(true);

    const wandered = evaluate(level, play(level, [0, 4, 1, 2, 3]).st, target);
    expect(wandered.similarity).toBeGreaterThanOrEqual(0.995);
    expect(wandered.lengthUsed).toBeGreaterThan(320.001);
    expect(wandered.win).toBe(false);
    expect(wandered.fault).toBe('par');
  });

  it('rejects a par that is shorter than the level\'s own solution', () => {
    expect(() => validateLevel({ ...base, objective: { kind: 'par', par: 200 } })).toThrow();
  });

  it('an enclose level ignores the shape and judges the rule', () => {
    const level = validateLevel({
      ...base,
      objective: { kind: 'enclose', inside: [4], outside: [5], maxSegments: 4 },
    });
    const target = deriveTarget(level).raster;
    const r = evaluate(level, play(level, [0, 1, 2, 3]).st, target);
    expect(r.win).toBe(true);
    expect(objectiveOf(level).kind).toBe('enclose');
    expect(mechanicsOf(level)).toContain('enclose');
  });

  it('an enclose level fails, and says which peg was on the wrong side', () => {
    const pegs = [...SQUARE, [50, 50], [50, 40]] as [number, number][];
    const level = validateLevel({
      ...base,
      pegs,
      objective: { kind: 'enclose', inside: [4], outside: [5], maxSegments: 4 },
    });
    const target = deriveTarget(level).raster;
    const r = evaluate(level, play(level, [0, 1, 2, 3]).st, target);
    expect(r.win).toBe(false);
    expect(r.fault).toBe('enclose');
    expect(r.wrongPegs).toEqual([5]);
  });
});

describe('wires', () => {
  const pegs: [number, number][] = [];
  for (let r = 0; r <= 2; r++) for (let c = 0; c <= 2; c++) pegs.push([20 + c * 30, 20 + r * 30]);
  const wires = latticeWires(2, 2);
  const level = validateLevel({
    id: 'w', mode: 'wire' as const, chapter: 1,
    pegs,
    wires,
    threads: [{ color: '#000', sol: [0, 1, 4, 3] }],
    objective: { kind: 'clue', cols: 2, rows: 2, clues: [4, 1, 1, 0] },
  });

  it('refuses a move that is not along a wire', () => {
    expect(hasWire(level, 0, 4)).toBe(false);
    const st = initialState(level);
    st.threads[0].pegs.push(0);
    expect(canAdd(level, st, 4).ok).toBe(false);
    expect(canAdd(level, st, 4).reason).toBe('no-wire');
    expect(canAdd(level, st, 1).ok).toBe(true);
  });

  it('wins when every clue is satisfied', () => {
    const target = deriveTarget(level).raster;
    expect(evaluate(level, play(level, [0, 1, 4, 3]).st, target).win).toBe(true);
  });

  it('rejects a solution that does not run on the wires', () => {
    expect(() => validateLevel({ ...level, threads: [{ color: '#000', sol: [0, 4, 8, 6] }] })).toThrow();
  });

  it('declares its mechanics', () => {
    expect(mechanicsOf(level)).toContain('clue');
    expect(mechanicsOf(level)).toContain('wire');
  });
});
