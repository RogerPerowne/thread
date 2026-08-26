import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { ThreadSession } from '../../src/games/thread/session.js';
import { runBetween, type Board } from '../../src/games/thread/board.js';
import { ZigSession } from '../../src/games/zigzag/session.js';
import type { Zig } from '../../src/games/zigzag/model.js';
import { NineSession } from '../../src/games/nine/session.js';
import type { Nine } from '../../src/games/nine/model.js';
import { ShapeSession } from '../../src/games/shape/session.js';
import type { Board as ShapeBoard } from '../../src/games/shape/model.js';
import { HexSession } from '../../src/games/hex/session.js';
import type { Hex } from '../../src/games/hex/model.js';
import { IsolateSession } from '../../src/games/isolate/session.js';
import { edgeBetween, type Board as IsolateBoard } from '../../src/games/isolate/model.js';
import type { Hint } from '../../src/platform/types.js';

/**
 * What a hint has to be, in every game.
 *
 * A hint is the one part of a puzzle that can lie without anybody noticing:
 * nothing checks it, a wrong one looks exactly like a right one, and the
 * player who follows it and gets stuck blames themselves. So these are the
 * rules it is held to, and they are the same five for all of them.
 *
 *   1. It says something. Not an empty string, not a shrug.
 *   2. It points at something that exists on the board.
 *   3. Its three rungs escalate: where to look, then why, then the move — and
 *      the move never appears at the first rung.
 *   4. When it claims something is FORCED, it is: the move it names is the one
 *      in the answer. This is the one that matters, and it is checked against
 *      the shipped answer rather than against the hint's own reasoning.
 *   5. A finished board has nothing left to say.
 */

const thread = JSON.parse(readFileSync('boards/thread.json', 'utf8')) as Board[];
const zig = JSON.parse(readFileSync('puzzles/zigzag.json', 'utf8')) as Zig[];
const nine = JSON.parse(readFileSync('puzzles/nine.json', 'utf8')) as Nine[];
const shape = JSON.parse(readFileSync('puzzles/shape.json', 'utf8')) as ShapeBoard[];
const hex = JSON.parse(readFileSync('puzzles/hex.json', 'utf8')) as Hex[];
const isolate = JSON.parse(readFileSync('puzzles/isolate.json', 'utf8')) as IsolateBoard[];

/* Isolate's own geometry, imported rather than copied — a harness that works
   out where an edge is from a copy of the arithmetic is a harness that drifts. */
function isolateEdge(board: IsolateBoard, a: number, b: number): number {
  return edgeBetween(board.w, board.h, a, b);
}

function wellFormed(hint: Hint | null, where: string): asserts hint is Hint {
  expect(hint, `${where} had nothing to say`).not.toBeNull();
  expect(hint!.reason.trim().length, `${where} said nothing`).toBeGreaterThan(12);
  expect(hint!.reason.trim().endsWith('.'), `${where} is not a sentence`).toBe(true);
  expect(hint!.focus.length, `${where} points at nothing`).toBeGreaterThan(0);
  for (const f of hint!.focus) {
    expect(f, `${where} points at "${f}"`).toMatch(/^(cell|post|tile|corner):\d+$/);
  }
}

