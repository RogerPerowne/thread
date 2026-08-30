/**
 * Shape Up: every row and every column holds one of each shape, and the clues
 * round the edge say what you would see looking in.
 *
 * The board is a rectangle of cells. Each row holds exactly one of every shape
 * and the rest of it is empty; each column does the same. Around the outside
 * are clues, and a clue is three things — a shape, a direction, and whether it
 * is the FIRST shape you meet looking in or the SECOND: "looking along this
 * row from the left, the first shape you meet is a square", or "the second one
 * is a triangle".
 *
 * First or second, and no deeper. That is a rule about reading rather than
 * about arithmetic. "The first shape along" and "the one after it" are two
 * things a person can hold in their head while their eye runs down the line;
 * "the fourth shape along" is a thing you can only get by counting shapes that
 * are not on the board yet, which is the same clue dressed as a chore.
 *
 * Very little is given up for it, and the reason is worth writing down. Every
 * line holds exactly `shapes` shapes, so the kth shape counting from one end
 * is the (shapes + 1 - k)th counting from the other. With four shapes or fewer
 * that means EVERY depth is a first or a second read from one end or the
 * other, and the restriction costs the designer nothing at all — it only
 * changes which side the arrow sits on. Five shapes loses exactly one clue,
 * the middle one, which is a third from both ends. `allClues` is where this
 * happens and a unit test states it.
 *
 * Nothing assumes a square board or four shapes. A five by five with three
 * shapes and a seven by seven with five are the same engine.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * How deep a clue is allowed to look: the first shape, or the second.
 *
 * One place, because it is a rule of the game rather than a setting. The
 * engine below is written in terms of `depth` and would work at any ordinal;
 * what stops a third arriving is this constant and the generator that reads
 * it.
 */
export const MAX_DEPTH = 2;

export type Clue = {
  readonly side: Side;
  /** Which column (top and bottom) or row (left and right). */
  readonly line: number;
  /** 1..shapes. */
  readonly shape: number;
  /** 1 = the first shape you meet looking in, 2 = the second. Never more. */
  readonly depth: number;
};

export type Board = {
  readonly w: number;
  readonly h: number;
  /** How many distinct shapes. Every row and column holds one of each. */
  readonly shapes: number;
  readonly clues: readonly Clue[];
  /** The filled grid the clues were read off. 0 is empty. */
  readonly answer: readonly number[];
};

/** Cells of one line, in the order the clue on `side` sees them. */
export function sightLine(board: Board, side: Side, line: number): number[] {
  const { w, h } = board;
  const out: number[] = [];
  if (side === 'left') for (let c = 0; c < w; c++) out.push(line * w + c);
  else if (side === 'right') for (let c = w - 1; c >= 0; c--) out.push(line * w + c);
  else if (side === 'top') for (let r = 0; r < h; r++) out.push(r * w + line);
  else for (let r = h - 1; r >= 0; r--) out.push(r * w + line);
  return out;
}

/** The row a clue reads along, as cell indices. */
export function rowCells(board: Board, r: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < board.w; c++) out.push(r * board.w + c);
  return out;
}

export function colCells(board: Board, c: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < board.h; r++) out.push(r * board.w + c);
  return out;
}

/**
 * What a clue says about a filled sight line, or null while it cannot tell.
 *
 * Three answers, not two. True and false are the easy ones; null is "not yet",
 * and it is the one that matters — a clue about the second shape in cannot be
 * broken until two shapes have actually been placed, and a board that goes red
 * before then is a board whose red is noise.
 */
export function clueHolds(cells: readonly number[], depth: number, shape: number): boolean | null {
  let seen = 0;
  let unknownBefore = false;
  for (const v of cells) {
    if (v === -1) { unknownBefore = true; continue; }
    if (v === 0) continue;
    seen++;
    if (seen === depth) return unknownBefore ? null : v === shape;
  }
  return unknownBefore ? null : false;
}

/**
 * A line as it really stands, with the undecided cells read as blanks once
 * they cannot be anything else.
 *
 * A line holds exactly `shapes` shapes and no more. So the moment all of them
 * are down, every other cell in that line IS blank, whether or not the player
 * troubled to write it — and a clue that reads along it can be judged at once
 * rather than waiting for notation the answer does not need.
 *
 * Below that count nothing changes: an undecided cell is still "not yet", and
 * a clue over it still waits. This is the only place the two readings meet.
 */
export function asSettled(cells: readonly number[], shapes: number): number[] {
  let placed = 0;
  for (const v of cells) if (v > 0) placed++;
  return placed >= shapes ? cells.map((v) => (v === -1 ? 0 : v)) : cells.slice();
}

export type Fault =
  /** A row or column with a shape in it twice. */
  | 'twice'
  /** A clue that the board has definitely broken. */
  | 'clue';

