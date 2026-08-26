import { describe, it, expect } from 'vitest';
import {
  compile, runIsLegal, runsConflict, segSegDist2, segPointDist2, segRectDist2,
  turnAngle, CLEAR_POST, CLEAR_STRING, MIN_TURN_DEG, MIN_RUN, WRAP,
  viewOf, DRAW_R, type Board, type Pt,
} from '../../src/core/board.js';
import { judge, firstBreak, whatIsLeft } from '../../src/core/check.js';
import { search } from '../../src/core/search.js';

const board = (over: Partial<Board> = {}): Board => ({
  id: 't', mode: 'classic', chapter: 1, posts: [], blocks: [],
  strands: [{ from: -1, to: -1, color: '#000' }], solution: [], ...over,
});

const SQUARE: Pt[] = [[20, 20], [80, 20], [80, 80], [20, 80]];

describe('distance, which the whole rule rests on', () => {
  it('measures a point against a segment, including past its ends', () => {
    expect(segPointDist2([0, 0], [10, 0], [5, 3])).toBeCloseTo(9);
    expect(segPointDist2([0, 0], [10, 0], [-4, 0])).toBeCloseTo(16);
    expect(segPointDist2([0, 0], [10, 0], [14, 3])).toBeCloseTo(25);
  });

  it('gives zero for segments that cross, so crossing needs no separate test', () => {
    expect(segSegDist2([0, 0], [10, 10], [0, 10], [10, 0])).toBe(0);
  });

  it('measures parallel segments by their gap', () => {
    expect(segSegDist2([0, 0], [10, 0], [0, 4], [10, 4])).toBeCloseTo(16);
  });

  it('measures segments that share an endpoint as touching', () => {
    expect(segSegDist2([0, 0], [10, 0], [10, 0], [10, 10])).toBe(0);
  });

  it('measures a segment against a rectangle, inside and out', () => {
    const r = { x: 10, y: 10, w: 10, h: 10 };
    expect(segRectDist2([0, 15], [30, 15], r)).toBe(0);
    expect(segRectDist2([0, 0], [0, 30], r)).toBeCloseTo(100);
  });

  it('reads a turn as 180 straight on and 0 straight back', () => {
    expect(turnAngle([0, 0], [10, 0], [20, 0])).toBeCloseTo(180);
    expect(turnAngle([0, 0], [10, 0], [0, 0])).toBeCloseTo(0);
    expect(turnAngle([0, 0], [10, 0], [10, 10])).toBeCloseTo(90);
  });
});

describe('what a run may do', () => {
  it('refuses a run that would clip a post it does not use', () => {
    // Three in a row: the outer two cannot run straight through the middle.
    const b = board({ posts: [[20, 50], [50, 50], [80, 50]] });
    expect(runIsLegal(b, 0, 2)).toBe(false);
    expect(runIsLegal(b, 0, 1)).toBe(true);
  });

  it('lets a run past a post that is far enough off the line', () => {
    const clear = CLEAR_POST + 0.5;
    const b = board({ posts: [[20, 50], [50, 50 + clear], [80, 50]] });
    expect(runIsLegal(b, 0, 2)).toBe(true);
  });

  it('refuses a run that crosses a block', () => {
    const b = board({
      posts: [[20, 50], [80, 50]],
      blocks: [{ x: 45, y: 40, w: 10, h: 20 }],
    });
    expect(runIsLegal(b, 0, 1)).toBe(false);
  });

  it('holds a grid board to its lattice', () => {
    const posts: Pt[] = [[20, 20], [50, 20], [20, 50], [50, 50]];
    const b = board({ mode: 'grid', posts, lattice: { cols: 2, rows: 2 } });
    expect(runIsLegal(b, 0, 1)).toBe(true);   // along a row
    expect(runIsLegal(b, 0, 2)).toBe(true);   // down a column
    expect(runIsLegal(b, 0, 3)).toBe(false);  // the diagonal is not a lattice run
  });
});

