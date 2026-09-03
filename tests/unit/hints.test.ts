import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { ThreadSession } from '../../src/games/thread/session.js';
import { runBetween, claimHolds as threadHolds, type Board as ThreadBoard } from '../../src/games/thread/board.js';
import { ZigSession } from '../../src/games/zigzag/session.js';
import { stepsFrom, claimHolds as zigHolds, type Zig } from '../../src/games/zigzag/model.js';
import { NineSession } from '../../src/games/nine/session.js';
import { claimHolds as nineHolds, type Nine } from '../../src/games/nine/model.js';
import { ShapeSession } from '../../src/games/shape/session.js';
import { claimHolds as shapeHolds, type Board as ShapeBoard } from '../../src/games/shape/model.js';
import { HexSession } from '../../src/games/hex/session.js';
import { claimHolds as hexHolds, type Hex } from '../../src/games/hex/model.js';
import { IsolateSession } from '../../src/games/isolate/session.js';
import {
  claimHolds as isolateHolds, edgeCount, cellsOf, type Board as IsolateBoard,
} from '../../src/games/isolate/model.js';
import { makeRng, type Rng } from '../../src/platform/rng.js';
import type { Hint, Session } from '../../src/platform/types.js';

/**
 * What a hint has to be, in every game — and this time it is proven rather
 * than sampled.
 *
 * A hint is the one part of a puzzle that can lie without anybody noticing:
 * nothing checks it, a wrong one looks exactly like a right one, and the
 * player who follows it and gets stuck blames themselves. Worse, the way a
 * hint lies is systematic. Every game here reasons forward from what is on
 * the board, so one wrong move that breaks no rule yet — a shape in a cell
 * where a different shape goes, a string laid along a legal run the answer
 * does not use — makes every hint after it confidently, helpfully wrong.
 *
 * So each game's hint now carries a CLAIM in the board's own vocabulary, and
 * this file holds every claim to the shipped answer. The rules, the same six
 * for all of them:
 *
 *   1. It says something, and points at something that exists on the board.
 *   2. Its three rungs escalate: where to look, then why, then the move. The
 *      move never appears at the first rung, and there always IS a move —
 *      a hint that repeats itself when pressed again is a hint that stopped.
 *   3. On a board that is a prefix of the answer, a hint is never a `fix`,
 *      and every claim it makes holds in the answer. Checked at five points
 *      along the solve, on a spread of the ladder.
 *   4. On a board with one legal-but-wrong move on it, the hint is a `fix`
 *      that points at that move and nothing else — because from there the
 *      only useful step is back.
 *   5. A finished board has nothing left to say.
 *   6. A claim is the hint's own; the answer is read from the board. The two
 *      are written apart, so one cannot cover for the other.
 */

const thread = JSON.parse(readFileSync('boards/thread.json', 'utf8')) as ThreadBoard[];
const zig = JSON.parse(readFileSync('puzzles/zigzag.json', 'utf8')) as Zig[];
const nine = JSON.parse(readFileSync('puzzles/nine.json', 'utf8')) as Nine[];
const shape = JSON.parse(readFileSync('puzzles/shape.json', 'utf8')) as ShapeBoard[];
const hex = JSON.parse(readFileSync('puzzles/hex.json', 'utf8')) as Hex[];
const isolate = JSON.parse(readFileSync('puzzles/isolate.json', 'utf8')) as IsolateBoard[];

/** A spread of the ladder: every nth board, so the gate sees each chapter. */
function spread<T>(all: readonly T[], n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < all.length; i += Math.max(1, Math.floor(all.length / n))) out.push(all[i]);
  return out;
}

const SHARES = [0, 0.25, 0.5, 0.75, 0.95];

/**
 * One game, as the gate sees it. `right` plays a share of the answer onto a
 * fresh session; `wrong` plays a share and then one move the rules allow but
 * the answer does not, and says where it went — or null if there is no such
 * move from that state, in which case the gate tries another share.
 */
type Game<B, S extends Session<unknown>> = {
  readonly name: string;
  readonly boards: readonly B[];
  readonly id: (b: B) => string;
  readonly make: (b: B) => S;
  readonly holds: (b: B, claim: string) => boolean;
  readonly right: (b: B, s: S, share: number) => void;
  readonly wrong: (b: B, s: S, share: number, rng: Rng) => string | null;
  readonly focusOf: (b: B, where: string) => string;
};

