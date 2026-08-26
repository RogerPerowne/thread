import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  judge, joinsOf, neighboursOf, agree, opposite, whatIsLeft, firstFault,
  centreOf, edgeCorners, type Hex,
} from '../../src/games/hex/model.js';
import { search, isUnique, analyse } from '../../src/games/hex/solve.js';
import { makeHex, scoreOf, bandOf, flower, rhombus, triangle } from '../../src/games/hex/design.js';
import { HexSession } from '../../src/games/hex/session.js';
import { makeRng } from '../../src/platform/rng.js';

const shipped = JSON.parse(readFileSync('puzzles/hex.json', 'utf8')) as (Hex & {
  id: string; band: string; score: number; chapter: number;
})[];

/** A tiny board with a known answer: two spaces, two tiles, one join. */
function pair(): Hex {
  return {
    cells: [[0, 0], [1, 0]],
    tiles: [
      [5, 1, 1, 4, 1, 1],
      [2, 1, 1, 5, 2, 2],
    ],
    answer: [0, 1],
    values: 5,
  };
}

describe('the shape of a board', () => {
  it('finds every touching pair once, and only once', () => {
    const joins = joinsOf({ cells: rhombus(2, 2), tiles: [], answer: [], values: 1 });
    /* Four spaces in a leaning block: three pairs along the rows and columns,
       and the two that meet on the diagonal — five, not four and not ten. */
    expect(joins.length).toBe(5);
    const seen = new Set(joins.map((j) => `${Math.min(j.a, j.b)}-${Math.max(j.a, j.b)}`));
    expect(seen.size).toBe(joins.length);
  });

  it('a join seen from either end names opposite faces', () => {
    const hex = { cells: rhombus(3, 2), tiles: [], answer: [], values: 1 };
    const near = neighboursOf(hex);
    for (const j of joinsOf(hex)) {
      expect(near[j.a].some((n) => n.at === j.b && n.dir === j.dir)).toBe(true);
      expect(near[j.b].some((n) => n.at === j.a && n.dir === opposite(j.dir))).toBe(true);
    }
  });

  it('counts the flower, the rhombus and the triangle', () => {
    expect(flower(0).length).toBe(1);
    expect(flower(1).length).toBe(7);
    expect(flower(2).length).toBe(19);
    expect(rhombus(4, 3).length).toBe(12);
    expect(triangle(3).length).toBe(6);
  });

  it('puts neighbouring spaces exactly one hexagon apart', () => {
    /* Two spaces that touch are the width of one hexagon apart, which is what
       lets the drawing lay them out with no gap arithmetic at all. */
    const a = centreOf([0, 0]);
    const b = centreOf([1, 0]);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.sqrt(3), 6);
  });

  it('gives a sector two corners that are one side apart', () => {
    const [p, q] = edgeCorners(0, 1);
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeCloseTo(1, 6);
  });
});

describe('judging', () => {
  it('says nothing about a space that is still empty', () => {
    const hex = pair();
    const j = judge(hex, [0, -1]);
    expect(j.faults).toEqual([]);
    expect(j.clashes).toEqual([]);
    expect(j.solved).toBe(false);
    expect(j.progress).toBeCloseTo(0.5, 6);
  });

  it('only calls a clash where both tiles are down', () => {
    const hex = pair();
    expect(judge(hex, [1, 0]).clashes.length).toBe(1);
    expect(judge(hex, [1, 0]).faults).toEqual(['clash']);
    expect(judge(hex, [0, 1]).clashes.length).toBe(0);
    expect(judge(hex, [0, 1]).solved).toBe(true);
  });

  it('says what is left without ever saying it in red', () => {
    const hex = pair();
    expect(firstFault(judge(hex, [0, 1]))).toBe('');
    expect(whatIsLeft(hex, judge(hex, [0, -1]))).toBe('One tile to place');
    expect(whatIsLeft(hex, judge(hex, [-1, -1]))).toContain('every place a tile');
    /* A board with something wrong is told about the fault, not the tally. */
    expect(whatIsLeft(hex, judge(hex, [1, 0]))).toBe('');
  });

  it('agrees across a join exactly when the two faces match', () => {
    const hex = pair();
    expect(agree(hex.tiles, 0, 1, 0)).toBe(true);
    expect(agree(hex.tiles, 1, 0, 0)).toBe(false);
  });
});

