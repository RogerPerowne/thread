/**
 * Isolate: draw walls until every pair of circles has a room of its own.
 *
 * A grid of cells with circles scattered over it. You draw walls along the
 * lines between cells, and the walls cut the grid into rooms. Every room has
 * to hold exactly two circles — that is the whole idea, and the name — and a
 * number written on a circle says how many cells its room takes up.
 *
 * Two smaller things, both of which are clues rather than decoration. A cross
 * printed where four cells meet says at least two walls have to meet there,
 * which is a fact about a corner and nothing else. And some walls are drawn
 * for you and cannot be rubbed out; they are part of the board, like a post is
 * in Thread.
 *
 * Everything below is edges. A wall is an edge between two cells, and the
 * rooms are what is left when you take the walls out of the grid — so there is
 * no separate notion of a room anywhere in the engine, only connected cells.
 * That is what makes the rules cheap to check on every move.
 */

/** Which side of a cell an edge lies on. */
export type Board = {
  readonly w: number;
  readonly h: number;
  /** Cells holding a circle. */
  readonly dots: readonly number[];
  /** Cell -> how many cells its room holds. Only some circles carry one. */
  readonly sizes: Readonly<Record<number, number>>;
  /** Corners where at least two walls have to meet, as interior vertices. */
  readonly crosses: readonly number[];
  /** Walls drawn on the board already, which cannot be rubbed out. */
  readonly given: readonly number[];
  /** The walls of the one answer. */
  readonly answer: readonly number[];
};

/**
 * The edges of a w by h grid, numbered once and for all.
 *
 * The vertical ones come first — the wall between (r, c) and (r, c + 1) — and
 * then the horizontal ones, between (r, c) and (r + 1, c). Nothing outside the
 * grid is an edge, because the outside of the board is a wall everywhere and
 * saying so twice invites the two copies to disagree.
 */
export const upright = (w: number, h: number): number => h * (w - 1);
export const edgeCount = (w: number, h: number): number => upright(w, h) + (h - 1) * w;

/** The edge between two neighbouring cells, or -1 if they do not touch. */
export function edgeBetween(w: number, h: number, a: number, b: number): number {
  const ar = (a / w) | 0;
  const ac = a % w;
  const br = (b / w) | 0;
  const bc = b % w;
  if (ar === br && Math.abs(ac - bc) === 1) return ar * (w - 1) + Math.min(ac, bc);
  if (ac === bc && Math.abs(ar - br) === 1) return upright(w, h) + Math.min(ar, br) * w + ac;
  return -1;
}

/** The two cells an edge separates. */
export function cellsOf(w: number, h: number, edge: number): [number, number] {
  const up = upright(w, h);
  if (edge < up) {
    const r = (edge / (w - 1)) | 0;
    const c = edge % (w - 1);
    return [r * w + c, r * w + c + 1];
  }
  const k = edge - up;
  const r = (k / w) | 0;
  const c = k % w;
  return [r * w + c, (r + 1) * w + c];
}

/** Every cell that touches this one, in reading order. */
export function neighbours(w: number, h: number, cell: number): number[] {
  const r = (cell / w) | 0;
  const c = cell % w;
  const out: number[] = [];
  if (r > 0) out.push(cell - w);
  if (c > 0) out.push(cell - 1);
  if (c < w - 1) out.push(cell + 1);
  if (r < h - 1) out.push(cell + w);
  return out;
}

/**
 * The four edges that meet at an interior corner.
 *
 * A corner is named by the cell to its bottom right, so corner (r, c) with
 * 1 <= r < h and 1 <= c < w is the point where cells (r-1, c-1), (r-1, c),
 * (r, c-1) and (r, c) meet. The four edges are the two upright ones above and
 * below it and the two flat ones left and right.
 */
export function edgesAtCorner(w: number, h: number, corner: number): number[] {
  const r = ((corner / (w - 1)) | 0) + 1;
  const c = (corner % (w - 1)) + 1;
  const up = upright(w, h);
  return [
    (r - 1) * (w - 1) + (c - 1),
    r * (w - 1) + (c - 1),
    up + (r - 1) * w + (c - 1),
    up + (r - 1) * w + c,
  ];
}

export const cornerCount = (w: number, h: number): number => (w - 1) * (h - 1);

