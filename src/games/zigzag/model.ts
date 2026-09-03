/**
 * Zigzag: one line through every cell, in order.
 *
 * The board is a rectangle of numbered cells. You draw a single continuous
 * line from the start cell to the finish cell that visits every cell exactly
 * once, and the numbers you cross have to run in a repeating sequence — 1, 2,
 * 3, 4, 1, 2, 3, 4 and round again.
 *
 * So it is a Hamiltonian path with a colouring constraint, and the colouring
 * is what makes it tractable: from a cell at step i the only legal moves are
 * to neighbours carrying the next number in the sequence, which is a fraction
 * of the neighbours rather than all of them.
 *
 * HOW MANY NEIGHBOURS is the board's own business, and it is the game's
 * biggest difficulty lever. On a straight board the line steps to any of the
 * eight cells around it; on a straight-only board it steps to four. Four
 * neighbours of which about one carries the next number means most steps have
 * exactly one continuation and the line very nearly draws itself; eight
 * neighbours means two or three ways on at every cell and a real search. It is
 * the same rule either way, and the board says which it is.
 *
 * Nothing here assumes the sequence is 1..4 or that the board is square. The
 * sequence is data and the board is w by h, so a five-number variant or a
 * 9 x 6 board is a different puzzle rather than a different engine.
 */

export type Zig = {
  readonly w: number;
  readonly h: number;
  /** Cell values, row-major. Each is one of `sequence`. */
  readonly cells: readonly number[];
  /** The repeating run the path has to follow. */
  readonly sequence: readonly number[];
  readonly start: number;
  readonly finish: number;
  /**
   * May the line step corner to corner?
   *
   * Absent means yes, because that is what every board built before this
   * existed did, and a saved board without the field has to keep meaning what
   * it meant. Boards low on the ladder set it false: a line that can only go
   * up, down, left and right is a line a player can follow with a finger.
   */
  readonly diagonal?: boolean;
  /** The path the designer built it from. Never shown; used by the gate. */
  readonly answer: readonly number[];
};

/** The cells a line may step to from `at`. Eight of them, or four. */
export function neighbours(w: number, h: number, at: number, diagonal = true): number[] {
  const x = at % w;
  const y = (at / w) | 0;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!diagonal && dx !== 0 && dy !== 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      out.push(ny * w + nx);
    }
  }
  return out;
}

/**
 * The steps a board allows, read off the board itself.
 *
 * Everything that asks "can the line go there" goes through this rather than
 * through `neighbours` directly, so no caller can forget to pass the flag and
 * quietly let a diagonal onto a board that forbids them.
 */
export function stepsFrom(zig: Zig, at: number): number[] {
  return neighbours(zig.w, zig.h, at, zig.diagonal !== false);
}

/** Neighbour lists for every cell, worked out once. */
export function adjacency(w: number, h: number, diagonal = true): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < w * h; i++) out.push(neighbours(w, h, i, diagonal));
  return out;
}

/** What value a cell must carry to be the `step`th on the path. */
export function wants(zig: Zig, step: number): number {
  return zig.sequence[step % zig.sequence.length];
}

export type Fault =
  /** A cell used twice. */
  | 'repeat'
  /** Two cells in the path that are not neighbours. */
  | 'apart'
  /** A cell whose number is not the next one in the run. */
  | 'order'
  /** The line does not begin at the start, or end at the finish. */
  | 'ends'
  /** Cells left over. */
  | 'left';

export type Judgement = {
  readonly solved: boolean;
  readonly faults: readonly Fault[];
  /** How far along, 0..1, by cells visited. */
  readonly progress: number;
  /** The step at which the path first goes wrong, or -1. */
  readonly wrongAt: number;
};

/**
 * Judge a path.
 *
 * `partial` is the live case: a line still being drawn is not yet expected to
 * reach the finish or to have covered the board. Everything else is checked
 * the whole time, because a line that has already broken the sequence will
 * still have broken it when you let go, and the end is the worst moment to
 * find that out.
 */
export function judge(zig: Zig, path: readonly number[], partial = false): Judgement {
  const faults = new Set<Fault>();
  const n = zig.w * zig.h;
  const seen = new Uint8Array(n);
  let wrongAt = -1;

  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    if (cell < 0 || cell >= n) { faults.add('order'); continue; }
    if (seen[cell]) { faults.add('repeat'); if (wrongAt < 0) wrongAt = i; }
    seen[cell] = 1;

    if (zig.cells[cell] !== wants(zig, i)) {
      faults.add('order');
      if (wrongAt < 0) wrongAt = i;
    }
    if (i > 0 && !stepsFrom(zig, path[i - 1]).includes(cell)) {
      faults.add('apart');
      if (wrongAt < 0) wrongAt = i;
    }
  }

  if (path.length > 0 && path[0] !== zig.start) faults.add('ends');
  if (!partial) {
    if (path.length === 0 || path[path.length - 1] !== zig.finish) faults.add('ends');
    let visited = 0;
    for (let i = 0; i < n; i++) if (seen[i]) visited++;
    if (visited < n) faults.add('left');
  }

  let visited = 0;
  for (let i = 0; i < n; i++) if (seen[i]) visited++;

  return {
    solved: !partial && faults.size === 0,
    faults: [...faults],
    progress: n === 0 ? 1 : visited / n,
    wrongAt,
  };
}

/** What a fault means, in the fewest words that still teach the rule. */
export const FAULT_TEXT: Record<Fault, string> = {
  repeat: 'The line cannot cross itself',
  apart: 'The line has to step to a touching cell',
  order: 'The numbers have to run in order',
  ends: 'The line runs from the first cell to the last',
  left: 'Every cell has to be used',
};

/** The one thing to say about a line that is wrong, or nothing. */
export function firstFault(j: Judgement): string {
  for (const f of ['order', 'apart', 'repeat', 'ends'] as const) {
    if (j.faults.includes(f)) return FAULT_TEXT[f];
  }
  return '';
}

/** What is left to do, said quietly. Only when nothing is wrong. */
export function whatIsLeft(zig: Zig, j: Judgement, path: readonly number[]): string {
  if (firstFault(j) !== '') return '';
  const n = zig.w * zig.h;
  const left = n - Math.round(j.progress * n);
  if (left === 0 && path[path.length - 1] !== zig.finish) return 'Finish on the last cell';
  if (left === 0) return '';
  if (path.length === 0) return 'Start on the marked cell and draw';
  return left === 1 ? 'One cell to go' : `${left} cells to go`;
}
