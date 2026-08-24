import { describe, it, expect } from 'vitest';
import { lattice, countSolutions, boundaryOf, pareClues, randomLoop } from '../../src/core/clue.js';
import { clueCountsOf, checkClues } from '../../src/core/objective.js';
import { makeRng } from '../../src/core/rng.js';

describe('the outline of a set of cells', () => {
  const lat = lattice(3, 3);

  it('traces one square', () => {
    const loop = boundaryOf(lat, new Set([0]));
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(4);
    expect(clueCountsOf(3, 3, loop!)[0]).toBe(4);
  });

  it('traces a two-cell domino as a six-corner loop', () => {
    const loop = boundaryOf(lat, new Set([0, 1]))!;
    expect(loop.length).toBe(6);
    const counts = clueCountsOf(3, 3, loop);
    expect(counts[0]).toBe(3);
    expect(counts[1]).toBe(3);
    expect(counts[2]).toBe(1);
  });

  it('refuses a set whose outline is not one simple loop', () => {
    // Two cells touching only at a corner pinch the outline to a point.
    expect(boundaryOf(lat, new Set([0, 4]))).toBeNull();
    // A ring of cells around a hole has two outlines, not one.
    const ring = new Set([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(boundaryOf(lattice(3, 3), ring)).toBeNull();
  });
});

describe('counting the loops that fit a set of clues', () => {
  const lat = lattice(3, 3);

  it('finds the one loop the full counts describe', () => {
    const loop = boundaryOf(lat, new Set([0, 1, 4]))!;
    const clues = clueCountsOf(3, 3, loop);
    const { count, first } = countSolutions(lat, clues, 5);
    expect(count).toBe(1);
    expect(checkClues({ cols: 3, rows: 3, clues }, first!).ok).toBe(true);
  });

  it('counts a loop once, not once per rotation or direction', () => {
    const loop = boundaryOf(lat, new Set([4]))!;
    expect(countSolutions(lat, clueCountsOf(3, 3, loop), 9).count).toBe(1);
  });

  it('finds several when the clues do not pin it down', () => {
    // A cell using one of its sides says almost nothing on its own. (A 4,
    // by contrast, pins the loop down completely: all four corners of that
    // cell are then spoken for, so the loop can only be the cell itself.)
    const clues: (number | null)[] = new Array(9).fill(null);
    clues[4] = 1;
    expect(countSolutions(lat, clues, 4).count).toBeGreaterThan(1);
  });

  it('a four is enough on its own, because it uses up its corners', () => {
    const clues: (number | null)[] = new Array(9).fill(null);
    clues[0] = 4;
    expect(countSolutions(lat, clues, 4).count).toBe(1);
  });

  it('finds none when the clues contradict each other', () => {
    const clues: (number | null)[] = new Array(9).fill(null);
    // A cell cannot use four sides while its neighbour uses none of the
    // shared one and all of its own.
    clues[0] = 4;
    clues[1] = 4;
    clues[3] = 4;
    expect(countSolutions(lat, clues, 3).count).toBe(0);
  });
});

describe('paring clues down', () => {
  it('keeps the answer unique while taking numbers away', () => {
    const rng = makeRng('pare');
    const lat = lattice(4, 4);
    const loop = boundaryOf(lat, new Set([0, 1, 4, 5, 6, 9]))!;
    const full = clueCountsOf(4, 4, loop);
    const pared = pareClues(lat, full, rng, { keep: 4 });

    expect(pared.filter((c) => c !== null).length).toBeLessThan(full.length);
    expect(countSolutions(lat, pared, 2).count).toBe(1);
    // Every clue left is still true of the loop it came from.
    expect(checkClues({ cols: 4, rows: 4, clues: pared }, loop).ok).toBe(true);
  });
});

describe('random loops', () => {
  it('produces simple loops that the clue counts then pin down', () => {
    const rng = makeRng('loops');
    const lat = lattice(4, 4);
    let made = 0;
    for (let i = 0; i < 40 && made < 8; i++) {
      const loop = randomLoop(lat, rng, 3 + rng.int(5));
      if (!loop) continue;
      made++;
      expect(new Set(loop).size).toBe(loop.length);
      expect(countSolutions(lat, clueCountsOf(4, 4, loop), 2).count).toBe(1);
    }
    expect(made).toBeGreaterThan(3);
  });
});