/** Where a corner sits, in cell coordinates. */
export function cornerAt(w: number, corner: number): { x: number; y: number } {
  return { x: (corner % (w - 1)) + 1, y: ((corner / (w - 1)) | 0) + 1 };
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

export type Rooms = {
  /** Cell -> which room it is in. */
  readonly of: Int32Array;
  /** Room -> its cells. */
  readonly cells: number[][];
};

/** What the walls leave behind: the connected rooms of the grid. */
export function roomsOf(board: Board, walls: ReadonlySet<number>): Rooms {
  const { w, h } = board;
  const n = w * h;
  const of = new Int32Array(n).fill(-1);
  const cells: number[][] = [];
  for (let start = 0; start < n; start++) {
    if (of[start] >= 0) continue;
    const room = cells.length;
    const mine: number[] = [];
    const stack = [start];
    of[start] = room;
    while (stack.length > 0) {
      const cell = stack.pop()!;
      mine.push(cell);
      for (const other of neighbours(w, h, cell)) {
        if (of[other] >= 0) continue;
        const edge = edgeBetween(w, h, cell, other);
        if (walls.has(edge)) continue;
        of[other] = room;
        stack.push(other);
      }
    }
    cells.push(mine);
  }
  return { of, cells };
}

export type Fault = 'crowded' | 'lonely' | 'toobig' | 'toosmall';

export type Judgement = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  /** Rooms the player's own walls made that break a rule, as cell lists. */
  readonly wrong: readonly number[][];
  /** Corners still short of the two walls they want. */
  readonly waiting: readonly number[];
  readonly progress: number;
  readonly rooms: Rooms;
};

/**
 * Judge the board.
 *
 * The one thing this has to get right is which rooms it is allowed to talk
 * about. On an untouched board the whole grid is one room holding every
 * circle, and a judge that says so puts the board in red before the player has
 * done anything — the same mistake every game here has had to unlearn once.
 *
 * So a room is only judged when the player has WALLED it: at least one of the
 * walls round it is one they drew. A room you have not separated yet is not a
 * room you have got wrong, it is a room you have not made.
 */
export function judge(board: Board, walls: ReadonlySet<number>): Judgement {
  const { w, h } = board;
  const rooms = roomsOf(board, walls);
  const given = new Set(board.given);
  const dots = new Set(board.dots);

  const faults = new Set<Fault>();
  const wrong: number[][] = [];

  /** Did the player make this room, or is it just what was there? */
  const mine = (cells: readonly number[]): boolean => {
    for (const cell of cells) {
      for (const other of neighbours(w, h, cell)) {
        const edge = edgeBetween(w, h, cell, other);
        if (walls.has(edge) && !given.has(edge)) return true;
      }
    }
    return false;
  };

  let sound = true;
  for (const cells of rooms.cells) {
    const inside = cells.filter((c) => dots.has(c));
    const wants = cells.map((c) => board.sizes[c]).find((s) => s !== undefined);
    const bad: Fault[] = [];
    if (inside.length > 2) bad.push('crowded');
    if (inside.length < 2) bad.push('lonely');
    if (wants !== undefined && cells.length > wants) bad.push('toobig');
    if (wants !== undefined && cells.length < wants) bad.push('toosmall');
    if (bad.length === 0) continue;
    sound = false;
    if (!mine(cells)) continue;
    for (const f of bad) faults.add(f);
    wrong.push(cells);
  }

  const waiting: number[] = [];
  for (const corner of board.crosses) {
    const walled = edgesAtCorner(w, h, corner).filter((e) => walls.has(e)).length;
    if (walled < 2) waiting.push(corner);
  }

  /*
   * How much is done: the rooms that are finished and right, as a share of
   * the rooms there will be. Real progress, never a similarity to the answer.
   */
  const want = board.dots.length / 2;
  const good = rooms.cells.filter((cells) => {
    const inside = cells.filter((c) => dots.has(c)).length;
    const wants = cells.map((c) => board.sizes[c]).find((s) => s !== undefined);
    return inside === 2 && (wants === undefined || wants === cells.length);
  }).length;

  return {
    solved: sound && waiting.length === 0,
    faults: [...faults],
    wrong,
    waiting,
    progress: want === 0 ? 1 : Math.min(1, good / want),
    rooms,
  };
}

export const FAULT_TEXT: Record<Fault, string> = {
  crowded: 'A room you have walled off holds more than two circles',
  lonely: 'A room you have walled off holds fewer than two circles',
  toobig: 'A room is bigger than the number written in it',
  toosmall: 'A room is smaller than the number written in it',
};

const ORDER: readonly Fault[] = ['toosmall', 'crowded', 'lonely', 'toobig'];

export function firstFault(j: Judgement): string {
  for (const f of ORDER) if (j.faults.includes(f)) return FAULT_TEXT[f];
  return '';
}

export function whatIsLeft(board: Board, j: Judgement): string {
  if (firstFault(j) !== '') return '';
  const want = board.dots.length / 2;
  const done = Math.round(j.progress * want);
  if (j.waiting.length > 0 && done === want) {
    return j.waiting.length === 1
      ? 'One corner still wants two walls'
      : `${j.waiting.length} corners still want two walls`;
  }
  const left = want - done;
  if (left <= 0) return '';
  return left === 1 ? 'One room to go' : `${left} rooms to go`;
}