describe('when two runs cannot share a board', () => {
  it('calls two runs that cross a conflict', () => {
    const b = board({ posts: SQUARE });
    expect(runsConflict(b, { a: 0, b: 2 }, { a: 1, b: 3 })).toBe(true);
  });

  it('leaves two far-apart runs alone', () => {
    const b = board({ posts: SQUARE });
    expect(runsConflict(b, { a: 0, b: 1 }, { a: 2, b: 3 })).toBe(false);
  });

  /*
   * A hairpin at post 0: two legs of length 40 leaving it `deg` apart. This is
   * the shape the whole fold rule is about — a string going back on itself.
   */
  const hairpin = (deg: number): Board => {
    const r = (deg * Math.PI) / 360;
    return board({
      posts: [
        [50, 50],
        [50 + 40 * Math.cos(-r), 50 + 40 * Math.sin(-r)],
        [50 + 40 * Math.cos(r), 50 + 40 * Math.sin(r)],
      ],
    });
  };
  const folds = (deg: number) => runsConflict(hairpin(deg), { a: 0, b: 1 }, { a: 0, b: 2 });

  it('lets a string go back on itself', () => {
    // The complaint this rule exists to answer: a turn far sharper than a
    // right angle is a perfectly good move, and used to be refused outright.
    expect(folds(90)).toBe(false);
    expect(folds(60)).toBe(false);
    expect(folds(45)).toBe(false);
    expect(folds(35)).toBe(false);
  });

  it('refuses a fold that lies along itself', () => {
    // Past the nail the two legs are still on top of each other. That is not
    // going back on yourself, it is drawing the same string twice.
    expect(folds(20)).toBe(true);
    expect(folds(10)).toBe(true);
    expect(folds(1)).toBe(true);
  });

  it('turns over exactly where the geometry says it should', () => {
    // MIN_TURN_DEG is derived from WRAP and the string width, and nothing
    // reads it to make a decision — so this is a real check that the
    // measurement and the stated number are the same rule, not a restatement.
    expect(MIN_TURN_DEG).toBeCloseTo(28.955, 2);
    expect(folds(MIN_TURN_DEG + 0.05)).toBe(false);
    expect(folds(MIN_TURN_DEG - 0.05)).toBe(true);
  });

  it('measures the fold rather than reading the angle off a table', () => {
    // Same turn, longer legs: the answer must not change. It is the distance
    // between the two pieces of string that decides, and that is set at the
    // edge of the wrap, not at the far ends.
    const wide = board({
      posts: [[50, 50], [50 + 90 * Math.cos(-0.3), 50 + 90 * Math.sin(-0.3)],
        [50 + 90 * Math.cos(0.3), 50 + 90 * Math.sin(0.3)]],
    });
    const deg = turnAngle(wide.posts[1], wide.posts[0], wide.posts[2]);
    expect(runsConflict(wide, { a: 0, b: 1 }, { a: 0, b: 2 })).toBe(deg < MIN_TURN_DEG);
  });

  it('keeps a measured middle in every run', () => {
    // The wrap allowance is a hole in the contact test, and MIN_RUN is what
    // stops it becoming a hole in the rule: a run shorter than two wraps would
    // be excused at both ends at once and never checked anywhere.
    expect(MIN_RUN).toBeGreaterThan(2 * WRAP);
    expect(MIN_RUN - 2 * WRAP).toBeGreaterThanOrEqual(CLEAR_STRING);
    const close = board({ posts: [[50, 50], [50 + MIN_RUN - 0.5, 50]] });
    expect(runIsLegal(close, 0, 1)).toBe(false);
    const clear = board({ posts: [[50, 50], [50 + MIN_RUN + 0.5, 50]] });
    expect(runIsLegal(clear, 0, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The one that matters: the searcher and the judge must agree
// ---------------------------------------------------------------------------

/** Every ordering of the posts, judged directly. Only sane for small n. */
function bruteForce(b: Board): string[] {
  const c = compile(b);
  const n = b.posts.length;
  const out = new Set<string>();
  const perm: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const rec = () => {
    if (perm.length === n) {
      // The strand is the whole permutation; Classic has one.
      if (judge(c, [perm]).solved && perm[0] < perm[n - 1]) out.add(perm.join(','));
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; perm.push(i);
      rec();
      perm.pop(); used[i] = false;
    }
  };
  rec();
  return [...out].sort();
}

describe('the window on the board', () => {
  it('covers everything the board draws, ring and all', () => {
    // A post at the very edge with the widest thing drawn around it. The old
    // fixed 8..92 window cut exactly this off, which is what shaved the top
    // and bottom rows on a phone.
    const b = board({ posts: [[6, 6], [90, 90]] });
    const v = viewOf(b);
    expect(v.x).toBeLessThanOrEqual(6 - DRAW_R);
    expect(v.y).toBeLessThanOrEqual(6 - DRAW_R);
    expect(v.x + v.side).toBeGreaterThanOrEqual(90 + DRAW_R);
    expect(v.y + v.side).toBeGreaterThanOrEqual(90 + DRAW_R);
  });

  it('covers the blocks too', () => {
    const b = board({
      posts: [[50, 50], [70, 70]],
      blocks: [{ x: 2, y: 3, w: 5, h: 5 }],
    });
    const v = viewOf(b);
    expect(v.x).toBeLessThanOrEqual(2);
    expect(v.y).toBeLessThanOrEqual(3);
  });

  it('is square, because the surface is', () => {
    // A board wider than it is tall still gets a square window, centred —
    // otherwise the shorter axis letterboxes and thumb-to-board needs to know.
    const b = board({ posts: [[10, 48], [90, 52]] });
    const v = viewOf(b);
    const midX = v.x + v.side / 2;
    const midY = v.y + v.side / 2;
    expect(midX).toBeCloseTo(50);
    expect(midY).toBeCloseTo(50);
  });
});

describe('the searcher agrees with judging every ordering by hand', () => {
  const cases: [string, Board][] = [
    ['four in a square', board({ posts: SQUARE })],
    ['five with one in the middle', board({
      posts: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 50]],
    })],
    ['six, two of them close together', board({
      posts: [[15, 25], [50, 15], [85, 25], [85, 75], [50, 88], [15, 75]],
    })],
    ['five with a block through the middle', board({
      posts: [[15, 20], [85, 20], [85, 80], [15, 80], [50, 90]],
      blocks: [{ x: 40, y: 30, w: 20, h: 40 }],
    })],
  ];

  for (const [name, b] of cases) {
    it(name, () => {
      const c = compile(b);
      const found = search(c, 5000, 5_000_000);
      expect(found.exhausted, 'the search did not finish').toBe(false);
      const bySearch = found.solutions.map((s) => s[0].join(',')).sort();
      expect(bySearch).toEqual(bruteForce(b));
      // And everything it returned really is solved, by the judge.
      for (const s of found.solutions) expect(judge(c, s).solved).toBe(true);
    });
  }
});

describe('judging says what is wrong, not just that something is', () => {
  const b = board({ posts: SQUARE });
  const c = compile(b);

  it('accepts the perimeter', () => {
    expect(judge(c, [[0, 1, 2, 3]]).solved).toBe(true);
  });

  it('names the leftover posts', () => {
    const v = judge(c, [[0, 1]]);
    expect(v.solved).toBe(false);
    expect(v.faults).toContain('unused');
    expect(v.unused).toEqual([2, 3]);
    expect(v.progress).toBeCloseTo(0.5);
  });

  it('names a post used twice', () => {
    expect(judge(c, [[0, 1, 2, 1]]).faults).toContain('reuse');
  });

  it('names two strings that touch', () => {
    const two = board({
      posts: SQUARE,
      strands: [{ from: 0, to: 2, color: '#a' }, { from: 1, to: 3, color: '#b' }],
    });
    const cc = compile(two);
    const v = judge(cc, [[0, 2], [1, 3]]);
    expect(v.faults).toContain('touch');
    expect(v.clashes.length).toBeGreaterThan(0);
  });

  it('says nothing about leftover posts while a string is still being drawn', () => {
    expect(judge(c, [[0, 1]], true).faults).not.toContain('unused');
  });

  it('still refuses a touch while a string is being drawn', () => {
    const two = board({
      posts: SQUARE,
      strands: [{ from: 0, to: 2, color: '#a' }, { from: 1, to: 3, color: '#b' }],
    });
    expect(judge(compile(two), [[0, 2], [1, 3]], true).faults).toContain('touch');
  });

  /*
   * The split that decides what turns red. A board that is merely unfinished
   * is unfinished from the first move to the last, so if that showed as a
   * warning the warning would be on for the whole game and could never be seen
   * to go — which is exactly what "warnings don't disappear" means from the
   * player's chair.
   */
  it('does not call an unfinished board a broken one', () => {
    const v = judge(c, [[0, 1]]);
    expect(v.faults).toContain('unused');
    expect(v.broken).toEqual([]);
    expect(firstBreak(v)).toBe('');
    expect(whatIsLeft(v)).toBe('2 posts to go');
  });

  it('calls a broken board broken, and stops the moment it is mended', () => {
    const bad = judge(c, [[0, 1, 2, 1]]);
    expect(bad.broken).toContain('reuse');
    expect(firstBreak(bad)).not.toBe('');
    // The same board with the repeat taken back off: the warning has to go
    // with its cause, and nothing else may take its place.
    const mended = judge(c, [[0, 1, 2]]);
    expect(mended.broken).toEqual([]);
    expect(firstBreak(mended)).toBe('');
  });

  it('says nothing at all once every post is used and nothing is wrong', () => {
    expect(whatIsLeft(judge(c, [[0, 1, 2, 3]]))).toBe('');
  });
});

describe('coloured boards', () => {
  it('needs each string to join its own two ends', () => {
    const b = board({
      mode: 'coloured',
      posts: [[15, 20], [85, 20], [15, 80], [85, 80]],
      strands: [{ from: 0, to: 1, color: '#a' }, { from: 2, to: 3, color: '#b' }],
    });
    const c = compile(b);
    expect(judge(c, [[0, 1], [2, 3]]).solved).toBe(true);
    expect(judge(c, [[0, 2], [1, 3]]).faults).toContain('ends');
  });

  it('finds the one way to cover a board with two strings', () => {
    const b = board({
      mode: 'coloured',
      posts: [[15, 20], [85, 20], [15, 80], [85, 80], [50, 20], [50, 80]],
      strands: [{ from: 0, to: 1, color: '#a' }, { from: 2, to: 3, color: '#b' }],
    });
    const c = compile(b);
    const r = search(c, 50, 2_000_000);
    expect(r.exhausted).toBe(false);
    expect(r.solutions.length).toBeGreaterThan(0);
    for (const s of r.solutions) expect(judge(c, s).solved).toBe(true);
  });
});

describe('a search that ran out of budget says so', () => {
  it('never reports an abandoned walk as an exhaustive one', () => {
    // A board far too big to settle inside a handful of nodes. Whatever comes
    // back, it must not claim to have looked everywhere — a board shipped on
    // that claim would be one whose second answer was merely never reached.
    const posts: Pt[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) posts.push([12 + x * 15, 12 + y * 15]);
    const b = board({ posts });
    const r = search(compile(b), 2, 500);
    expect(r.nodes).toBeLessThanOrEqual(500 + 1);
    if (r.solutions.length < 2) expect(r.exhausted).toBe(true);
  });
});
