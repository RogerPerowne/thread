/**
 * The board, and the one rule.
 *
 * A board is POSTS (discs of real radius) and BLOCKS (rectangles). You lay
 * STRING from post to post. String has thickness. There is no target shape
 * anywhere in this game: you are not copying a picture, you are solving a
 * routing problem.
 *
 *   Use every post. String never lies on other string, or on itself.
 *   String never crosses a block.
 *
 * The whole game is that sentence, so it is worth being exact about what
 * "lies on" means. The string a player sees is the centreline through post
 * centres, stroked at `2 * STRING_W` with round caps and joins — and the set
 * of points a round-joined stroke covers is exactly the set within STRING_W of
 * the centreline. So the drawing and the rule are the same object, and the
 * checks below are exact rather than an approximation of what is on screen:
 *
 *   two strings touch        <=>  centrelines come within 2 * STRING_W
 *   string hits a post       <=>  centreline comes within POST_R + STRING_W
 *                                 of a post it does not use
 *   string hits a block      <=>  centreline comes within STRING_W of it
 *
 * A string may go back on itself as sharply as it likes. It is one piece of
 * string round a row of nails, and a string that turns at a nail is wrapped
 * round it — the two legs of a wrap are in contact at the nail, and that is
 * the one contact this game allows. WRAP below says how much string a nail
 * holds; past that a hairpin's legs are measured against each other like any
 * other pair, so a fold that separates is fine and a fold that runs alongside
 * itself is not. That is the difference between going back on yourself and
 * lying on yourself, and it is the only thing the sharpness of a turn decides.
 *
 * This is where post width earns its place. A post used by the red string is a
 * pillar the blue string has to get around, so the gap between two posts is
 * only passable if it is wider than the string. That is the tension the game
 * is made of: a gap just wide enough for one string, and two strings that both
 * want it.
 *
 * The string does not wrap the posts it uses — it runs through them. A version
 * that wrapped the rim was tried and dropped: it made the drawn shape stray
 * from the line the rule measures, so the rule had to be widened to cover the
 * stray, and a rule that is stricter than the picture is a rule that refuses
 * moves which look fine.
 */

export type Pt = readonly [number, number];

/** Board space is 0..100 on both axes, whatever the screen is. */
export const BOARD = 100;

/**
 * The part of board space worth showing. Posts are laid inside a margin, so
 * drawing the full 0..100 square wastes about a fifth of a phone screen on
 * blank paper — and on a phone that fifth is the difference between a post you
 * can hit with a thumb and one you cannot.
 */
export const VIEW = { at: 8, side: BOARD - 16 };

/** A post's radius, and the string's half-width, in board units. */
export const POST_R = 2.0;
export const STRING_W = 1.0;

/**
 * How much string a nail can hold against itself: the wrap allowance.
 *
 * A string that turns at a post is wrapped round a nail, and the two legs of
 * a wrap are in contact at the nail — that is what wrapping IS, and it is the
 * one place a string is allowed to touch itself. So contact is ignored within
 * WRAP of the post the two runs turn at, and measured everywhere else, exactly
 * as it is for two runs that share nothing.
 *
 * This is the one place the rule is looser than the picture, so it is worth
 * being exact about the size of it: at a fold you will see the string bunched
 * against itself for about this far either side of the nail, and no further.
 */
export const WRAP = 4;

export type Block = { x: number; y: number; w: number; h: number };

export type Strand = {
  /** Index into `Board.posts`. */
  readonly from: number;
  readonly to: number;
  /** Ink. Classic has one strand and one colour; Coloured has several. */
  readonly color: string;
};

export type Board = {
  readonly id: string;
  readonly mode: 'classic' | 'coloured' | 'grid';
  /** Which chapter it belongs to, 1-based. Chapters get bigger as you go. */
  readonly chapter: number;
  readonly posts: readonly Pt[];
  readonly blocks: readonly Block[];
  /**
   * The strands to lay, each with its two ends already pinned. Classic pins
   * nothing, so it has one strand with from = to = -1: any post may be an end.
   */
  readonly strands: readonly Strand[];
  /** Grid boards run post to post along the lattice only. */
  readonly lattice?: { cols: number; rows: number };
  /** The answer, as one ordered post list per strand. */
  readonly solution: readonly (readonly number[])[];
};

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Squared distance from p to the segment ab. */
export function segPointDist2(a: Pt, b: Pt, p: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - t * vx;
  const dy = wy - t * vy;
  return dx * dx + dy * dy;
}

/**
 * Squared distance between two segments.
 *
 * Segments that cross are at distance zero, so the crossing test falls out of
 * the same call rather than needing a separate orientation test — one code
 * path, and no chance of the two disagreeing on a shared endpoint.
 */
export function segSegDist2(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (denom !== 0) {
    const qpx = c[0] - a[0];
    const qpy = c[1] - a[1];
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * ry - qpy * rx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    segPointDist2(a, b, c), segPointDist2(a, b, d),
    segPointDist2(c, d, a), segPointDist2(c, d, b),
  );
}

