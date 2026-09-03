/**
 * One to Nine: nine digits, six equations, one arrangement.
 *
 * Three by three cells with a fixed operator between each neighbouring pair.
 * Every digit from one to nine is used exactly once, and all three rows and
 * all three columns have to come out at the number written beside them. Six
 * equations over nine unknowns, and the unknowns are a permutation — which is
 * what makes it a puzzle rather than a sum: no line can be solved on its own,
 * because the digit you want may be needed somewhere else.
 *
 * Two things here are deliberately data rather than assumption. The side is a
 * number, so a four-by-four using one to sixteen is a different puzzle and not
 * a different engine. And the evaluation convention travels with the puzzle:
 * `a + b * c` is either 'precedence' or 'leftToRight' and there is no third
 * possibility and no guessing. The shipped ladder is all precedence, because
 * that is the convention nobody has to be told — but a family that wants
 * strict left-to-right can say so in its own data and the engine will judge it
 * that way.
 */

export type Op = '+' | '-' | '*' | '/';
export const OPS: readonly Op[] = ['+', '-', '*', '/'];

/** How `a + b * c` is read. Carried by the puzzle; never inferred. */
export type EvalMode = 'precedence' | 'leftToRight';

export type Nine = {
  /** Cells per side. Three, for the nine of the name. */
  readonly n: number;
  readonly mode: EvalMode;
  /** Row operators, row-major: `n` rows of `n - 1`. */
  readonly rowOps: readonly Op[];
  /** Column operators, column-major: `n` columns of `n - 1`. */
  readonly colOps: readonly Op[];
  readonly rowTargets: readonly number[];
  readonly colTargets: readonly number[];
  /** The arrangement the designer built it from. Used by the gate, never shown. */
  readonly answer: readonly number[];
};

/** How the operators shown between two cells are drawn. */
export const OP_GLYPH: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/**
 * Work out one line, exactly.
 *
 * Null means the line has no integer value — a division that does not divide.
 * That is not a fault a player can commit; it is the engine refusing to invent
 * a fraction, and it is why a generator can never produce a target that the
 * arithmetic does not actually reach.
 */
export function evaluate(vals: readonly number[], ops: readonly Op[], mode: EvalMode): number | null {
  if (vals.length === 0) return null;
  if (ops.length !== vals.length - 1) return null;

  if (mode === 'leftToRight') {
    let acc = vals[0];
    for (let i = 0; i < ops.length; i++) {
      const v = vals[i + 1];
      if (ops[i] === '+') acc += v;
      else if (ops[i] === '-') acc -= v;
      else if (ops[i] === '*') acc *= v;
      else {
        if (v === 0 || acc % v !== 0) return null;
        acc /= v;
      }
    }
    return acc;
  }

  // Precedence: collapse the multiplications and divisions, then add up.
  const terms: number[] = [vals[0]];
  const adds: Op[] = [];
  for (let i = 0; i < ops.length; i++) {
    const v = vals[i + 1];
    if (ops[i] === '*') terms[terms.length - 1] *= v;
    else if (ops[i] === '/') {
      const t = terms[terms.length - 1];
      if (v === 0 || t % v !== 0) return null;
      terms[terms.length - 1] = t / v;
    } else {
      adds.push(ops[i]);
      terms.push(v);
    }
  }
  let acc = terms[0];
  for (let i = 0; i < adds.length; i++) acc = adds[i] === '+' ? acc + terms[i + 1] : acc - terms[i + 1];
  return acc;
}

/** The digits of row `r`, from a board. Zero means empty. */
export function rowOf(nine: Nine, cells: readonly number[], r: number): number[] {
  const out: number[] = [];
  for (let c = 0; c < nine.n; c++) out.push(cells[r * nine.n + c]);
  return out;
}

export function colOf(nine: Nine, cells: readonly number[], c: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < nine.n; r++) out.push(cells[r * nine.n + c]);
  return out;
}

export function rowOpsOf(nine: Nine, r: number): Op[] {
  return nine.rowOps.slice(r * (nine.n - 1), (r + 1) * (nine.n - 1)) as Op[];
}

export function colOpsOf(nine: Nine, c: number): Op[] {
  return nine.colOps.slice(c * (nine.n - 1), (c + 1) * (nine.n - 1)) as Op[];
}

