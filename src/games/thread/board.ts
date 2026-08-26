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
 * A string may go back on itself as sharply as it likes, and how sharply is
 * nobody's business. It is one piece of string round a row of nails: a turn is
 * a wrap, the two legs of a wrap touch at the nail, and no amount of measuring
 * that contact turns it into a fault. So two runs that meet at a post are
 * never in conflict, full stop — the only thing that can go wrong between two
 * pieces of string is one lying across the other, and runs that share a nail
 * cannot do that.
 *
 * How tight a fold can get is therefore not a rule at all but a consequence:
 * the leg coming back has to clear the post it came from like any other run
 * that does not use it, so the geometry stops a string folding flat without
 * anyone having to legislate for it.
 */

export type Pt = readonly [number, number];

/** Board space is 0..100 on both axes, whatever the screen is. */
export const BOARD = 100;

/** A post's radius, and the string's half-width, in board units. */
export const POST_R = 2.0;
export const STRING_W = 1.0;

/**
 * The halo a post wears when there is no way to reach it, and how far it
 * swells. A post is two units across on a board that can hold sixty of them,
 * so a post that answers a refused move by changing colour is a dot changing
 * shade under the very hand covering it. The halo is what carries the answer,
 * which means it has to be big enough to read from across the screen.
 */
export const GLOW_R = POST_R * 2.8;
export const GLOW_SWELL = 1.15;

/**
 * How far outside a post's centre anything is ever drawn around it.
 *
 * The widest is the refusal halo at full swell. Behind it come the ring on a
 * pinned end (POST_R + 1.5, stroked at 1.2), a caught post swelling to 1.55 of
 * its radius, the 4.4-wide clash mark, the solve growing the string to three,
 * and the string's own cap at STRING_W.
 *
 * Taking this from the drawing rather than guessing is the difference between
 * a board that fits and one whose top row is shaved off — and it is why the
 * halo could be made larger without anyone having to remember to widen the
 * window by hand.
 */
export const DRAW_R = Math.max(POST_R + 2.1, GLOW_R * GLOW_SWELL);

/**
 * The most generous a thumb's reach is allowed to be, in board units.
 *
 * It lives here rather than with the play screen because it is a contract
 * between the designer and the player, not a tuning knob: a thumb sweeping
 * along a run catches everything it passes this close to, so a board whose
 * answer runs graze other posts would snatch them up mid-drag and there would
 * be no way to draw the answer at all. The gate holds every shipped board to
 * it.
 */
export const GRAB_MAX = 7;

export type Block = { x: number; y: number; w: number; h: number };

export type Strand = {
  /** Index into `Board.posts`. Both ends of a string are always pinned. */
  readonly from: number;
  readonly to: number;
  /** Ink. One per strand, never shared: the colour IS the instruction. */
  readonly color: string;
};

export type Board = {
  readonly id: string;
  /** Which chapter it belongs to, 1-based. Chapters get bigger as you go. */
  readonly chapter: number;
  readonly posts: readonly Pt[];
  readonly blocks: readonly Block[];
  /** The strings to lay, each with its two ends already pinned. */
  readonly strands: readonly Strand[];
  /** Posts sit on this lattice, and string runs from one post to the next. */
  readonly lattice: { cols: number; rows: number };
  /** The answer, as one ordered post list per strand. */
  readonly solution: readonly (readonly number[])[];
};

/**
 * How close a thumb has to get to catch a post on THIS board.
 *
 * A fixed reach cannot be right for every board. Nine posts spread over the
 * whole square want a generous one; a lattice of fifty-six has its posts about
 * eleven apart, and a reach of seven would leave a thumb halfway between two
 * of them inside both — so it would catch whichever happened to be marginally
 * nearer, which is a coin toss dressed up as an input.
 *
 * Half the closest gap is the line where that stops being possible: inside it,
 * the post you are nearest is the only one you are near. A little under half,
 * so the two never tie, and never more than GRAB_MAX, because past that the
 * generosity stops being generosity and starts catching posts you were only
 * passing.
 */
