import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  judge, clueHolds, sightLine, rowCells, colCells, type Board,
} from '../../src/games/shape/model.js';
import { search, isUnique, analyse, arrangements, allClues } from '../../src/games/shape/solve.js';
import { fill, makeShape, scoreOf, bandOf } from '../../src/games/shape/design.js';
import { ShapeSession } from '../../src/games/shape/session.js';
import { glyphPath, GLYPHS } from '../../src/games/shape/glyphs.js';
import { makeRng } from '../../src/platform/rng.js';

const shipped = JSON.parse(readFileSync('puzzles/shape.json', 'utf8')) as (Board & {
  id: string; band: string; score: number; chapter: number;
})[];

describe('what a clue says', () => {
  it('waits before it calls a line wrong', () => {
    /*
     * The three-value answer is the point. A clue about the second shape along
     * cannot be broken until the cells before it are settled, and a board that
     * goes red before then is a board whose red is noise. -1 is undecided.
     */
    expect(clueHolds([-1, 2, 0], 1, 2)).toBeNull();
    expect(clueHolds([0, 2, 0], 1, 2)).toBe(true);
    expect(clueHolds([0, 3, 0], 1, 2)).toBe(false);
    expect(clueHolds([0, 3, -1], 2, 2)).toBeNull();
    expect(clueHolds([2, 3, 0], 2, 3)).toBe(true);
    // A line with fewer shapes than the clue needs, all settled, is wrong.
    expect(clueHolds([0, 0, 2], 2, 3)).toBe(false);
  });

  it('reads each side from the right end', () => {
    const b = shipped[0];
    const left = sightLine(b, 'left', 0);
    const right = sightLine(b, 'right', 0);
    expect(left).toEqual([...right].reverse());
    const top = sightLine(b, 'top', 0);
    const bottom = sightLine(b, 'bottom', 0);
    expect(top).toEqual([...bottom].reverse());
    expect(left[0]).toBe(0);
    expect(top[0]).toBe(0);
  });
});

describe('the arrangements', () => {
  it('places one of each shape and fills the rest with blanks', () => {
    const all = arrangements(5, 3);
    // 5 places, choose 3 of them in order for 3 distinct shapes: 5*4*3 = 60.
    expect(all).toHaveLength(60);
    for (const row of all) {
      expect(row).toHaveLength(5);
      const shapes = row.filter((v) => v > 0);
      expect(new Set(shapes).size).toBe(3);
      expect(shapes.sort()).toEqual([1, 2, 3]);
    }
  });

  it('gives the same array back rather than working it out again', () => {
    // Cached because the clue minimiser asks a hundred times per board.
    expect(arrangements(6, 4)).toBe(arrangements(6, 4));
  });
});

describe('judging a board', () => {
  const b = shipped[0];

  it('accepts the answer it was built from', () => {
    for (const board of shipped) {
      expect(judge(board, board.answer.slice()).solved, `${board.id} rejects its own answer`)
        .toBe(true);
    }
  });

  it('says nothing about an empty board', () => {
    const j = judge(b, new Array(b.w * b.h).fill(-1));
    expect(j.faults).toEqual([]);
    expect(j.badClues).toEqual([]);
    expect(j.solved).toBe(false);
  });

  it('marks a shape used twice in a line at once', () => {
    const cells = new Array(b.w * b.h).fill(-1);
    cells[0] = 1;
    cells[1] = 1;
    const j = judge(b, cells);
    expect(j.badRows).toContain(0);
    expect(j.faults).toContain('twice');
  });

  it('refuses a full board of blanks', () => {
    /*
     * Every clue is satisfied vacuously and no line has anything twice, so
     * "no faults" is not enough — a solved board needs one of each shape in
     * every line, counted exactly.
     */
    const j = judge(b, new Array(b.w * b.h).fill(0));
    expect(j.solved).toBe(false);
  });
});

