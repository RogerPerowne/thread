import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  judge, neighbours, wants, adjacency, stepsFrom, type Zig,
} from '../../src/games/zigzag/model.js';
import { solve } from '../../src/games/zigzag/solve.js';
import { makeZig, hamiltonian, orthogonalPossible } from '../../src/games/zigzag/design.js';
import { makeRng } from '../../src/platform/rng.js';
import { ZigSession } from '../../src/games/zigzag/session.js';

/**
 * A board that definitely exists.
 *
 * Most numberings admit more than one line and are thrown away, so asking the
 * designer once and asserting on the result is a test that fails on the seeds
 * where it happened to say no. Ask until it says yes.
 */
function aBoard(tag: string, w = 5, h = 5): Zig {
  for (let i = 0; i < 60; i++) {
    const made = makeZig({ w, h, sequence: [1, 2, 3, 4], diagonal: true }, makeRng(`${tag}/${i}`));
    if (made) return made.zig;
  }
  throw new Error(`no ${w}x${h} board from "${tag}"`);
}

/*
 * A three by three built the way the designer builds one: take the path
 * 0,3,6,7,4,1,2,5,8 and number each cell by where it falls on it. Numbering a
 * board by hand and hoping is how you write a test that asserts against a
 * board with no answer at all.
 */
const board = (over: Partial<Zig> = {}): Zig => ({
  w: 3, h: 3, sequence: [1, 2, 3, 4], start: 0, finish: 8,
  cells: [1, 2, 3, 2, 1, 4, 3, 4, 1],
  answer: [0, 3, 6, 7, 4, 1, 2, 5, 8], ...over,
});

describe('where a line may step', () => {
  it('goes only up, down, left and right when the board forbids corners', () => {
    /*
     * The game's biggest difficulty lever, and it is one rule rather than a
     * different engine. Four ways out of a cell, about one of them carrying
     * the next number, so most steps are forced and the line nearly draws
     * itself. Measured against the same boards with corners open it is the
     * difference between 47 and 90.
     */
    expect(neighbours(3, 3, 4, false).sort((a, b) => a - b)).toEqual([1, 3, 5, 7]);
    expect(neighbours(3, 3, 0, false).sort((a, b) => a - b)).toEqual([1, 3]);
    // Absent means eight, because that is what every board built before the
    // flag existed meant.
    expect(neighbours(3, 3, 4)).toHaveLength(8);
  });

  it('knows which boards have no straight-only answer at all', () => {
    /*
     * Parity, not a search that gives up. A line stepping only orthogonally
     * changes chessboard colour every step, so a path over all w*h cells has
     * endpoints of the same colour when w*h is odd and opposite when it is
     * even. Start and finish are opposite corners, and exactly one shape
     * fails: both sides even. Six by six has no answer and never will.
     */
    expect(orthogonalPossible(6, 6)).toBe(false);
    expect(orthogonalPossible(8, 6)).toBe(false);
    expect(orthogonalPossible(5, 5)).toBe(true);
    expect(orthogonalPossible(6, 5)).toBe(true);
    expect(orthogonalPossible(7, 6)).toBe(true);

    // And the designer refuses rather than hunting for something impossible.
    // Refusing has to be instant: left to search, one of these boards spends
    // its entire budget proving a negative parity already knew.
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      const made = makeZig(
        { w: 6, h: 6, sequence: [1, 2, 3, 4, 5], diagonal: false }, makeRng(`imp/${i}`),
      );
      expect(made, 'a 6x6 straight-only board came out of nowhere').toBeNull();
    }
    expect(Date.now() - t0, 'the designer searched instead of refusing').toBeLessThan(200);
  });

  it('reaches all eight neighbours, and stops at the edge', () => {
    expect(neighbours(3, 3, 4).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(neighbours(3, 3, 0).sort((a, b) => a - b)).toEqual([1, 3, 4]);
    expect(neighbours(3, 3, 8).sort((a, b) => a - b)).toEqual([4, 5, 7]);
  });

  it('gives every cell its own list', () => {
    const a = adjacency(4, 3);
    expect(a).toHaveLength(12);
    expect(a[5]).toHaveLength(8);
  });

  it('runs the sequence round and round', () => {
    const b = board();
    expect([0, 1, 2, 3, 4, 5].map((i) => wants(b, i))).toEqual([1, 2, 3, 4, 1, 2]);
  });
});