export type Judgement = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  readonly progress: number;
  /** Clues the board has definitely broken, by their place in `clues`. */
  readonly badClues: readonly number[];
  /** Clues the board has definitely satisfied. */
  readonly goodClues: readonly number[];
  /** Rows and columns holding a shape twice. */
  readonly badRows: readonly number[];
  readonly badCols: readonly number[];
};

/**
 * Judge a board. `cells` uses 0 for a cell the player has marked empty and -1
 * for one they have not decided yet.
 *
 * A shape in a line twice is wrong the moment it happens — that one needs no
 * waiting, because nothing later can unmake it. A clue is only wrong once the
 * cells it reads are decided far enough in to tell.
 *
 * **The answer is the shapes.** A blank is the player's own notation — a note
 * saying "I have settled this and nothing goes here" — and notation is not
 * part of what is being asked for. People put blanks where the deduction
 * needed them and nowhere else, so a board that waits for a dot in every
 * remaining cell before it will say "solved" is a board that makes you tidy up
 * after winning. Every line that holds one of each shape is finished by the
 * rules whether or not its gaps are dotted, so that is what solved means here.
 */
export function judge(board: Board, cells: readonly number[]): Judgement {
  const faults = new Set<Fault>();
  const badClues: number[] = [];
  const goodClues: number[] = [];
  const badRows: number[] = [];
  const badCols: number[] = [];

  const lineFault = (idx: number[]): boolean => {
    const count = new Array(board.shapes + 1).fill(0);
    for (const i of idx) {
      const v = cells[i];
      if (v > 0) count[v]++;
    }
    return count.some((n) => n > 1);
  };
  for (let r = 0; r < board.h; r++) if (lineFault(rowCells(board, r))) { badRows.push(r); faults.add('twice'); }
  for (let c = 0; c < board.w; c++) if (lineFault(colCells(board, c))) { badCols.push(c); faults.add('twice'); }

  board.clues.forEach((clue, i) => {
    const seen = asSettled(sightLine(board, clue.side, clue.line).map((k) => cells[k]), board.shapes);
    const holds = clueHolds(seen, clue.depth, clue.shape);
    if (holds === true) goodClues.push(i);
    else if (holds === false) { badClues.push(i); faults.add('clue'); }
  });

  /*
   * Solved means every line holding exactly one of each shape and every clue
   * satisfied. The line check has to count exactly rather than "no
   * duplicates", because a row of nothing but blanks breaks no clue and would
   * otherwise pass.
   */
  const exact = (idx: number[]): boolean => {
    const count = new Array(board.shapes + 1).fill(0);
    for (const i of idx) if (cells[i] > 0) count[cells[i]]++;
    for (let s = 1; s <= board.shapes; s++) if (count[s] !== 1) return false;
    return true;
  };
  let linesOk = true;
  for (let r = 0; r < board.h && linesOk; r++) linesOk = exact(rowCells(board, r));
  for (let c = 0; c < board.w && linesOk; c++) linesOk = exact(colCells(board, c));

  /*
   * Progress counts the marks the answer is actually made of. Every row holds
   * one of each shape, so a finished board carries `shapes * h` of them and
   * nothing else — counting settled CELLS instead would have the meter creep
   * up as a player dots blanks they never have to draw, which is progress
   * through their notation rather than through the puzzle.
   */
  const need = board.shapes * board.h;
  let placed = 0;
  for (const v of cells) if (v > 0) placed++;

  return {
    solved: linesOk && badClues.length === 0 && faults.size === 0,
    faults: [...faults],
    progress: need === 0 ? 1 : Math.min(1, placed / need),
    badClues,
    goodClues,
    badRows,
    badCols,
  };
}

export const FAULT_TEXT: Record<Fault, string> = {
  twice: 'A row or column has the same shape twice',
  clue: 'A clue outside the grid does not hold',
};

export function firstFault(j: Judgement): string {
  for (const f of ['twice', 'clue'] as const) if (j.faults.includes(f)) return FAULT_TEXT[f];
  return '';
}

export function whatIsLeft(board: Board, j: Judgement): string {
  if (firstFault(j) !== '') return '';
  const need = board.shapes * board.h;
  const left = need - Math.round(j.progress * need);
  if (left === 0 && !j.solved) return 'Every row and column needs one of each shape';
  if (left === 0) return '';
  if (left === need) return 'One of each shape in every row and column';
  return left === 1 ? 'One shape to place' : `${left} shapes to place`;
}

/** The clue, in words, for a screen reader and for the hint. */
export function clueText(clue: Clue, names: readonly string[]): string {
  const which = clue.side === 'top' || clue.side === 'bottom'
    ? `column ${clue.line + 1}` : `row ${clue.line + 1}`;
  const from = { top: 'the top', bottom: 'the bottom', left: 'the left', right: 'the right' }[clue.side];
  const nth = ['', 'first', 'second', 'third', 'fourth', 'fifth'][clue.depth] ?? `${clue.depth}th`;
  return `Looking down ${which} from ${from}, the ${nth} shape is a ${names[clue.shape - 1] ?? clue.shape}`;
}