export function grabRadius(board: Board): number {
  let closest = Infinity;
  const P = board.posts;
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      const d2 = (P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2;
      if (d2 < closest) closest = d2;
    }
  }
  if (!Number.isFinite(closest)) return GRAB_MAX;
  return Math.min(GRAB_MAX, 0.45 * Math.sqrt(closest));
}

/** The window on board space that the drawing needs, in board units. */
export type View = {
  readonly x: number; readonly y: number;
  readonly w: number; readonly h: number;
};

/**
 * The part of board space this board actually occupies, squared up.
 *
 * It used to be one fixed window, 8..92, on the grounds that posts are laid
 * inside a margin and drawing the whole 0..100 square wastes a fifth of a
 * phone screen on blank paper. Both halves of that were wrong. Posts are
 * shaken off their lattice by up to 3.5, so they reach 7.35 — outside the
 * window — and around a pinned one there is another DRAW_R of ring, so the
 * top and bottom rows were being shaved off. And a fixed window is too big for
 * boards that do not fill it.
 *
 * Measuring the board instead fixes both: nothing can be cut off, because the
 * window is defined as everything that gets drawn, and a board that occupies
 * less of the square is drawn larger. It is not squared up: the box the board
 * is given takes its shape from this, so a lattice wider than it is tall fills
 * the width of the screen instead of leaving a margin down each side.
 */
export function viewOf(board: Board): View {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of board.posts) {
    x0 = Math.min(x0, x - DRAW_R); y0 = Math.min(y0, y - DRAW_R);
    x1 = Math.max(x1, x + DRAW_R); y1 = Math.max(y1, y + DRAW_R);
  }
  for (const b of board.blocks) {
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: BOARD, h: BOARD };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

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
 * Nothing in the rule reads this, and nothing should. It is here so a test can
 * say "this board's tightest turn is 34 degrees, and it is allowed", which is
 * a fact worth being able to state.
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

const CLEAR_STRING2 = CLEAR_STRING ** 2;
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
 * Is a direct run from post a to post b legal in isolation? It must join
 * lattice neighbours rather than cutting across, clear every other post, and
 * clear every wall.
 */
export function runIsLegal(board: Board, a: number, b: number): boolean {
  return a !== b && onLattice(board, a, b) && runClears(board, a, b);
}

/**
 * Do these two posts sit next to each other on the lattice?
 *
 * Posts are numbered along the lattice, so this is arithmetic rather than
 * geometry — and it is what keeps every run one step long, which is what makes
 * the board readable at a glance.
 */
export function onLattice(board: Board, a: number, b: number): boolean {
  const { cols } = board.lattice;
  const ax = a % cols, ay = (a / cols) | 0;
  const bx = b % cols, by = (b / cols) | 0;
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

/**
 * Does the straight run from a to b clear every post it does not use, and
 * every wall?
 *
 * The geometry half of the rule, on its own, so that it can be asked — and
 * tested — without the lattice answering first.
 */
export function runClears(board: Board, a: number, b: number): boolean {
  if (a === b) return false;
  const pa = board.posts[a];
  const pb = board.posts[b];
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
 * Can these two runs both appear on a finished board?
 *
 * One question: does one piece of string lie across the other? Two runs that
 * meet at a post cannot — they are the same string wrapped round a nail, and a
 * wrap is not a fault however tight it is. Everything else is the distance
 * between them, against the width of the string.
 *
 * There used to be a second half to this, refusing a turn that came back on
 * itself too sharply: first as a flat angle limit, then as a measurement past
 * an allowance for the nail. Both were wrong the same way. A string round a
 * post is entitled to touch itself there, so measuring that contact could only
 * ever produce a rule against something the player was allowed to do — and a
 * warning about it was a warning that could not be acted on.
 */
export function runsConflict(board: Board, r: Run, s: Run): boolean {
  if (r.a === s.a || r.a === s.b || r.b === s.a || r.b === s.b) return false;
  const P = board.posts;
  return segSegDist2(P[r.a], P[r.b], P[s.a], P[s.b]) < CLEAR_STRING2;
}

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
