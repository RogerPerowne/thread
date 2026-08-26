/**
 * Shape Up: every row and every column holds one of each shape, and the clues
 * round the edge say what you would see looking in.
 *
 * The board is a rectangle of cells. Each row holds exactly one of every shape
 * and the rest of it is empty; each column does the same. Around the outside
 * are clues, and a clue is three things — a shape, a direction, and how many
 * shapes deep it sits: "looking along this row from the left, the FIRST shape
 * you meet is a square", or "the SECOND one is a triangle".
 *
 * The depth is a number and not a colour. The puzzles this is drawn from use a
 * black arrow for the first shape and a white one for the second, which is a
 * two-value encoding of a thing that has no reason to stop at two. Here it is
 * an ordinal, so a clue about the third shape in is the same clue type and not
 * a new feature.
 *
 * Nothing assumes a square board or four shapes. A five by five with three
 * shapes and a seven by seven with five are the same engine.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right';

export type Clue = {
  readonly side: Side;
  /** Which column (top and bottom) or row (left and right). */
  readonly line: number;
  /** 1..shapes. */
  readonly shape: number;
  /** 1 = the first shape you meet looking in, 2 = the second, and so on. */
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
    const seen = sightLine(board, clue.side, clue.line).map((k) => cells[k]);
    const holds = clueHolds(seen, clue.depth, clue.shape);
    if (holds === true) goodClues.push(i);
    else if (holds === false) { badClues.push(i); faults.add('clue'); }
  });

  const total = board.w * board.h;
  let decided = 0;
  for (const v of cells) if (v !== -1) decided++;

  /*
   * Solved means every cell decided, every line holding one of each shape, and
   * every clue satisfied. The line check has to count exactly rather than "no
   * duplicates", because a row of nothing but blanks breaks no clue and would
   * otherwise pass.
   */
  let linesOk = decided === total;
  if (linesOk) {
    const exact = (idx: number[]): boolean => {
      const count = new Array(board.shapes + 1).fill(0);
      for (const i of idx) if (cells[i] > 0) count[cells[i]]++;
      for (let s = 1; s <= board.shapes; s++) if (count[s] !== 1) return false;
      return true;
    };
    for (let r = 0; r < board.h && linesOk; r++) linesOk = exact(rowCells(board, r));
    for (let c = 0; c < board.w && linesOk; c++) linesOk = exact(colCells(board, c));
  }

  return {
    solved: linesOk && badClues.length === 0 && faults.size === 0,
    faults: [...faults],
    progress: total === 0 ? 1 : decided / total,
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
  const total = board.w * board.h;
  const left = total - Math.round(j.progress * total);
  if (left === 0 && !j.solved) return 'Every row and column needs one of each shape';
  if (left === 0) return '';
  if (left === total) return 'One of each shape in every row and column';
  return left === 1 ? 'One cell to settle' : `${left} cells to settle`;
}

/** The clue, in words, for a screen reader and for the hint. */
export function clueText(clue: Clue, names: readonly string[]): string {
  const which = clue.side === 'top' || clue.side === 'bottom'
    ? `column ${clue.line + 1}` : `row ${clue.line + 1}`;
  const from = { top: 'the top', bottom: 'the bottom', left: 'the left', right: 'the right' }[clue.side];
  const nth = ['', 'first', 'second', 'third', 'fourth', 'fifth'][clue.depth] ?? `${clue.depth}th`;
  return `Looking down ${which} from ${from}, the ${nth} shape is a ${names[clue.shape - 1] ?? clue.shape}`;
}
