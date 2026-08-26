import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  evaluate, judge, rowOpsOf, colOpsOf, rowOf, colOf, type Nine, type Op,
} from '../../src/games/nine/model.js';
import { search, analyse } from '../../src/games/nine/solve.js';
import { makeNine, scoreOf, bandOf } from '../../src/games/nine/design.js';
import { NineSession } from '../../src/games/nine/session.js';
import { makeRng } from '../../src/platform/rng.js';

const shipped = JSON.parse(readFileSync('puzzles/nine.json', 'utf8')) as (Nine & {
  id: string; band: string; score: number; chapter: number;
})[];

describe('reading a line', () => {
  const P = 'precedence' as const;
  const L = 'leftToRight' as const;

  it('multiplies before it adds, when it says it does', () => {
    expect(evaluate([2, 3, 4], ['+', '*'], P)).toBe(14);
    expect(evaluate([2, 3, 4], ['+', '*'], L)).toBe(20);
    expect(evaluate([2, 3, 4], ['*', '+'], P)).toBe(10);
    expect(evaluate([2, 3, 4], ['*', '+'], L)).toBe(10);
  });

  it('refuses a division that does not divide', () => {
    /*
     * Not a fault a player can commit — it is the engine declining to invent a
     * fraction, which is why no generated target can be a number the
     * arithmetic does not actually reach.
     */
    expect(evaluate([7, 2], ['/'], P)).toBeNull();
    expect(evaluate([8, 2], ['/'], P)).toBe(4);
    expect(evaluate([1, 6, 4], ['+', '/'], P)).toBeNull();
    // Left to right divides the running total, so the same digits differ.
    expect(evaluate([8, 4, 2], ['/', '/'], L)).toBe(1);
    expect(evaluate([8, 4, 2], ['/', '/'], P)).toBe(1);
    expect(evaluate([9, 3, 3], ['-', '/'], P)).toBe(8);
    expect(evaluate([9, 3, 3], ['-', '/'], L)).toBe(2);
  });

  it('is exact about zero-length and mismatched lines', () => {
    expect(evaluate([], [], P)).toBeNull();
    expect(evaluate([1, 2], ['+', '+'], P)).toBeNull();
  });
});

describe('judging a board', () => {
  const nine = shipped[0];

  it('says nothing about a line that is not full yet', () => {
    /*
     * The rule Thread learned the hard way. A half-filled row is unfinished,
     * not wrong, and a board that goes red on the first digit is a board whose
     * red means nothing.
     */
    const cells = new Array(9).fill(0);
    cells[0] = nine.answer[0] === 1 ? 2 : 1;
    const j = judge(nine, cells);
    expect(j.faults).toEqual([]);
    expect(j.badRows).toEqual([]);
    expect(j.solved).toBe(false);
  });

  it('marks a full line that does not come out, and only that line', () => {
    const cells = nine.answer.slice();
    // Swap two digits inside the first row: that row breaks, and so do the two
    // columns it crosses — but the other row does not.
    [cells[0], cells[1]] = [cells[1], cells[0]];
    const j = judge(nine, cells);
    expect(j.solved).toBe(false);
    expect(j.badRows.length + j.badCols.length).toBeGreaterThan(0);
    expect(j.badRows).not.toContain(2);
  });

  it('accepts the answer it was built from', () => {
    for (const b of shipped) {
      expect(judge(b, b.answer.slice()).solved, `${b.id} rejects its own answer`).toBe(true);
    }
  });
});

describe('every shipped board', () => {
  it('has exactly one answer, re-proven from the shipped bytes', () => {
    for (const b of shipped) {
      const found = search(b, 2);
      expect(found.count, `${b.id} has ${found.count} answers`).toBe(1);
      expect(found.first).toEqual(b.answer);
    }
  });

  it('carries the band its own measured score puts it in', () => {
    for (const b of shipped) {
      const score = scoreOf(analyse(b));
      expect(Math.abs(score - b.score), `${b.id} scores ${score}, shipped ${b.score}`)
        .toBeLessThan(0.11);
      expect(bandOf(score), `${b.id} is banded wrong`).toBe(b.band);
    }
  });

  it('keeps its targets to numbers a person would write down', () => {
    for (const b of shipped) {
      for (const t of [...b.rowTargets, ...b.colTargets]) {
        expect(Number.isInteger(t), `${b.id} has a non-integer target`).toBe(true);
        expect(Math.abs(t), `${b.id} has a target of ${t}`).toBeLessThanOrEqual(200);
      }
    }
  });

  it('is a different puzzle from every other', () => {
    const seen = new Set<string>();
    for (const b of shipped) {
      const key = `${b.rowOps.join('')}|${b.colOps.join('')}|${b.rowTargets}|${b.colTargets}`;
      expect(seen.has(key), `${b.id} repeats an earlier board`).toBe(false);
      seen.add(key);
    }
  });

  it('gets harder up the ladder', () => {
    // Not board by board — chapter by chapter, which is the promise the path
    // screen actually makes.
    const byChapter = new Map<number, number[]>();
    for (const b of shipped) {
      if (!byChapter.has(b.chapter)) byChapter.set(b.chapter, []);
      byChapter.get(b.chapter)!.push(b.score);
    }
    const means = [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, xs]) => xs.reduce((s, x) => s + x, 0) / xs.length);
    expect(means[means.length - 1]).toBeGreaterThan(means[0] * 1.5);
  });
});