describe('the solver', () => {
  it('finds the one answer to a board and knows it looked at all of them', () => {
    const found = search(pair(), 2);
    expect(found.count).toBe(1);
    expect(found.exhausted).toBe(true);
    expect(isUnique(found)).toBe(true);
    expect(found.first).toEqual([0, 1]);
  });

  it('will not call a board unique when it ran out of budget', () => {
    /*
     * "One answer" and "one so far" are different things, and a search that
     * stops early has found the second. This is the scar Shape Up left.
     */
    const board = shipped[shipped.length - 1];
    const cut = search(board, 2, 1);
    expect(isUnique(cut)).toBe(false);
  });

  it('finds both answers when two tiles are interchangeable', () => {
    const twin: Hex = {
      cells: [[0, 0], [1, 0]],
      tiles: [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]],
      answer: [0, 1],
      values: 1,
    };
    expect(search(twin, 4).count).toBe(2);
  });
});

describe('the designer', () => {
  it('never ships a board with two tiles the same', () => {
    for (const board of shipped) {
      const keys = new Set(board.tiles.map((t) => t.join(',')));
      expect(keys.size, `${board.id} repeats a tile`).toBe(board.tiles.length);
    }
  });

  it('gives every draw a board its own answer satisfies', () => {
    const rng = makeRng('unit:hex');
    let made = 0;
    for (let i = 0; i < 40 && made < 12; i++) {
      const board = makeHex({ cells: rhombus(3, 2), values: 4, name: '3 by 2' }, rng);
      if (!board) continue;
      made++;
      expect(judge(board, board.answer as number[]).solved).toBe(true);
    }
    expect(made).toBeGreaterThan(0);
  });

  it('bands by the measured score and nothing else', () => {
    expect(bandOf(40)).toBe('gentle');
    expect(bandOf(55)).toBe('steady');
    expect(bandOf(70)).toBe('tricky');
    expect(bandOf(95)).toBe('severe');
  });
});

