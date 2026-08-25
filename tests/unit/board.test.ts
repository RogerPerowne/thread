import { describe, it, expect } from 'vitest';
import {
  compile, runIsLegal, runsConflict, segSegDist2, segPointDist2, segRectDist2,
  turnAngle, CLEAR_POST, MIN_TURN_DEG, type Board, type Pt,
} from '../../src/core/board.js';
import { judge } from '../../src/core/check.js';
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

  it('judges runs that meet at a post by the sharpness of the turn', () => {
    // A hairpin: out and almost straight back.
    const posts: Pt[] = [[50, 50], [90, 50], [90 * Math.cos(0.1), 50 + 40 * Math.sin(0.1)]];
    const b = board({ posts });
    const sharp = turnAngle(posts[1], posts[0], posts[2]) < MIN_TURN_DEG;
    expect(runsConflict(b, { a: 0, b: 1 }, { a: 0, b: 2 })).toBe(sharp);
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