/** One line, as it reads on the board. Used by the view and by the rules sheet. */
export function lineText(vals: readonly number[], ops: readonly Op[], target: number): string {
  let out = String(vals[0] || '?');
  for (let i = 0; i < ops.length; i++) out += ` ${OP_GLYPH[ops[i]]} ${vals[i + 1] || '?'}`;
  return `${out} = ${target}`;
}

export type Fault =
  /** A line that is full and does not come out at its number. */
  | 'sum'
  /** A digit placed twice. Only reachable through a corrupt save. */
  | 'repeat';

export type Judgement = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  /** 0..1, by cells filled. */
  readonly progress: number;
  /** Which rows are full and wrong, and which columns. */
  readonly badRows: readonly number[];
  readonly badCols: readonly number[];
  /** Which are full and right — the quiet half of the same fact. */
  readonly goodRows: readonly number[];
  readonly goodCols: readonly number[];
};

/**
 * Judge a board.
 *
 * A line is only ever judged once it is FULL. A half-filled row is not wrong,
 * it is unfinished, and a board that goes red the moment you put a digit down
 * is a board whose red means nothing. This is the same rule Thread learned the
 * hard way: a warning that is on from the first move to the last is one nobody
 * can read.
 */
export function judge(nine: Nine, cells: readonly number[]): Judgement {
  const { n } = nine;
  const faults = new Set<Fault>();
  const seen = new Map<number, number>();
  let filled = 0;

  for (const d of cells) {
    if (d === 0) continue;
    filled++;
    seen.set(d, (seen.get(d) ?? 0) + 1);
  }
  for (const count of seen.values()) if (count > 1) faults.add('repeat');

  const badRows: number[] = [];
  const badCols: number[] = [];
  const goodRows: number[] = [];
  const goodCols: number[] = [];

  for (let r = 0; r < n; r++) {
    const vals = rowOf(nine, cells, r);
    if (vals.some((v) => v === 0)) continue;
    const got = evaluate(vals, rowOpsOf(nine, r), nine.mode);
    if (got === nine.rowTargets[r]) goodRows.push(r);
    else { badRows.push(r); faults.add('sum'); }
  }
  for (let c = 0; c < n; c++) {
    const vals = colOf(nine, cells, c);
    if (vals.some((v) => v === 0)) continue;
    const got = evaluate(vals, colOpsOf(nine, c), nine.mode);
    if (got === nine.colTargets[c]) goodCols.push(c);
    else { badCols.push(c); faults.add('sum'); }
  }

  const total = n * n;
  return {
    solved: filled === total && faults.size === 0,
    faults: [...faults],
    progress: total === 0 ? 1 : filled / total,
    badRows,
    badCols,
    goodRows,
    goodCols,
  };
}

export const FAULT_TEXT: Record<Fault, string> = {
  sum: 'That line does not come out at its number',
  repeat: 'Each digit is used once',
};

/** The one thing to say about a wrong board, or nothing. */
export function firstFault(j: Judgement): string {
  for (const f of ['repeat', 'sum'] as const) if (j.faults.includes(f)) return FAULT_TEXT[f];
  return '';
}

const WORDS: Record<number, string> = {
  4: 'Four', 9: 'Nine', 16: 'Sixteen', 25: 'Twenty-five',
};

/** What is left to do, said quietly. Only when nothing is wrong. */
export function whatIsLeft(nine: Nine, j: Judgement): string {
  if (firstFault(j) !== '') return '';
  const total = nine.n * nine.n;
  const left = total - Math.round(j.progress * total);
  if (left === 0) return '';
  if (left === total) return `${WORDS[total] ?? total} digits to place`;
  const done = j.goodRows.length + j.goodCols.length;
  if (done > 0) return `${done} of ${nine.n * 2} lines out, ${left} to place`;
  return left === 1 ? 'One digit to place' : `${left} digits to place`;
}

/** Does a hint's claim hold in the answer? "cell:4=7", or "cell:4!=7". */
export function claimHolds(nine: Nine, claim: string): boolean {
  const m = /^cell:(\d+)(!?=)(\d+)$/.exec(claim);
  if (!m) return false;
  const cell = Number(m[1]);
  const digit = Number(m[3]);
  if (cell < 0 || cell >= nine.answer.length) return false;
  return m[2] === '=' ? nine.answer[cell] === digit : nine.answer[cell] !== digit;
}