describe('judging a line', () => {
  /*
   * A three by three where 0 -> 4 -> 8 is legal by number and by adjacency but
   * leaves six cells behind. That is the case worth having a test for: the
   * line is not WRONG, it is unfinished, and the two have to read differently.
   */
  const b = board();

  it('accepts a line that covers the board in order', () => {
    const j = judge(b, b.answer);
    expect(j.faults).toEqual([]);
    expect(j.solved).toBe(true);
  });

  it('refuses a number out of the run', () => {
    // 0 -> 4 is a 1 followed by a 1, and the second cell has to be a 2.
    expect(judge(b, [0, 4], true).faults).toContain('order');
  });

  it('refuses a jump between cells that do not touch', () => {
    const wide = board({ w: 4, h: 1, cells: [1, 2, 3, 4], finish: 3 });
    expect(judge(wide, [0, 1, 2, 3]).faults).not.toContain('apart');
    const skip = board({ w: 4, h: 1, cells: [1, 2, 2, 4], finish: 3 });
    expect(judge(skip, [0, 2], true).faults).toContain('apart');
  });

  it('refuses a cell used twice', () => {
    const there = board({ w: 3, h: 1, cells: [1, 2, 1], finish: 2 });
    expect(judge(there, [0, 1, 0], true).faults).toContain('repeat');
  });

  it('wants every cell, and the right last one', () => {
    const short = judge(b, [0, 1, 2]);
    expect(short.faults).toContain('left');
    expect(short.faults).toContain('ends');
    expect(short.solved).toBe(false);
  });

  it('says nothing about leftovers while the line is still being drawn', () => {
    expect(judge(b, [0, 1], true).faults).not.toContain('left');
    expect(judge(b, [0, 1], true).faults).not.toContain('ends');
  });

  it('counts progress by cells reached', () => {
    expect(judge(b, [0, 1, 2], true).progress).toBeCloseTo(3 / 9);
  });
});

describe('the solver', () => {
  it('finds the line the designer built', () => {
    const zig = aBoard('t');
    const found = solve(zig, 2);
    expect(found.exhausted).toBe(false);
    expect(found.paths).toHaveLength(1);
    expect(found.paths[0]).toEqual(zig.answer);
  });

  it('finds every line when a board has more than one', () => {
    /*
     * Two by two, every cell a 1, sequence of just 1: the numbers constrain
     * nothing, so every corner-to-corner path is a line. There are two, and a
     * solver that stopped at the first would be no use for proving uniqueness
     * — which is the only thing the designer asks it for.
     */
    const loose: Zig = board({
      w: 2, h: 2, cells: [1, 1, 1, 1], sequence: [1], start: 0, finish: 3,
      answer: [0, 1, 2, 3],
    });
    const found = solve(loose, 20);
    expect(found.exhausted).toBe(false);
    expect(found.paths).toHaveLength(2);
    for (const p of found.paths) expect(judge(loose, p).solved).toBe(true);
  });

  it('reports being cut off rather than pretending it finished', () => {
    const stopped = solve(aBoard('cut', 6, 6), 2, 5);
    expect(stopped.exhausted).toBe(true);
  });
});

describe('the designer', () => {
  it('lays a path that covers the board end to end', () => {
    const path = hamiltonian(5, 5, 0, 24, makeRng('h/1'));
    expect(path).not.toBeNull();
    expect(new Set(path!).size).toBe(25);
    expect(path![0]).toBe(0);
    expect(path![24]).toBe(24);
    for (let i = 1; i < path!.length; i++) {
      expect(neighbours(5, 5, path![i - 1])).toContain(path![i]);
    }
  });

  it('only returns boards with exactly one line', () => {
    for (let i = 0; i < 6; i++) {
      const made = makeZig({ w: 5, h: 5, sequence: [1, 2, 3, 4], diagonal: true }, makeRng(`u/${i}`));
      if (!made) continue;
      const found = solve(made.zig, 3);
      expect(found.exhausted).toBe(false);
      expect(found.paths).toHaveLength(1);
    }
  });
});