/** Squared distance from p to an axis-aligned rectangle (0 inside). */
export function rectPointDist2(r: Block, p: Pt): number {
  const dx = Math.max(r.x - p[0], 0, p[0] - (r.x + r.w));
  const dy = Math.max(r.y - p[1], 0, p[1] - (r.y + r.h));
  return dx * dx + dy * dy;
}

/** Squared distance from the segment ab to an axis-aligned rectangle. */
export function segRectDist2(a: Pt, b: Pt, r: Block): number {
  const inside = (p: Pt) =>
    p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
  if (inside(a) || inside(b)) return 0;
  const c: Pt[] = [
    [r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
  ];
  return Math.min(
    segSegDist2(a, b, c[0], c[1]), segSegDist2(a, b, c[1], c[2]),
    segSegDist2(a, b, c[2], c[3]), segSegDist2(a, b, c[3], c[0]),
  );
}

/**
 * The turn at `mid`, in degrees: 180 is straight on, 0 is straight back.
 *
 * Nothing in the rule reads this any more. A turn used to be refused for being
 * sharper than a number; now the two legs are measured against each other like
 * any other pair of runs, and how sharp the turn was is a description of what
 * happened rather than the reason it happened. It is kept because saying "that
 * turn is 34 degrees" is how the rule gets talked about and tested.
 */
export function turnAngle(prev: Pt, mid: Pt, next: Pt): number {
  const ax = prev[0] - mid[0];
  const ay = prev[1] - mid[1];
  const bx = next[0] - mid[0];
  const by = next[1] - mid[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la === 0 || lb === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Compiling a board
// ---------------------------------------------------------------------------

/*
 * The clearances the rule is stated in, pre-squared for the inner loops.
 *
 * A post has no width as far as the string is concerned: the string runs from
 * centre to centre and straight through, rather than wrapping the rim. That
 * makes the drawing and the rule the same object again — a polyline stroked at
 * 2 * STRING_W with round caps and joins covers exactly the points within
 * STRING_W of its centreline — so these are exact, not a bound on something
 * else.
 *
 * Post width still matters for what a string may pass: a post the red string
 * uses is a pillar the blue one has to get around, and the gap between two
 * posts is only passable if it is wider than the string.
 */

/** How far apart two strings' centre lines have to stay. */
export const CLEAR_STRING = 2 * STRING_W;
/** How far a string has to stay from a post it does not use. */
export const CLEAR_POST = POST_R + STRING_W;
/** How far a string has to stay from a block. */
export const CLEAR_BLOCK = STRING_W;

/**
 * The shortest run there may be.
 *
 * A turn at each end of a run costs WRAP of it, and what is left is the part
 * the contact test actually looks at. A run shorter than twice WRAP would be
 * swallowed whole by the wrap allowance at its two ends and never measured at
 * all — string could lie on top of it and nothing would say so. Requiring
 * CLEAR_STRING of measured middle is what stops the allowance from opening a
 * hole in the rule, rather than a length that seemed about right.
 */
export const MIN_RUN = 2 * WRAP + CLEAR_STRING;

const CLEAR_STRING2 = CLEAR_STRING ** 2;
const MIN_RUN2 = MIN_RUN ** 2;
const CLEAR_POST2 = CLEAR_POST ** 2;
const CLEAR_BLOCK2 = CLEAR_BLOCK ** 2;

export type Run = { readonly a: number; readonly b: number };

/**
 * A board with everything that never changes worked out once: which runs are
 * legal at all, and which pairs of legal runs cannot both be used.
 *
 * Both the solver and the live check ask these questions thousands of times,
 * and the answers depend only on the posts and blocks — so they are computed
 * on load and then only looked up. This is what keeps the play loop free of
 * geometry: dragging a string is an array index, not a distance.
 */
export type Compiled = {
  readonly board: Board;
  /** Legal runs, in a stable order. */
  readonly runs: readonly Run[];
  /** runId(a, b) -> index into `runs`, or -1. Symmetric. */
  readonly runId: Int32Array;
  /** Post -> the posts it can run to. */
  readonly neighbours: readonly (readonly number[])[];
  /** Bitset per run: runs it may not share a board with. */
  readonly conflicts: readonly Uint32Array[];
  readonly n: number;
};

/**
 * Is a direct run from post a to post b legal in isolation? It must be long
 * enough to be measured (see MIN_RUN), clear every other post, clear every
 * block, and — on a grid board — join lattice neighbours rather than cutting
 * across.
 */
export function runIsLegal(board: Board, a: number, b: number): boolean {
  if (a === b) return false;
  const pa = board.posts[a];
  const pb = board.posts[b];
  if ((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 < MIN_RUN2) return false;
  if (board.lattice) {
    const { cols } = board.lattice;
    const ax = a % cols, ay = (a / cols) | 0;
    const bx = b % cols, by = (b / cols) | 0;
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;
  }
  for (let i = 0; i < board.posts.length; i++) {
    if (i === a || i === b) continue;
    if (segPointDist2(pa, pb, board.posts[i]) < CLEAR_POST2) return false;
  }
  for (const blk of board.blocks) {
    if (segRectDist2(pa, pb, blk) < CLEAR_BLOCK2) return false;
  }
  return true;
}

/**
 * Pull `at` back along the run towards `to` by WRAP, so the string a nail
 * holds is left out of the measurement. MIN_RUN keeps every run longer than
 * 2 * WRAP, so what comes back is always a real segment.
 */
function pastWrap(at: Pt, to: Pt): Pt {
  const len = Math.hypot(to[0] - at[0], to[1] - at[1]);
  if (len <= WRAP) return to;
  const t = WRAP / len;
  return [at[0] + (to[0] - at[0]) * t, at[1] + (to[1] - at[1]) * t];
}

/**
 * Can these two runs both appear on a finished board?
 *
 * One question, asked one way: do the two pieces of string come closer than
 * the string is thick? A string may go back on itself as sharply as it likes
 * — what it may not do is lie on itself. The only difference between a pair of
 * runs that turn at a shared post and a pair that share nothing is that the
 * shared post is a nail holding a wrap, so the WRAP of string either side of
 * it is left out of the measurement. Everything past that is measured the
 * same, which is why a hairpin whose legs separate is allowed and a fold that
 * runs alongside itself is not.
 */
export function runsConflict(board: Board, r: Run, s: Run): boolean {
  if ((r.a === s.a && r.b === s.b) || (r.a === s.b && r.b === s.a)) return false;
  const P = board.posts;
  let [ra, rb] = [P[r.a], P[r.b]];
  let [sa, sb] = [P[s.a], P[s.b]];
  if (r.a === s.a || r.a === s.b) ra = pastWrap(P[r.a], P[r.b]);
  else if (r.b === s.a || r.b === s.b) rb = pastWrap(P[r.b], P[r.a]);
  if (s.a === r.a || s.a === r.b) sa = pastWrap(P[s.a], P[s.b]);
  else if (s.b === r.a || s.b === r.b) sb = pastWrap(P[s.b], P[s.a]);
  return segSegDist2(ra, rb, sa, sb) < CLEAR_STRING2;
}

/**
 * The sharpest turn that clears itself, in degrees — a consequence of WRAP
 * and the string's width rather than a number anyone picked. Two legs leaving
 * a nail at angle t are 2 * WRAP * sin(t / 2) apart at the edge of the wrap,
 * and they have to be CLEAR_STRING apart to be clear of each other.
 *
 * Nothing reads this to make a decision — `runsConflict` measures. It is here
 * because a rule you can only observe is a rule you cannot check, and the
 * tests hold the measurement to this number.
 */
export const MIN_TURN_DEG = (2 * Math.asin(Math.min(1, STRING_W / WRAP)) * 180) / Math.PI;

/*
 * Compiling is quadratic in the number of runs — every pair of them is checked
 * for conflict — so a thirty-post board costs tens of milliseconds. That is
 * nothing once, and a dropped frame if it happens while something is moving.
 * The result depends only on the board, which never changes, so it is kept.
 */
const compiled = new WeakMap<Board, Compiled>();

/** Compile ahead of time, so a board can be mounted without the pause. */
export function warmCompile(board: Board): void {
  compile(board);
}

export function compile(board: Board): Compiled {
  const had = compiled.get(board);
  if (had) return had;
  const made = compileFresh(board);
  compiled.set(board, made);
  return made;
}

function compileFresh(board: Board): Compiled {
  const n = board.posts.length;
  const runId = new Int32Array(n * n).fill(-1);
  const runs: Run[] = [];
  const neighbours: number[][] = Array.from({ length: n }, () => []);

  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (!runIsLegal(board, a, b)) continue;
      const id = runs.length;
      runs.push({ a, b });
      runId[a * n + b] = id;
      runId[b * n + a] = id;
      neighbours[a].push(b);
      neighbours[b].push(a);
    }
  }

  const words = (runs.length + 31) >> 5;
  const conflicts = runs.map(() => new Uint32Array(words));
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (!runsConflict(board, runs[i], runs[j])) continue;
      conflicts[i][j >> 5] |= 1 << (j & 31);
      conflicts[j][i >> 5] |= 1 << (i & 31);
    }
  }
  return { board, runs, runId, neighbours, conflicts, n };
}

/** Does run `i` conflict with run `j`? */
export function conflicts(c: Compiled, i: number, j: number): boolean {
  return (c.conflicts[i][j >> 5] & (1 << (j & 31))) !== 0;
}

/** The run joining two posts, or -1 if no legal run does. */
export function runBetween(c: Compiled, a: number, b: number): number {
  if (a < 0 || b < 0 || a >= c.n || b >= c.n) return -1;
  return c.runId[a * c.n + b];
}