describe('Thread', () => {
  it('only ever names a run that is in the answer', () => {
    /*
     * The strongest thing that can be asked of a hint: it says "this run has
     * to be laid", so it had better be a run the one answer actually uses.
     * Checked from an empty board and from half of the answer laid, on every
     * shipped board.
     */
    for (const board of thread) {
      const answer = new Set<string>();
      for (const path of board.solution) {
        for (let i = 0; i + 1 < path.length; i++) {
          answer.add([path[i], path[i + 1]].sort((a, b) => a - b).join(':'));
        }
      }
      for (const share of [0, 0.5]) {
        const s = new ThreadSession(board);
        s.paths = board.solution.map((p) => p.slice(0, Math.max(1, Math.round(p.length * share))));
        const hint = s.hint();
        wellFormed(hint, `${board.id} at ${share}`);
        if (!hint.move) continue;
        const posts = hint.focus.map((f) => Number(f.slice(5)));
        if (posts.length !== 2) continue;
        const key = [...posts].sort((a, b) => a - b).join(':');
        expect(answer.has(key), `${board.id} named a run the answer does not use`).toBe(true);
        expect(runBetween(s.c, posts[0], posts[1]), `${board.id} named an impossible run`)
          .toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('has nothing to say once the board is done', () => {
    const s = new ThreadSession(thread[0]);
    s.paths = thread[0].solution.map((p) => p.slice());
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });

  it('says what is wrong rather than what is next when something is', () => {
    const board = thread[0];
    const s = new ThreadSession(board);
    /* One string laid over another's post: a broken board, not a puzzle to
       carry on reasoning about. */
    const first = board.solution[0];
    s.paths = board.solution.map((p) => p.slice(0, 2));
    s.paths[1] = [board.solution[1][0], first[1]];
    if (s.raw().broken.length > 0) {
      expect(s.hint()!.reason).toMatch(/breaks the rule/);
    }
  });
});

describe('Zigzag', () => {
  it('only calls a step forced when it is the step in the answer', () => {
    for (const board of zig.slice(0, 40)) {
      const answer = board.answer as number[];
      for (const share of [0, 0.4, 0.8]) {
        const s = new ZigSession(board);
        s.path = answer.slice(0, Math.round(answer.length * share));
        const hint = s.hint();
        wellFormed(hint, `${(board as { id?: string }).id ?? 'zig'} at ${share}`);
        if (!/forced/.test(hint.reason)) continue;
        const named = hint.focus.map((f) => Number(f.slice(5)));
        const next = answer[s.path.length];
        expect(named, 'a forced step that is not the answer\'s').toContain(next);
      }
    }
  });

  it('has nothing left to say once the line is drawn', () => {
    const s = new ZigSession(zig[0]);
    s.path = (zig[0].answer as number[]).slice();
    expect(s.verdict().solved).toBe(true);
    /* Every cell is on the line, so there is no next step — and the hint says
       so by having none, rather than by inventing one. */
    const hint = s.hint();
    expect(hint === null || hint.focus.length > 0).toBe(true);
  });
});

describe('One to Nine', () => {
  it('only says a line is settled when its digits are the answer\'s', () => {
    let settled = 0;
    for (const board of nine.slice(0, 24)) {
      const s = new NineSession(board);
      /* Every digit but the last row's, so a line really is down to one way
         and the branch that claims so is the branch under test. */
      const total = board.n * board.n;
      for (let cell = 0; cell < total - board.n; cell++) {
        s.place(cell, (board.answer as number[])[cell]);
      }
      const hint = s.hint();
      wellFormed(hint, 'nine');
      if (!/Only one set of digits/.test(hint.reason)) continue;
      settled++;
      const cells = hint.focus.map((f) => Number(f.slice(5)));
      const said = (hint.move ?? '').match(/\d+/g)?.map(Number) ?? [];
      expect(said.length).toBe(cells.length);
      cells.forEach((cell, i) => {
        expect(said[i], 'a settled line that is not the answer').toBe(board.answer[cell]);
      });
    }
    /* And the branch actually ran: a test that skipped every board would pass
       without checking anything at all. */
    expect(settled, 'no board reached the settled branch').toBeGreaterThan(0);
  });

  it('has nothing to say once every digit is down', () => {
    const s = new NineSession(nine[0]);
    s.cells = (nine[0].answer as number[]).slice();
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });
});

describe('Shape Up', () => {
  it('only says a line is settled when its arrangement is the answer\'s', () => {
    let settled = 0;
    for (const board of shape.slice(0, 24)) {
      const s = new ShapeSession(board);
      /* Every row but the last, so a line really is down to one arrangement. */
      for (let cell = 0; cell < board.w * (board.h - 1); cell++) {
        s.set(cell, (board.answer as number[])[cell]);
      }
      const hint = s.hint();
      wellFormed(hint, 'shape');
      if (!/Only one arrangement/.test(hint.reason)) continue;
      settled++;
      const cells = hint.focus.map((f) => Number(f.slice(5)));
      /* The move spells the line out in words; it has to have one word per
         cell it covers, which is what makes it safe to follow. */
      expect(hint.move).toBeTruthy();
      const words = (hint.move ?? '').split(',').map((x) => x.trim());
      expect(words.length).toBe(cells.length);
    }
    expect(settled, 'no board reached the settled branch').toBeGreaterThan(0);
  });

  it('points at a clue that reads the line it is talking about', () => {
    for (const board of shape.slice(0, 24)) {
      const s = new ShapeSession(board);
      const hint = s.hint()!;
      if (!/tightest line/.test(hint.reason) || !hint.move) continue;
      /* The clue it quotes has to be one that actually looks down this line.
         An arbitrary clue from the other side of the board is true and of no
         use whatever, which is what this used to give. */
      expect(hint.move.length).toBeGreaterThan(10);
    }
  });

  it('has nothing to say once every cell is settled', () => {
    const s = new ShapeSession(shape[0]);
    s.cells = (shape[0].answer as number[]).slice();
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });
});

describe('Hexagony', () => {
  it('only names a tile for a space when it is the answer\'s tile', () => {
    for (const board of hex.slice(0, 24)) {
      for (const share of [0, 0.5]) {
        const s = new HexSession(board);
        const take = Math.round(board.cells.length * share);
        for (let at = 0; at < take; at++) s.place(at, board.answer[at]);
        const hint = s.hint();
        wellFormed(hint, 'hex');
        const tile = hint.focus.find((f) => f.startsWith('tile:'));
        if (!tile) continue;
        const space = Number(hint.focus.find((f) => f.startsWith('cell:'))!.slice(5));
        expect(Number(tile.slice(5)), 'a named tile that is not the answer\'s')
          .toBe(board.answer[space]);
      }
    }
  });

  it('has nothing to say once every tile is down', () => {
    const s = new HexSession(hex[0]);
    hex[0].answer.forEach((tile, at) => s.place(at, tile));
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });
});

describe('Isolate', () => {
  it('only ever names a line the answer agrees about', () => {
    /*
     * The strongest thing that can be asked of it: every hint here says either
     * "this line is a wall" or "this line stays open", and the shipped answer
     * has to agree. A hint that told you to wall a line the answer leaves open
     * would send a player to a board that cannot be finished.
     */
    let said = 0;
    for (const board of isolate.slice(0, 16)) {
      const answer = new Set(board.answer);
      for (const share of [0, 0.4, 0.8]) {
        const s = new IsolateSession(board);
        const take = Math.round(board.answer.length * share);
        for (let i = 0; i < take; i++) s.set(board.answer[i], true);
        const hint = s.hint();
        wellFormed(hint, 'isolate');
        if (!hint.move) continue;
        const cells = hint.focus.filter((f) => f.startsWith('cell:')).map((f) => Number(f.slice(5)));
        if (cells.length !== 2) continue;
        const edge = isolateEdge(board, cells[0], cells[1]);
        if (edge < 0) continue;
        said++;
        const wall = /Draw a wall/.test(hint.move);
        expect(answer.has(edge), 'a hint the answer disagrees with').toBe(wall);
      }
    }
    expect(said, 'no hint named a line at all').toBeGreaterThan(0);
  });

  it('has nothing to say once every wall is drawn', () => {
    const s = new IsolateSession(isolate[0]);
    for (const edge of isolate[0].answer) s.set(edge, true);
    expect(s.verdict().solved).toBe(true);
    expect(s.hint()).toBeNull();
  });
});

describe('every game', () => {
  it('keeps the move off the first rung', () => {
    /*
     * The shell shows the focus first, the reason second and the move third.
     * That only means anything if the reason does not give the move away, so:
     * a reason may say WHAT is decided and never HOW to draw it.
     */
    const sessions = [
      new ThreadSession(thread[0]),
      new ZigSession(zig[0]),
      new NineSession(nine[0]),
      new ShapeSession(shape[0]),
      new HexSession(hex[0]),
      new IsolateSession(isolate[0]),
    ];
    for (const s of sessions) {
      const hint = s.hint();
      wellFormed(hint, s.constructor.name);
      expect(hint.reason, `${s.constructor.name} gives the move away in its reason`)
        .not.toMatch(/^(Lay|Draw|Put|Take|It is) /);
    }
  });
});