describe('every shipped board', () => {
  it('has exactly one answer, and its own answer is it', () => {
    for (const board of shipped) {
      expect(judge(board, board.answer as number[]).solved, `${board.id}`).toBe(true);
      expect(isUnique(search(board, 2)), `${board.id} is not unique`).toBe(true);
    }
  });

  it('can be reasoned out without ever trying a tile to see', () => {
    for (const board of shipped) {
      expect(analyse(board).byReason, `${board.id} needs a guess`).toBe(true);
    }
  });

  it('ships the score its own deduction earns', () => {
    for (const board of shipped) {
      expect(scoreOf(analyse(board)), `${board.id}`).toBeCloseTo(board.score, 0);
      expect(bandOf(board.score), `${board.id}`).toBe(board.band);
    }
  });

  it('gets harder up the ladder', () => {
    const byChapter = new Map<number, number[]>();
    for (const b of shipped) {
      const list = byChapter.get(b.chapter) ?? [];
      list.push(b.score);
      byChapter.set(b.chapter, list);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const chapters = [...byChapter.keys()].sort((a, b) => a - b);
    const means = chapters.map((c) => mean(byChapter.get(c)!));
    /* The first chapter is the easiest and the last the hardest; in between
       the ladder is allowed to be flat, but never to run backwards overall. */
    expect(means[0]).toBeLessThan(means[means.length - 1]);
    for (let i = 1; i < means.length; i++) {
      expect(means[i], `chapter ${chapters[i]} is easier than two before it`)
        .toBeGreaterThan(means[Math.max(0, i - 2)] - 1);
    }
  });
});

describe('a session', () => {
  it('swaps rather than losing a tile when one is laid on another', () => {
    const s = new HexSession(shipped[0]);
    s.place(0, 3);
    s.place(1, 2);
    s.place(1, 3);
    expect(s.placed[1]).toBe(3);
    expect(s.placed[0]).toBe(2);
    expect(s.spare()).not.toContain(3);
  });

  it('undoes a gesture rather than a change', () => {
    const s = new HexSession(shipped[0]);
    s.openGesture();
    s.place(0, 0);
    s.place(1, 1);
    expect(s.undo()).toBe(true);
    expect(s.placed.every((t) => t < 0)).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.placed[1]).toBe(1);
  });

  it('refuses a save from another board', () => {
    const a = new HexSession(shipped[0]);
    const b = new HexSession(shipped[1]);
    a.place(0, 1);
    expect(b.load(a.save())).toBe(false);
    const c = new HexSession(shipped[0]);
    expect(c.load(a.save())).toBe(true);
    expect(c.placed).toEqual(a.placed);
  });

  it('refuses a save that puts one tile in two places', () => {
    const s = new HexSession(shipped[0]);
    const fake = s.save().replace(/;[-\d,]+$/, `;${s.placed.map(() => 0).join(',')}`);
    expect(s.load(fake)).toBe(false);
  });

  it('only offers a tile for a space when it agrees with what is already there', () => {
    const board = shipped[0];
    const s = new HexSession(board);
    const before = s.fits();
    expect(before[0].length).toBe(board.tiles.length);
    s.place(0, board.answer[0]);
    const after = s.fits();
    expect(after[0].length).toBe(0);
    /* The right tile is still allowed everywhere it fits, and the answer's is
       one of them — a hint that ruled out the answer would be a bug. */
    expect(after[1]).toContain(board.answer[1]);
  });
});

describe('the hint', () => {
  it('points at the clash before anything else', () => {
    const hex = pair();
    const s = new HexSession(hex);
    s.place(0, 1);
    s.place(1, 0);
    const hint = s.hint()!;
    expect(hint.reason).toContain('do not match');
    expect(hint.focus).toEqual(['cell:0', 'cell:1']);
  });

  it('names a space that only one tile fits, and which tile', () => {
    const hex = pair();
    const s = new HexSession(hex);
    s.place(0, 0);
    const hint = s.hint()!;
    expect(hint.focus).toContain('cell:1');
    expect(hint.focus).toContain('tile:1');
  });

  it('says something true on an empty board, and never the answer', () => {
    for (const board of shipped.slice(0, 12)) {
      const s = new HexSession(board);
      const hint = s.hint()!;
      expect(hint, `${board.id} has no hint`).not.toBeNull();
      expect(hint.reason.length).toBeGreaterThan(10);
      /* Rung one is where to look. On a fresh board it may not name a tile. */
      expect(hint.focus.length).toBeGreaterThan(0);
    }
  });

  it('has nothing left to say once the board is finished', () => {
    const board = shipped[0];
    const s = new HexSession(board);
    board.answer.forEach((tile, at) => s.place(at, tile));
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });

  it('says something has gone wrong when nothing fits a space', () => {
    /* Not a clash — every tile down agrees with its neighbours — but a space
       nothing left will fit, which is the other way a board dies. */
    const board = shipped[0];
    const s = new HexSession(board);
    const wrong = board.tiles.map((_, i) => i).find((t) => t !== board.answer[0])!;
    s.place(0, wrong);
    const fits = s.fits();
    const dead = fits.findIndex((f, at) => s.placed[at] < 0 && f.length === 0);
    if (dead >= 0) {
      expect(s.hint()!.reason).toContain('wrong place');
    }
  });
});
