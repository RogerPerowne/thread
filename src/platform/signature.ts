/**
 * The share line.
 *
 * A shared result has one hard requirement — it must give nothing away — and
 * one soft one: it should be worth looking at. The obvious things are all
 * spoilers. A picture of the finished board is the answer. The route, the
 * placements, the digits: all the answer.
 *
 * What is safe is the shape of the EFFORT. Divide the solve into four
 * quarters by progress and record, for each one, how much undoing happened in
 * it. That produces a four-mark sparkline of how the solve went — a flat line
 * for someone who saw it immediately, a spike where they got stuck and dug
 * themselves out — and it says nothing whatsoever about the puzzle. Two people
 * with the same board get different lines; the same line comes from completely
 * different boards.
 *
 * Every game uses this, so a result posted from one is recognisably from the
 * same family as a result posted from another, and none of them is Wordle's
 * grid of squares.
 */

const MARKS = ['▁', '▃', '▅', '▇'] as const;

/** Tracks how much undoing happened, and where. */
export class Effort {
  private readonly undos = [0, 0, 0, 0];
  private quarter = 0;

  /** Called whenever progress changes, 0..1. */
  note(progress: number): void {
    const q = Math.max(0, Math.min(3, Math.floor(progress * 4)));
    // Only ever moves forward: winding a board right back should not rewrite
    // the record of how the earlier part went.
    if (q > this.quarter) this.quarter = q;
  }

  /** Called on every step backwards the player takes. */
  undid(): void {
    this.undos[this.quarter]++;
  }

  /** Four marks, low to high. */
  toString(): string {
    return this.undos.map((n) => MARKS[n === 0 ? 0 : n <= 2 ? 1 : n <= 6 ? 2 : 3]).join('');
  }

  /** For storing alongside a saved board, so a resume keeps its history. */
  freeze(): number[] {
    return [...this.undos, this.quarter];
  }

  thaw(from: readonly number[]): void {
    if (from.length !== 5) return;
    for (let i = 0; i < 4; i++) this.undos[i] = from[i] | 0;
    this.quarter = Math.max(0, Math.min(3, from[4] | 0));
  }
}
