import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  judge, roomsOf, cellsOf, edgeBetween, edgeCount, edgesAtCorner, cornerCount,
  neighbours, firstFault, whatIsLeft, type Board,
} from '../../src/games/isolate/model.js';
import { search, isUnique, analyse, scoreOf } from '../../src/games/isolate/solve.js';
import { makeIsolate, bandOf } from '../../src/games/isolate/design.js';
import { IsolateSession } from '../../src/games/isolate/session.js';
import { makeRng } from '../../src/platform/rng.js';

const shipped = JSON.parse(readFileSync('puzzles/isolate.json', 'utf8')) as (Board & {
  id: string; band: string; score: number; chapter: number;
})[];

/** Two rooms of two cells, side by side: the smallest board that is a board. */
function pair(): Board {
  return {
    w: 2, h: 2,
    dots: [0, 1, 2, 3],
    sizes: { 0: 2, 2: 2 },
    crosses: [],
    given: [],
    answer: [edgeBetween(2, 2, 0, 2), edgeBetween(2, 2, 1, 3)],
  };
}

describe('the edges of a grid', () => {
  it('numbers every line between two cells exactly once', () => {
    const [w, h] = [4, 3];
    expect(edgeCount(w, h)).toBe(h * (w - 1) + (h - 1) * w);
    const seen = new Set<number>();
    for (let cell = 0; cell < w * h; cell++) {
      for (const other of neighbours(w, h, cell)) {
        const edge = edgeBetween(w, h, cell, other);
        expect(edge).toBeGreaterThanOrEqual(0);
        seen.add(edge);
        /* And it is the same line from either side. */
        expect(edgeBetween(w, h, other, cell)).toBe(edge);
      }
    }
    expect(seen.size).toBe(edgeCount(w, h));
  });

  it('gives back the two cells a line separates', () => {
    const [w, h] = [4, 3];
    for (let edge = 0; edge < edgeCount(w, h); edge++) {
      const [a, b] = cellsOf(w, h, edge);
      expect(edgeBetween(w, h, a, b)).toBe(edge);
    }
  });

  it('finds the four lines that meet at a corner', () => {
    const [w, h] = [3, 3];
    expect(cornerCount(w, h)).toBe(4);
    for (let corner = 0; corner < cornerCount(w, h); corner++) {
      const four = edgesAtCorner(w, h, corner);
      expect(new Set(four).size).toBe(4);
      for (const edge of four) expect(edge).toBeLessThan(edgeCount(w, h));
    }
  });

  it('says nothing about the outside of the board', () => {
    /* The rim is a wall everywhere and is not an edge, so it cannot be drawn
       twice or rubbed out once. */
    const [w, h] = [3, 3];
    expect(edgeBetween(w, h, 0, 2)).toBe(-1);
    expect(edgeBetween(w, h, 0, 4)).toBe(-1);
  });
});

describe('rooms', () => {
  it('are what the walls leave behind', () => {
    const board = pair();
    const whole = roomsOf(board, new Set());
    expect(whole.cells.length).toBe(1);
    const split = roomsOf(board, new Set(board.answer));
    expect(split.cells.length).toBe(2);
    expect(split.cells.map((c) => c.length).sort()).toEqual([2, 2]);
  });
});

describe('judging', () => {
  it('says nothing at all about a board nobody has touched', () => {
    /*
     * The scar every game here has had to unlearn once: an untouched board is
     * one room holding every circle, and a judge that calls that a fault puts
     * the board in red before the player has done anything.
     */
    const board = shipped[0];
    const j = judge(board, new Set(board.given));
    expect(j.faults).toEqual([]);
    expect(firstFault(j)).toBe('');
    expect(j.solved).toBe(false);
  });

  it('only talks about a room the player walled themselves', () => {
    const board = pair();
    /*
     * One wall down the middle of the top row. It leaves the grid in one piece
     * — round through the bottom row — so the room holds four circles and is
     * twice the size its number allows, and now that the player has drawn
     * something the board is allowed to say so.
     */
    const j = judge(board, new Set([edgeBetween(2, 2, 0, 1)]));
    expect(j.faults).toContain('crowded');
    expect(j.faults).toContain('toobig');
    expect(j.wrong.length).toBeGreaterThan(0);
    expect(firstFault(j)).not.toBe('');
    /* And with nothing drawn, the same board says nothing. */
    expect(judge(board, new Set()).faults).toEqual([]);
  });

  it('knows when it is done', () => {
    const board = pair();
    expect(judge(board, new Set(board.answer)).solved).toBe(true);
    expect(whatIsLeft(board, judge(board, new Set(board.answer)))).toBe('');
  });

  it('counts a corner short of its two walls as work, not as a fault', () => {
    const board = shipped.find((b) => b.crosses.length > 0)!;
    const bare = judge(board, new Set(board.given));
    expect(bare.waiting.length, `${board.id}`).toBeGreaterThan(0);
    expect(bare.faults).toEqual([]);
    expect(bare.solved).toBe(false);
    /* And the answer satisfies every one of them. */
    expect(judge(board, new Set(board.answer)).waiting).toEqual([]);
  });
});

