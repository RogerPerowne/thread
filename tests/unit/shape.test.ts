import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  judge, clueHolds, asSettled, sightLine, rowCells, colCells, MAX_DEPTH, type Board,
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

  it('never looks deeper than the second shape in', () => {
    /*
     * "The first shape along" and "the one after it" are two things a person
     * can hold in their head while their eye runs down the line. "The fourth
     * shape along" is a thing you can only get by counting shapes that are not
     * on the board yet.
     */
    expect(MAX_DEPTH).toBe(2);
    for (const board of shipped) {
      for (const c of board.clues) {
        expect(c.depth, `${board.id} has a clue ${c.depth} deep`).toBeGreaterThanOrEqual(1);
        expect(c.depth, `${board.id} has a clue ${c.depth} deep`).toBeLessThanOrEqual(2);
      }
    }
    for (const board of shipped) {
      for (const c of allClues(board)) expect(c.depth).toBeLessThanOrEqual(2);
    }
  });

  it('gives up nothing at all below five shapes, and one clue at five', () => {
    /*
     * The whole argument for the cap, checked rather than asserted. A line
     * holds exactly `shapes` shapes, so the kth from one end is the
     * (shapes + 1 - k)th from the other — which means every reading of every
     * line is still a first or a second SOMEWHERE, right up to four shapes.
     * Five loses exactly the middle one, a third from both ends.
     */
    for (const shapes of [3, 4, 5]) {
      const lost = [];
      for (let depth = 1; depth <= shapes; depth++) {
        const mirrored = shapes + 1 - depth;
        if (depth > MAX_DEPTH && mirrored > MAX_DEPTH) lost.push(depth);
      }
      expect(lost, `${shapes} shapes`).toEqual(shapes === 5 ? [3] : []);
    }
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

  it('is solved by the shapes alone, with no blank ever drawn', () => {
    /*
     * A blank is the player's notation, not part of the answer. People put
     * them where the deduction needed them and nowhere else, so a board that
     * waits for a dot in every remaining cell is a board that makes you tidy
     * up after winning.
     */
    for (const board of shipped) {
      const shapesOnly = board.answer.map((v) => (v > 0 ? v : -1));
      expect(judge(board, shapesOnly).solved, `${board.id} wants its blanks drawn`).toBe(true);
      expect(judge(board, shapesOnly).progress).toBe(1);
    }
  });

  it('judges a clue as soon as its line holds all its shapes', () => {
    /*
     * A line holds exactly `shapes` shapes. The moment they are all down every
     * other cell in it IS blank, whether the player wrote that or not — so a
     * clue reading along it can be answered then, rather than waiting for
     * notation the answer does not need.
     */
    expect(asSettled([-1, 2, -1, 3], 2)).toEqual([0, 2, 0, 3]);
    expect(asSettled([-1, 2, -1, 3], 3)).toEqual([-1, 2, -1, 3]);

    const board = shipped.find((b) => b.clues.some((c) => c.side === 'left'))!;
    const clue = board.clues.find((c) => c.side === 'left')!;
    const line = sightLine(board, clue.side, clue.line);
    const cells: number[] = new Array(board.w * board.h).fill(-1);
    // Only the shapes of that row go down; every gap in it is left undecided.
    for (const i of line) if (board.answer[i] > 0) cells[i] = board.answer[i];
    const at = board.clues.indexOf(clue);
    expect(judge(board, cells).goodClues, 'the clue is still waiting').toContain(at);
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
    expect(s.cells[1]).toBe(-1);
  });

  it('measures progress in shapes placed, not cells settled', () => {
    /*
     * A blank is the player's own notation. Counting settled CELLS would have
     * the meter creep up as somebody dots gaps they never had to draw, which
     * is progress through their notes rather than through the puzzle.
     */
    const s = new ShapeSession(board);
    s.set(0, 0);
    expect(judge(board, s.cells).progress).toBe(0);

    const shapeAt = board.answer.findIndex((v) => v > 0);
    s.set(shapeAt, board.answer[shapeAt]);
    const need = board.shapes * board.h;
    expect(judge(board, s.cells).progress).toBeCloseTo(1 / need, 6);
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
    /*
     * Up to the point the board is finished, and no further. Blanks are the
     * player's own notation, so a board can be solved with cells still
     * undecided — and once it is there is no next deduction to name, only
     * gaps nobody has to draw.
     */
    const s = new ShapeSession(board);
    let steps = 0;
    for (let i = 0; i < board.answer.length && !s.verdict().solved; i++) {
      const hint = s.hint();
      expect(hint, `no hint with ${i} cells settled`).not.toBeNull();
      expect(hint!.reason.length).toBeGreaterThan(10);
      steps++;
      s.openGesture();
      s.set(i, board.answer[i]);
    }
    expect(steps).toBeGreaterThan(4);
    expect(s.verdict().solved).toBe(true);
    expect(s.hint(), 'a finished board is still being pointed at').toBeNull();
  });

  it('shows the answer, and the answer can be taken back', () => {
    const s = new ShapeSession(board);
    s.set(0, board.answer[0] === 1 ? 2 : 1);
    expect(s.verdict().solved).toBe(false);
    s.reveal();
    expect(s.verdict().solved).toBe(true);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.verdict().solved).toBe(false);
  });

  it('names the broken clue before it looks for the next deduction', () => {
    /*
     * A row of nothing but blanks breaks every clue that reads along it. There
     * is no next deduction from there, only a wrong cell behind you, and the
     * useful thing to say is which clue stopped holding — not which line is
     * tightest.
     */
    /* A board with a clue that actually reads along row 0, chosen rather than
       assumed: five hundred boards do not all carry one on the same line. */
    const withRowClue = shipped.find((b) => b.clues.some(
      (c) => (c.side === 'left' || c.side === 'right') && c.line === 0,
    ))!;
    const s = new ShapeSession(withRowClue);
    for (let c = 0; c < withRowClue.w; c++) s.set(c, 0);

    const broken = judge(withRowClue, s.cells).badClues;
    expect(broken.length, 'a row of blanks should break a clue').toBeGreaterThan(0);

    const hint = s.hint()!;
    const clue = withRowClue.clues[broken[0]];
    const line = sightLine(withRowClue, clue.side, clue.line).map((i) => `cell:${i}`);
    expect(hint.focus, 'the hint points somewhere else entirely').toEqual(line);
    expect(hint.move).toMatch(/take/i);
  });

  it('says a shape used twice is a shape used twice', () => {
    /*
     * Two of one shape side by side is a broken ROW. It is only the first
     * thing the hint says if no clue is broken as well, and on a board whose
     * top-edge clues read those two columns one usually is — so the board is
     * chosen to isolate the rule being checked rather than assumed to.
     */
    const clean = shipped.find((b) => {
      const t = new ShapeSession(b);
      t.set(0, 1);
      t.set(1, 1);
      return judge(b, t.cells).badClues.length === 0;
    })!;
    const s = new ShapeSession(clean);
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
