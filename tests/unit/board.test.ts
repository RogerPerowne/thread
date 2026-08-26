import { describe, it, expect } from 'vitest';
import {
  compile, runIsLegal, runClears, runsConflict, segSegDist2, segPointDist2, segRectDist2,
  turnAngle, CLEAR_POST, viewOf, DRAW_R, type Board, type Pt,
} from '../../src/games/thread/board.js';
import { judge, firstBreak, whatIsLeft } from '../../src/games/thread/check.js';
import { search } from '../../src/games/thread/search.js';

const board = (over: Partial<Board> = {}): Board => ({
  id: 't', chapter: 1, posts: [], blocks: [],
  strands: [{ from: 0, to: 1, color: '#000' }], solution: [],
  lattice: { cols: 1, rows: 1 }, ...over,
});

/*
 * Four posts in lattice order: across the top row, then across the bottom.
 * Post indices ARE lattice positions, so a fixture that lays them out any
 * other way is a fixture testing runs the game cannot make.
 */
const SQUARE: Pt[] = [[20, 20], [80, 20], [20, 80], [80, 80]];
const SQ = { cols: 2, rows: 2 };

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
    expect(runClears(b, 0, 2)).toBe(false);
    expect(runClears(b, 0, 1)).toBe(true);
  });

  it('lets a run past a post that is far enough off the line', () => {
    const clear = CLEAR_POST + 0.5;
    const b = board({ posts: [[20, 50], [50, 50 + clear], [80, 50]] });
    expect(runClears(b, 0, 2)).toBe(true);
  });

  it('refuses a run that crosses a block', () => {
    const b = board({
      posts: [[20, 50], [80, 50]],
      blocks: [{ x: 45, y: 40, w: 10, h: 20 }],
    });
    expect(runClears(b, 0, 1)).toBe(false);
  });

  it('holds every board to its lattice', () => {
    const posts: Pt[] = [[20, 20], [50, 20], [20, 50], [50, 50]];
    const b = board({ posts, lattice: { cols: 2, rows: 2 } });
    expect(runIsLegal(b, 0, 1)).toBe(true);   // along a row
    expect(runIsLegal(b, 0, 2)).toBe(true);   // down a column
    expect(runIsLegal(b, 0, 3)).toBe(false);  // the diagonal is not a lattice run
  });
});

describe('when two runs cannot share a board', () => {
  it('calls two runs that cross a conflict', () => {
    const b = board({ posts: [[20, 20], [80, 20], [80, 80], [20, 80]] });
    expect(runsConflict(b, { a: 0, b: 2 }, { a: 1, b: 3 })).toBe(true);
  });

  it('leaves two far-apart runs alone', () => {
    const b = board({ posts: SQUARE });
    expect(runsConflict(b, { a: 0, b: 1 }, { a: 2, b: 3 })).toBe(false);
  });

  /*
   * A hairpin at post 0: two legs of length 40 leaving it `deg` apart. This is
   * the shape the fold argument was always about — a string going back on
   * itself.
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

  it('never calls a turn a fault, however tight', () => {
    // Two runs meeting at a post are one string wrapped round a nail. A wrap
    // touches itself at the nail; that is what wrapping is, and no measurement
    // of it should ever have produced a rule.
    for (const deg of [170, 90, 60, 45, 30, 20, 10, 2]) {
      expect(folds(deg), `${deg} degrees was refused`).toBe(false);
    }
  });

  it('still refuses two runs that lie across each other', () => {
    const b = board({ posts: [[20, 20], [80, 20], [80, 80], [20, 80]] });
    expect(runsConflict(b, { a: 0, b: 2 }, { a: 1, b: 3 })).toBe(true);
  });

  it('leaves how tight a fold can get to the geometry', () => {
    /*
     * Nothing legislates a minimum turn, but one exists anyway: the leg coming
     * back has to clear the post it came from, like any run that does not use
     * it. So a string cannot fold flat, and it is `runIsLegal` that says so
     * rather than a number anybody chose.
     */
    const flat = hairpin(3);
    expect(runClears(flat, 0, 1)).toBe(false);
    expect(runClears(flat, 0, 2)).toBe(false);
    const open = hairpin(20);
    expect(runClears(open, 0, 1)).toBe(true);
    expect(runClears(open, 0, 2)).toBe(true);
    // And where it gives way depends on how long the legs are, which is what
    // makes it geometry rather than a limit in disguise: the same angle on
    // shorter legs puts the far post closer to the line.
    expect(runsConflict(hairpin(3), { a: 0, b: 1 }, { a: 0, b: 2 })).toBe(false);
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
    expect(v.x + v.w).toBeGreaterThanOrEqual(90 + DRAW_R);
    expect(v.y + v.h).toBeGreaterThanOrEqual(90 + DRAW_R);
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

  it('is the shape of what it holds, so a wide board fills a wide screen', () => {
    /*
     * It used to be squared up, on the grounds that the surface was square.
     * The surface takes its shape from this instead now, so a board wider than
     * it is tall is drawn across the whole width rather than being given a
     * margin down each side that nothing is in.
     */
    const b = board({ posts: [[10, 48], [90, 52]] });
    const v = viewOf(b);
    expect(v.w / v.h).toBeGreaterThan(2);
    expect(v.x + v.w / 2).toBeCloseTo(50);
    expect(v.y + v.h / 2).toBeCloseTo(50);
  });
});