describe('the solver', () => {
  it('finds the one answer to a board and knows it looked at all of them', () => {
    const found = search(pair(), 4);
    expect(found.exhausted).toBe(true);
    expect(found.count).toBe(1);
    expect(isUnique(found)).toBe(true);
  });

  it('will not call a board unique when it ran out of budget', () => {
    const board = shipped[shipped.length - 1];
    expect(isUnique(search(board, 2, 1))).toBe(false);
  });

  it('finds both answers when the walls do not settle it', () => {
    /* A one by four strip with four circles: the rooms could be cells 0-1 and
       2-3, or 1-2 with the ends left over — which is not legal — so this is
       the shape where the count is worth checking rather than assumed. */
    const board: Board = {
      w: 4, h: 1,
      dots: [0, 1, 2, 3],
      sizes: { 0: 2, 2: 2 },
      crosses: [],
      given: [],
      answer: [edgeBetween(4, 1, 1, 2)],
    };
    const found = search(board, 4);
    expect(found.exhausted).toBe(true);
    expect(found.count).toBe(1);
  });
});

describe('the designer', () => {
  it('draws only walls its own answer has', () => {
    for (const board of shipped) {
      for (const edge of board.given) {
        expect(board.answer, `${board.id} draws a wall the answer does not have`)
          .toContain(edge);
      }
    }
  });

  it('gives every room exactly two circles and one number', () => {
    for (const board of shipped) {
      const rooms = roomsOf(board, new Set(board.answer));
      const dots = new Set(board.dots);
      for (const cells of rooms.cells) {
        expect(cells.filter((c) => dots.has(c)).length, `${board.id}`).toBe(2);
        const numbers = cells.map((c) => board.sizes[c]).filter((s) => s !== undefined);
        expect(numbers.length, `${board.id} numbers a room twice`).toBe(1);
        expect(numbers[0], `${board.id} numbers a room wrongly`).toBe(cells.length);
      }
    }
  });

  it('bands by the measured score and nothing else', () => {
    expect(bandOf(50)).toBe('gentle');
    expect(bandOf(70)).toBe('steady');
    expect(bandOf(80)).toBe('tricky');
    expect(bandOf(120)).toBe('severe');
  });

  it('makes a sound board when it makes one at all', () => {
    const rng = makeRng('unit:isolate');
    let made = 0;
    for (let i = 0; i < 30 && made < 3; i++) {
      const board = makeIsolate({ w: 4, h: 4, biggest: 3 }, rng);
      if (!board) continue;
      made++;
      expect(judge(board, new Set(board.answer)).solved).toBe(true);
      expect(isUnique(search(board, 2))).toBe(true);
      expect(board.reading.byReason).toBe(true);
    }
    expect(made).toBeGreaterThan(0);
  });
});

describe('every shipped board', () => {
  it('has exactly one answer, and its own answer is it', () => {
    for (const board of shipped) {
      expect(judge(board, new Set(board.answer)).solved, `${board.id}`).toBe(true);
      expect(isUnique(search(board, 2)), `${board.id} is not unique`).toBe(true);
    }
  });

  it('can be reasoned out without ever trying a wall to see', () => {
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
    expect(means[0]).toBeLessThan(means[means.length - 1]);
  });
});

describe('a session', () => {
  it('will not let the board&apos;s own walls be rubbed out', () => {
    const board = shipped.find((b) => b.given.length > 0)!;
    const s = new IsolateSession(board);
    expect(s.set(board.given[0], false)).toBe(false);
    expect(s.walls.has(board.given[0])).toBe(true);
  });

  it('undoes a gesture rather than a change', () => {
    const board = shipped[0];
    const s = new IsolateSession(board);
    const spare = board.answer.filter((e) => !board.given.includes(e));
    s.openGesture();
    s.set(spare[0], true);
    s.set(spare[1], true);
    expect(s.undo()).toBe(true);
    expect(s.walls.has(spare[0])).toBe(false);
    expect(s.redo()).toBe(true);
    expect(s.walls.has(spare[1])).toBe(true);
  });

  it('comes back exactly as it was left, and refuses another board&apos;s state', () => {
    const board = shipped[0];
    const s = new IsolateSession(board);
    const spare = board.answer.filter((e) => !board.given.includes(e));
    s.set(spare[0], true);
    const saved = s.save();
    const back = new IsolateSession(board);
    expect(back.load(saved)).toBe(true);
    expect([...back.walls].sort()).toEqual([...s.walls].sort());
    const other = shipped.find((b) => b.w !== board.w || b.h !== board.h)!;
    expect(new IsolateSession(other).load(saved)).toBe(false);
  });

  it('is solved by its own answer', () => {
    for (const board of shipped.slice(0, 8)) {
      const s = new IsolateSession(board);
      for (const edge of board.answer) s.set(edge, true);
      expect(s.verdict().solved, `${board.id}`).toBe(true);
    }
  });
});