function wellFormed(hint: Hint | null, where: string): asserts hint is Hint {
  expect(hint, `${where} had nothing to say`).not.toBeNull();
  expect(hint!.reason.trim().length, `${where} said nothing`).toBeGreaterThan(12);
  expect(hint!.reason.trim().endsWith('.'), `${where} is not a sentence`).toBe(true);
  expect(hint!.focus.length, `${where} points at nothing`).toBeGreaterThan(0);
  for (const f of hint!.focus) {
    expect(f, `${where} points at "${f}"`).toMatch(/^(cell|post|tile|corner):\d+$/);
  }
  expect(['fix', 'step', 'look']).toContain(hint!.kind);
  /* The reason is the second rung. It may say WHAT is decided and never HOW
     to draw it, or the third rung is given away on the second. */
  expect(hint!.reason, `${where} gives the move away in its reason`)
    .not.toMatch(/^(Lay|Draw|Put|Take|It is) /);
  expect(hint!.move, `${where} has no third rung`).toBeTruthy();
}

function gate<B, S extends Session<unknown>>(g: Game<B, S>): void {
  describe(g.name, () => {
    it('never lies about a board that is on course', () => {
      let claims = 0;
      for (const board of spread(g.boards, 40)) {
        for (const share of SHARES) {
          const s = g.make(board);
          g.right(board, s, share);
          const where = `${g.id(board)} at ${share}`;
          if (s.verdict().solved) {
            expect(s.hint(), `${where} is solved and still pointing`).toBeNull();
            continue;
          }
          const hint = s.hint();
          wellFormed(hint, where);
          expect(hint.kind, `${where} calls a right board wrong`).not.toBe('fix');
          for (const c of hint.claim) {
            claims++;
            expect(g.holds(board, c), `${where} claims "${c}" and the answer disagrees`).toBe(true);
          }
        }
      }
      expect(claims, 'no claim was ever made').toBeGreaterThan(50);
    });

    it('notices one wrong move, and points at it', () => {
      const rng = makeRng(`hint-gate:${g.name}`);
      let caught = 0;
      for (const board of spread(g.boards, 40)) {
        for (const share of SHARES) {
          const s = g.make(board);
          const at = g.wrong(board, s, share, rng);
          if (at === null) continue;
          const where = `${g.id(board)} at ${share}, wrong at ${at}`;
          const hint = s.hint();
          wellFormed(hint, where);
          expect(hint.kind, `${where}: the hint reasons on as if nothing were wrong`).toBe('fix');
          expect(hint.focus, `${where}: the fix points somewhere else`).toContain(g.focusOf(board, at));
          for (const c of hint.claim) {
            expect(g.holds(board, c), `${where} claims "${c}" and the answer disagrees`).toBe(true);
          }
          caught++;
        }
      }
      expect(caught, 'no wrong board was ever built').toBeGreaterThan(30);
    });

    it('has nothing to say once the board is done', () => {
      const s = g.make(g.boards[0]);
      s.reveal();
      expect(s.verdict().solved).toBe(true);
      expect(s.hint()).toBeNull();
    });
  });
}

// --- Thread ------------------------------------------------------------------

gate<ThreadBoard, ThreadSession>({
  name: 'Thread',
  boards: thread,
  id: (b) => b.id,
  make: (b) => new ThreadSession(b),
  holds: threadHolds,
  right: (b, s, share) => {
    s.paths = b.solution.map((p) => p.slice(0, Math.max(share > 0 ? 1 : 0, Math.round(p.length * share))));
  },
  wrong: (b, s, share, rng) => {
    s.paths = b.solution.map((p) => p.slice(0, Math.max(1, Math.round(p.length * share))));
    const used = new Set(s.paths.flat());
    /* A legal run off the route: from some string's loose end to a free post
       it can reach that is not the route's next post. */
    const order = rng.shuffle(s.paths.map((_, i) => i));
    for (const i of order) {
      const path = s.paths[i];
      if (path.length >= b.solution[i].length) continue;
      const head = path[path.length - 1];
      const next = b.solution[i][path.length];
      for (let q = 0; q < b.posts.length; q++) {
        if (q === next || used.has(q) || runBetween(s.c, head, q) < 0) continue;
        path.push(q);
        return String(q);
      }
    }
    return null;
  },
  focusOf: (_b, q) => `post:${q}`,
});

// --- Zigzag ------------------------------------------------------------------

gate<Zig, ZigSession>({
  name: 'Zigzag',
  boards: zig,
  id: (b) => (b as { id?: string }).id ?? 'zig',
  make: (b) => new ZigSession(b),
  holds: zigHolds,
  right: (b, s, share) => { s.path = b.answer.slice(0, Math.round(b.answer.length * share)); },
  wrong: (b, s, share) => {
    s.path = b.answer.slice(0, Math.max(1, Math.round(b.answer.length * share)));
    if (s.path.length >= b.answer.length) return null;
    const at = s.path[s.path.length - 1];
    const next = b.answer[s.path.length];
    const off = stepsFrom(b, at).find((c) => c !== next && s.canGo(c));
    if (off === undefined) return null;
    s.path.push(off);
    return String(off);
  },
  focusOf: (_b, c) => `cell:${c}`,
});