describe('every shipped board', () => {
  it('has exactly one filling, re-proven from the shipped bytes', () => {
    for (const board of shipped) {
      const found = search(board, 2);
      expect(isUnique(found), `${board.id} has ${found.count} answers`).toBe(true);
      expect(found.first).toEqual(board.answer);
    }
  });

  it('carries no clue it does not need', () => {
    /*
     * The designer removed each clue, found the board stopped being unique,
     * and put it back. A clue that could go is a clue the player reads for
     * nothing.
     */
    for (const board of shipped.slice(0, 30)) {
      for (let i = 0; i < board.clues.length; i++) {
        const without = board.clues.filter((_, k) => k !== i);
        expect(
          isUnique(search({ ...board, clues: without }, 2)),
          `${board.id} does not need clue ${i}`,
        ).toBe(false);
      }
    }
  });

  it('marks each edge position at most once', () => {
    // Two arrows along the same line from the same end would sit on top of
    // each other, so the layout can put one clue per slot and stop worrying.
    for (const board of shipped) {
      const seen = new Set<string>();
      for (const c of board.clues) {
        const key = `${c.side}:${c.line}`;
        expect(seen.has(key), `${board.id} has two clues on ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('carries the band its own measured score puts it in', () => {
    for (const board of shipped) {
      const score = scoreOf(analyse(board));
      expect(Math.abs(score - board.score), `${board.id} scores ${score}`).toBeLessThan(0.11);
      expect(bandOf(score), `${board.id} is banded wrong`).toBe(board.band);
    }
  });

  it('is a different puzzle from every other', () => {
    const seen = new Set<string>();
    for (const board of shipped) {
      const key = board.clues.map((c) => `${c.side}${c.line}${c.shape}${c.depth}`).sort().join('|');
      expect(seen.has(key), `${board.id} repeats an earlier board`).toBe(false);
      seen.add(key);
    }
  });

  it('gets harder up the ladder', () => {
    const byChapter = new Map<number, number[]>();
    for (const b of shipped) {
      if (!byChapter.has(b.chapter)) byChapter.set(b.chapter, []);
      byChapter.get(b.chapter)!.push(b.score);
    }
    const means = [...byChapter.entries()].sort((a, b) => a[0] - b[0])
      .map(([, xs]) => xs.reduce((s, x) => s + x, 0) / xs.length);
    expect(means[means.length - 1]).toBeGreaterThan(means[0] * 1.4);
  });
});

describe('the solver', () => {
  it('knows the difference between one answer and one so far', () => {
    /*
     * The bug this exists for: a search that runs out of budget has found one
     * answer and stopped looking, which is not the same as there being one.
     * Treating them alike is how a generator removes the clue that was holding
     * the board together, and the gate caught exactly that.
     */
    const board = shipped.find((b) => b.w >= 6) ?? shipped[shipped.length - 1];
    const cut = search({ ...board, clues: [] }, 2, 200);
    expect(cut.exhausted).toBe(false);
    expect(isUnique(cut)).toBe(false);
    expect(isUnique(search(board, 2))).toBe(true);
  });

  it('finds a filled grid for every size shipped', () => {
    const rng = makeRng('fill-test');
    for (const [w, h, shapes] of [[4, 4, 3], [5, 5, 4], [6, 6, 4], [7, 7, 5]] as const) {
      const grid = fill({ w, h, shapes }, rng);
      expect(grid, `no fill for ${w}x${h} with ${shapes}`).not.toBeNull();
      const board: Board = { w, h, shapes, clues: [], answer: grid! };
      for (let r = 0; r < h; r++) {
        const line = rowCells(board, r).map((i) => grid![i]).filter((v) => v > 0).sort();
        expect(line).toEqual([1, 2, 3, 4, 5].slice(0, shapes));
      }
      for (let c = 0; c < w; c++) {
        const line = colCells(board, c).map((i) => grid![i]).filter((v) => v > 0).sort();
        expect(line).toEqual([1, 2, 3, 4, 5].slice(0, shapes));
      }
    }
  });

  it('refuses a recipe with more shapes than places', () => {
    expect(fill({ w: 3, h: 3, shapes: 4 }, makeRng('x'))).toBeNull();
  });

  it('reads every clue off the answer and no others', () => {
    const board = shipped[0];
    for (const clue of allClues(board)) {
      const seen = sightLine(board, clue.side, clue.line)
        .map((i) => board.answer[i]).filter((v) => v > 0);
      expect(seen[clue.depth - 1]).toBe(clue.shape);
    }
  });
});

describe('the shapes', () => {
  it('draws a different mark for each', () => {
    const seen = new Set<string>();
    for (let n = 1; n <= GLYPHS.length; n++) {
      const d = glyphPath(n, 10);
      expect(d.length).toBeGreaterThan(10);
      expect(seen.has(d), `shape ${n} draws the same mark as another`).toBe(false);
      seen.add(d);
    }
  });
});

describe('playing', () => {
  const board = shipped[0];

  it('keeps "empty" and "not yet" apart', () => {
    /*
     * Without the distinction half the deduction cannot be written down: a
     * cell the player has settled as holding nothing is a fact, and a cell
     * they have not looked at is not.
     */
    const s = new ShapeSession(board);
    expect(s.cells.every((v) => v === -1)).toBe(true);
    s.set(0, 0);
    expect(s.cells[0]).toBe(0);
    expect(judge(board, s.cells).progress).toBeGreaterThan(0);
  });

  it('comes back from a save exactly as it was left', () => {
    const s = new ShapeSession(board);
    s.openGesture();
    s.set(0, 1);
    s.openGesture();
    s.set(3, 0);
    const back = new ShapeSession(board);
    expect(back.load(s.save())).toBe(true);
    expect(back.cells).toEqual(s.cells);
  });

  it('refuses a save that belongs to another board', () => {
    const other = shipped.find((b) => b.id !== board.id && b.w === board.w)!;
    const s = new ShapeSession(board);
    s.set(0, 1);
    expect(new ShapeSession(other).load(s.save())).toBe(false);
  });

  it('undoes a whole gesture, not half of one', () => {
    const s = new ShapeSession(board);
    s.openGesture();
    s.set(0, 1);
    s.set(1, 2);
    s.undo();
    expect(s.cells[0]).toBe(-1);
    expect(s.cells[1]).toBe(-1);
  });

  it('has something useful to say at every point of a solve', () => {
    const s = new ShapeSession(board);
    for (let i = 0; i < board.answer.length; i++) {
      const hint = s.hint();
      expect(hint, `no hint with ${i} cells settled`).not.toBeNull();
      expect(hint!.reason.length).toBeGreaterThan(10);
      s.openGesture();
      s.set(i, board.answer[i]);
    }
    expect(s.verdict().solved).toBe(true);
  });

  it('names the broken clue before it looks for the next deduction', () => {
    /*
     * A row of nothing but blanks breaks every clue that reads along it. There
     * is no next deduction from there, only a wrong cell behind you, and the
     * useful thing to say is which clue stopped holding — not which line is
     * tightest.
     */
    const s = new ShapeSession(board);
    for (let c = 0; c < board.w; c++) s.set(c, 0);

    const broken = judge(board, s.cells).badClues;
    expect(broken.length, 'a row of blanks should break a clue').toBeGreaterThan(0);

    const hint = s.hint()!;
    const clue = board.clues[broken[0]];
    const line = sightLine(board, clue.side, clue.line).map((i) => `cell:${i}`);
    expect(hint.focus, 'the hint points somewhere else entirely').toEqual(line);
    expect(hint.move).toMatch(/take/i);
  });

  it('says a shape used twice is a shape used twice', () => {
    const s = new ShapeSession(board);
    s.set(0, 1);
    s.set(1, 1);
    const hint = s.hint()!;
    expect(hint.reason).toMatch(/twice/i);
  });
});

describe('the designer', () => {
  it('builds a board whose every clue is needed', () => {
    const rng = makeRng('designer-test');
    let made = 0;
    for (let i = 0; i < 40 && made < 3; i++) {
      const b = makeShape({ w: 4, h: 4, shapes: 3 }, rng);
      if (!b) continue;
      made++;
      expect(isUnique(search(b, 2))).toBe(true);
      for (let k = 0; k < b.clues.length; k++) {
        const without = b.clues.filter((_, j) => j !== k);
        expect(isUnique(search({ ...b, clues: without }, 2))).toBe(false);
      }
    }
    expect(made).toBeGreaterThan(0);
  });
});