describe('the searcher agrees with judging every ordering by hand', () => {
  const cases: [string, Board][] = [
    ['four in a square', board({ posts: SQUARE, lattice: SQ })],
    ['six in two rows', board({
      posts: [[20, 20], [50, 20], [80, 20], [20, 60], [50, 60], [80, 60]],
      lattice: { cols: 3, rows: 2 },
      strands: [{ from: 0, to: 5, color: '#000' }],
    })],
    ['six with a wall across the middle', board({
      posts: [[20, 20], [50, 20], [80, 20], [20, 60], [50, 60], [80, 60]],
      lattice: { cols: 3, rows: 2 },
      blocks: [{ x: 48, y: 30, w: 4, h: 20 }],
      strands: [{ from: 0, to: 5, color: '#000' }],
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
  const b = board({
    posts: SQUARE, lattice: SQ, strands: [{ from: 0, to: 2, color: '#000' }],
  });
  const c = compile(b);

  it('accepts a run that covers the board and ends where it is pinned', () => {
    expect(judge(c, [[0, 1, 3, 2]]).solved).toBe(true);
  });

  it('names the leftover posts', () => {
    const v = judge(c, [[0, 1]]);
    expect(v.solved).toBe(false);
    expect(v.faults).toContain('unused');
    expect(v.unused).toEqual([2, 3]);
    expect(v.progress).toBeCloseTo(0.5);
  });

  it('names a post used twice', () => {
    expect(judge(c, [[0, 1, 3, 1]]).faults).toContain('reuse');
  });

  it('names a post two strings both want', () => {
    /*
     * On a lattice two runs can never lie ACROSS each other — every run is one
     * step long, so two of them either share a post or are a whole cell apart.
     * What is left of "nothing touching" is this: a post belongs to one string
     * and to one string only.
     */
    const two = board({
      posts: SQUARE, lattice: SQ,
      strands: [{ from: 0, to: 1, color: '#a' }, { from: 2, to: 3, color: '#b' }],
    });
    const v = judge(compile(two), [[0, 1, 3], [2, 3]]);
    expect(v.faults).toContain('reuse');
    expect(v.solved).toBe(false);
  });

  it('says nothing about leftover posts while a string is still being drawn', () => {
    expect(judge(c, [[0, 1]], true).faults).not.toContain('unused');
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
    const bad = judge(c, [[0, 1, 3, 1]]);
    expect(bad.broken).toContain('reuse');
    expect(firstBreak(bad)).not.toBe('');
    // The same board with the repeat taken back off: the warning has to go
    // with its cause, and nothing else may take its place.
    const mended = judge(c, [[0, 1, 3]]);
    expect(mended.broken).toEqual([]);
    expect(firstBreak(mended)).toBe('');
  });

  it('says nothing at all once every post is used and nothing is wrong', () => {
    expect(whatIsLeft(judge(c, [[0, 1, 3, 2]]))).toBe('');
  });
});

describe('boards with more than one string', () => {
  it('needs each string to join its own two ends', () => {
    const b = board({
      posts: SQUARE, lattice: SQ,
      strands: [{ from: 0, to: 1, color: '#a' }, { from: 2, to: 3, color: '#b' }],
    });
    const c = compile(b);
    expect(judge(c, [[0, 1], [2, 3]]).solved).toBe(true);
    expect(judge(c, [[0, 2], [1, 3]]).faults).toContain('ends');
  });

  it('finds the ways to cover a board with two strings', () => {
    const b = board({
      posts: [[20, 20], [50, 20], [80, 20], [20, 60], [50, 60], [80, 60]],
      lattice: { cols: 3, rows: 2 },
      strands: [{ from: 0, to: 2, color: '#a' }, { from: 3, to: 5, color: '#b' }],
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
    const b = board({ posts, lattice: { cols: 6, rows: 6 }, strands: [{ from: 0, to: 35, color: '#000' }] });
    const r = search(compile(b), 2, 500);
    expect(r.nodes).toBeLessThanOrEqual(500 + 1);
    if (r.solutions.length < 2) expect(r.exhausted).toBe(true);
  });
});