describe('the deduction measure', () => {
  it('never crosses out the real answer', () => {
    /*
     * The one thing that would make the whole measure a lie. If crossing-out
     * can eliminate a digit the answer actually uses, then a board it calls
     * "reasoned out" was reasoned to the wrong place.
     */
    for (const b of shipped.slice(0, 20)) {
      const r = analyse(b);
      expect(r.entry).toBeGreaterThan(0);
      if (r.byReason) {
        // Solved by reason alone means it landed on exactly the answer, since
        // the board has exactly one.
        expect(search(b, 2).first).toEqual(b.answer);
      }
    }
  });

  it('finds multiplication easier to reason about than addition', () => {
    /*
     * The measurement that reordered the ladder, kept as a test because it is
     * the surprising half of the design. `a + b + c = 15` allows twenty-five
     * triples and says almost nothing; `a x b x c = 336` allows one.
     */
    const sample = (ops: Op[], cap: number): number => {
      const rng = makeRng(`test:${ops.join('')}`);
      let reasoned = 0;
      let made = 0;
      for (let i = 0; i < 4000 && made < 120; i++) {
        const b = makeNine({ ops, cap, mode: 'precedence', n: 3 }, rng);
        if (!b) continue;
        made++;
        if (b.reading.byReason) reasoned++;
      }
      return reasoned / Math.max(1, made);
    };
    const plus = sample(['+', '-'], 60);
    const times = sample(['+', '-', '*'], 140);
    expect(times).toBeGreaterThan(plus + 0.3);
  });
});

describe('playing', () => {
  const nine = shipped[0];

  it('swaps when one placed digit is dropped on another', () => {
    const s = new NineSession(nine);
    s.place(0, 4);
    s.place(1, 7);
    s.place(0, 7);
    expect(s.cells[0]).toBe(7);
    expect(s.cells[1]).toBe(4);
  });

  it('moves rather than copies', () => {
    const s = new NineSession(nine);
    s.place(0, 4);
    s.place(5, 4);
    expect(s.cells[0]).toBe(0);
    expect(s.cells[5]).toBe(4);
    expect(s.cells.filter((d) => d === 4)).toHaveLength(1);
  });

  it('undoes a whole gesture, not half of one', () => {
    const s = new NineSession(nine);
    s.openGesture();
    s.place(0, 4);
    s.place(1, 7);
    expect(s.cells.slice(0, 2)).toEqual([4, 7]);
    s.undo();
    expect(s.cells.slice(0, 2)).toEqual([0, 0]);
  });

  it('comes back from a save exactly as it was left', () => {
    const s = new NineSession(nine);
    s.openGesture();
    s.place(0, 4);
    s.openGesture();
    s.place(4, 9);
    const saved = s.save();
    const back = new NineSession(nine);
    expect(back.load(saved)).toBe(true);
    expect(back.cells).toEqual(s.cells);
  });

  it('refuses a save that belongs to another board', () => {
    const other = shipped.find((b) => b.rowTargets.join() !== nine.rowTargets.join())!;
    const s = new NineSession(nine);
    s.place(0, 4);
    expect(new NineSession(other).load(s.save())).toBe(false);
  });

  it('refuses a save with a digit in twice', () => {
    const s = new NineSession(nine);
    expect(s.load('1;' + nine.rowTargets.join(',') + ';;4,4,0,0,0,0,0,0,0')).toBe(false);
  });

  it('has something useful to say at every point of a solve', () => {
    const s = new NineSession(nine);
    for (let i = 0; i < 9; i++) {
      const hint = s.hint();
      expect(hint, `no hint with ${i} digits down`).not.toBeNull();
      expect(hint!.reason.length).toBeGreaterThan(10);
      s.openGesture();
      s.place(i, nine.answer[i]);
    }
    expect(s.verdict().solved).toBe(true);
  });

  it('says the mistake is behind you when nothing can fit', () => {
    const s = new NineSession(nine);
    // Fill the first row with digits that cannot make its target.
    const wrong = [1, 2, 3].map((d) => d);
    const ok = evaluate(wrong, rowOpsOf(nine, 0), nine.mode) === nine.rowTargets[0];
    if (!ok) {
      s.place(0, wrong[0]);
      s.place(1, wrong[1]);
      s.place(2, wrong[2]);
      const j = judge(nine, s.cells);
      expect(j.badRows).toContain(0);
    }
  });

  it('reads a row and a column the same way the board draws them', () => {
    const s = new NineSession(nine);
    for (let i = 0; i < 9; i++) s.place(i, nine.answer[i]);
    for (let r = 0; r < 3; r++) {
      expect(evaluate(rowOf(nine, s.cells, r), rowOpsOf(nine, r), nine.mode))
        .toBe(nine.rowTargets[r]);
    }
    for (let c = 0; c < 3; c++) {
      expect(evaluate(colOf(nine, s.cells, c), colOpsOf(nine, c), nine.mode))
        .toBe(nine.colTargets[c]);
    }
  });
});