describe('every shipped board', () => {
  const shipped = JSON.parse(readFileSync('puzzles/zigzag.json', 'utf8')) as (Zig & { id: string })[];

  it('ships some', () => {
    expect(shipped.length).toBeGreaterThan(20);
  });

  it('carries an answer that actually holds', () => {
    for (const z of shipped) {
      expect(judge(z, z.answer).solved, `${z.id} does not solve its own answer`).toBe(true);
    }
  });

  it('has exactly one answer, re-proven from the shipped bytes', () => {
    for (const z of shipped) {
      const found = solve(z, 2, 900_000);
      expect(found.exhausted, `${z.id} could not be settled`).toBe(false);
      expect(found.paths.length, `${z.id} has ${found.paths.length} answers`).toBe(1);
    }
  });

  it('gives every board a distinct id', () => {
    expect(new Set(shipped.map((z) => z.id)).size).toBe(shipped.length);
  });
});

describe('saving and coming back', () => {
  const made = { zig: aBoard('s') };

  it('puts back exactly what was there', () => {
    const a = new ZigSession(made.zig);
    for (const c of made.zig.answer.slice(0, 7)) a.path.push(c);
    const saved = a.save();

    const b = new ZigSession(made.zig);
    expect(b.load(saved)).toBe(true);
    expect(b.path).toEqual(made.zig.answer.slice(0, 7));
  });

  it('refuses a state that belongs to another board', () => {
    const other = { zig: aBoard('s2', 6, 6) };
    const a = new ZigSession(made.zig);
    a.path.push(...made.zig.answer.slice(0, 4));
    expect(new ZigSession(other.zig).load(a.save())).toBe(false);
  });

  it('refuses a state the board cannot actually hold', () => {
    const s = new ZigSession(made.zig);
    expect(s.load('1;5x5;0,0,0,0,0;0,24')).toBe(false);
  });

  it('undoes a gesture at a time, and redoes it', () => {
    const s = new ZigSession(made.zig);
    s.openGesture();
    s.mark();
    s.path.push(made.zig.answer[0]);
    s.path.push(made.zig.answer[1]);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.path).toEqual([]);
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.path).toHaveLength(2);
  });
});

describe('the hint', () => {
  const made = { zig: aBoard('hh') };

  it('points at the start before anything is drawn', () => {
    const s = new ZigSession(made.zig);
    expect(s.hint()?.focus).toEqual([`cell:${made.zig.start}`]);
  });

  it('never names a move on the first rung', () => {
    const s = new ZigSession(made.zig);
    const hint = s.hint();
    // Rung one is a place to look. The reason and the move are separate fields
    // precisely so the frame can withhold them.
    expect(hint?.focus.length).toBeGreaterThan(0);
    expect(hint?.reason.length).toBeGreaterThan(0);
  });

  it('has nothing to say once the line is drawn', () => {
    const s = new ZigSession(made.zig);
    s.path.push(...made.zig.answer);
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });

  it('points at the step that left the route, not at the dead end it led to', () => {
    /* Two legal steps, the first of them off the route. The old hint would
       have reasoned on from the head; this one names the first wrong step,
       because everything after it is built on it. */
    const s = new ZigSession(made.zig);
    const { answer } = made.zig;
    s.path.push(answer[0]);
    const off = stepsFrom(made.zig, answer[0]).find((c) => c !== answer[1] && s.canGo(c));
    if (off === undefined) return;
    s.path.push(off);
    const hint = s.hint()!;
    expect(hint.kind).toBe('fix');
    expect(hint.focus).toEqual([`cell:${off}`]);
  });
});