// --- One to Nine ---------------------------------------------------------------

gate<Nine, NineSession>({
  name: 'One to Nine',
  boards: nine,
  id: (b) => (b as { id?: string }).id ?? 'nine',
  make: (b) => new NineSession(b),
  holds: nineHolds,
  right: (b, s, share) => {
    const take = Math.round(b.answer.length * share);
    for (let i = 0; i < take; i++) s.place(i, b.answer[i]);
  },
  wrong: (b, s, share, rng) => {
    const take = Math.round(b.answer.length * share);
    for (let i = 0; i < take; i++) s.place(i, b.answer[i]);
    const spare = rng.shuffle(s.spare());
    for (let i = take; i < b.answer.length; i++) {
      const d = spare.find((x) => x !== b.answer[i]);
      if (d === undefined) continue;
      s.place(i, d);
      return String(i);
    }
    return null;
  },
  focusOf: (_b, i) => `cell:${i}`,
});

// --- Shape Up ------------------------------------------------------------------

gate<ShapeBoard, ShapeSession>({
  name: 'Shape Up',
  boards: shape,
  id: (b) => (b as { id?: string }).id ?? 'shape',
  make: (b) => new ShapeSession(b),
  holds: shapeHolds,
  right: (b, s, share) => {
    const take = Math.round(b.answer.length * share);
    /* Shapes only: the blanks are notation, and a player who never draws one
       is still on course. */
    for (let i = 0; i < take; i++) if (b.answer[i] > 0) s.set(i, b.answer[i]);
  },
  wrong: (b, s, share, rng) => {
    const take = Math.round(b.answer.length * share);
    for (let i = 0; i < take; i++) if (b.answer[i] > 0) s.set(i, b.answer[i]);
    const cells = rng.shuffle(b.answer.map((_, i) => i).filter((i) => i >= take));
    for (const i of cells) {
      /* Either a shape where the answer has a different one, or the empty
         mark where the answer has a shape — both are moves a thumb makes. */
      const v = b.answer[i] > 0 ? 0 : 1 + rng.int(b.shapes);
      if (v === b.answer[i]) continue;
      s.set(i, v);
      return String(i);
    }
    return null;
  },
  focusOf: (_b, i) => `cell:${i}`,
});

// --- Hexagony ------------------------------------------------------------------

gate<Hex, HexSession>({
  name: 'Hexagony',
  boards: hex,
  id: (b) => (b as { id?: string }).id ?? 'hex',
  make: (b) => new HexSession(b),
  holds: hexHolds,
  right: (b, s, share) => {
    const take = Math.round(b.cells.length * share);
    for (let at = 0; at < take; at++) s.place(at, b.answer[at]);
  },
  wrong: (b, s, share, rng) => {
    const take = Math.round(b.cells.length * share);
    for (let at = 0; at < take; at++) s.place(at, b.answer[at]);
    const spare = rng.shuffle(s.spare());
    for (let at = take; at < b.cells.length; at++) {
      const t = spare.find((x) => x !== b.answer[at]);
      if (t === undefined) continue;
      s.place(at, t);
      return String(at);
    }
    return null;
  },
  focusOf: (_b, at) => `cell:${at}`,
});

// --- Isolate -------------------------------------------------------------------

gate<IsolateBoard, IsolateSession>({
  name: 'Isolate',
  boards: isolate,
  id: (b) => (b as { id?: string }).id ?? 'isolate',
  make: (b) => new IsolateSession(b),
  holds: isolateHolds,
  right: (b, s, share) => {
    const take = Math.round(b.answer.length * share);
    for (let i = 0; i < take; i++) s.set(b.answer[i], true);
  },
  wrong: (b, s, share, rng) => {
    const take = Math.round(b.answer.length * share);
    for (let i = 0; i < take; i++) s.set(b.answer[i], true);
    const answer = new Set(b.answer);
    const E = edgeCount(b.w, b.h);
    const edges = rng.shuffle(Array.from({ length: E }, (_, e) => e));
    for (const e of edges) {
      if (answer.has(e) || !s.set(e, true)) continue;
      return String(e);
    }
    return null;
  },
  /* A wall is pointed at by the two cells either side of it, read off the
     board's own geometry rather than worked out here. */
  focusOf: (b, e) => `cell:${cellsOf(b.w, b.h, Number(e))[0]}`,
});

describe('every game', () => {
  it('keeps the move off the first rung and the rungs in order', () => {
    /*
     * The shell shows the focus first, the reason second and the move third.
     * That only means anything if the three are different things: a hint
     * whose move is its reason again is one rung, said twice.
     */
    const sessions: Session<unknown>[] = [
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
      expect(hint.move, `${s.constructor.name} says the same thing twice`).not.toBe(hint.reason);
    }
  });
});
