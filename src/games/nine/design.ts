/**
 * Where One to Nine's boards come from.
 *
 * Answer first, always. A permutation of the digits is drawn, operators are
 * chosen, and the six targets are then READ OFF the arrangement rather than
 * invented. A board built this way cannot be impossible, because the answer
 * existed before the board did — and the only question left is whether it is
 * the ONLY answer, which the solver settles.
 *
 * What is thrown away is as important as what is kept. A set of operators that
 * makes a division not divide has no integer target and is dropped; a target
 * past the chapter's ceiling is dropped, because "one to nine" should not turn
 * into three-digit multiplication; and anything with a second answer is
 * dropped, because a puzzle with two answers cannot be reasoned out at all.
 */

import { analyse, search, type Reading } from './solve.js';
import { evaluate, type EvalMode, type Nine, type Op } from './model.js';
import { makeRng, type Rng } from '../../platform/rng.js';
import type { Band } from '../../platform/types.js';

export type Recipe = {
  /** Which operators may appear. */
  readonly ops: readonly Op[];
  /** The largest a target may be, either way. */
  readonly cap: number;
  readonly mode: EvalMode;
  readonly n: number;
};

/**
 * How hard a board is to think about, as one number.
 *
 * Built from the deduction, not from the search. `opening` is how much the six
 * lines allow between them before you have crossed anything out — the size of
 * the room you start in. `entry` is the most constrained single line, which is
 * the door you come in through: a line with three possibilities is a gift and
 * a line with forty is not. `rounds` is how far the crossing-out has to be
 * carried before it stops. And a board that crossing-out never finishes is in
 * a different class from all of them, because at that point the only way on is
 * to try something.
 */
export function scoreOf(r: Reading): number {
  return Math.log2(Math.max(1, r.opening)) * 7
    + Math.min(r.entry, 60) * 0.9
    + r.rounds * 3
    + (r.byReason ? 0 : 45);
}

/*
 * The bands, from the measured spread of that score over three and a half
 * thousand boards rather than from taste, and the spread turned out to be in
 * two humps: a board that crossing-out finishes scores between forty and
 * eighty, and one that needs you to try something starts at about a hundred
 * and ten. The thresholds sit in the gap and inside each hump, so the band
 * says which KIND of board it is as well as how hard.
 *
 * scripts/build-nine.ts prints the spread on every run. If the score ever
 * changes, these are re-measured rather than nudged.
 */
export function bandOf(score: number): Band {
  if (score < 62) return 'gentle';
  if (score < 100) return 'steady';
  if (score < 128) return 'tricky';
  return 'severe';
}

/** One board, or null if this draw did not produce a sound one. */
export function makeNine(recipe: Recipe, rng: Rng): (Nine & { reading: Reading }) | null {
  const { n, cap, mode } = recipe;
  const total = n * n;

  const answer: number[] = [];
  for (let d = 1; d <= total; d++) answer.push(d);
  for (let i = total - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [answer[i], answer[j]] = [answer[j], answer[i]];
  }

  const pickOps = (): Op[] => {
    const out: Op[] = [];
    for (let i = 0; i < n * (n - 1); i++) out.push(recipe.ops[rng.int(recipe.ops.length)]);
    return out;
  };
  const rowOps = pickOps();
  const colOps = pickOps();

  const rowTargets: number[] = [];
  const colTargets: number[] = [];
  for (let r = 0; r < n; r++) {
    const vals = answer.slice(r * n, (r + 1) * n);
    const got = evaluate(vals, rowOps.slice(r * (n - 1), (r + 1) * (n - 1)), mode);
    if (got === null || Math.abs(got) > cap) return null;
    rowTargets.push(got);
  }
  for (let c = 0; c < n; c++) {
    const vals: number[] = [];
    for (let r = 0; r < n; r++) vals.push(answer[r * n + c]);
    const got = evaluate(vals, colOps.slice(c * (n - 1), (c + 1) * (n - 1)), mode);
    if (got === null || Math.abs(got) > cap) return null;
    colTargets.push(got);
  }

  const nine: Nine = { n, mode, rowOps, colOps, rowTargets, colTargets, answer };

  const found = search(nine, 2);
  if (found.count !== 1) return null;

  return { ...nine, reading: analyse(nine) };
}

/**
 * The ladder, in the order the MEASURE puts it, which is not the order anyone
 * would guess.
 *
 * Plus and minus look like the easy end and are the hard end. `a + b + c = 15`
 * allows twenty-five triples and tells you almost nothing, so a board of them
 * has to be tried rather than reasoned: only one in a hundred falls to
 * crossing-out alone. `a x b x c = 336` allows one, and a board with a couple
 * of those collapses in a few passes — two in three of them come out by pure
 * deduction.
 *
 * So the ladder opens on multiplication and ends on addition. That is the
 * measurement rather than a preference, and it is also the honest answer to
 * what the brief asked for: difficulty from deduction complexity, not from
 * harder arithmetic. Nothing here gets harder by making the sums bigger.
 */
export type Chapter = {
  readonly name: string;
  readonly count: number;
  readonly recipe: Recipe;
  /** The score window this chapter takes from. */
  readonly from: number;
  readonly to: number;
};

const PM: readonly Op[] = ['+', '-'];
const PMT: readonly Op[] = ['+', '-', '*'];
const ALL: readonly Op[] = ['+', '-', '*', '/'];

export const LADDER: readonly Chapter[] = [
  { name: 'A Way In', count: 8, recipe: { ops: PMT, cap: 90, mode: 'precedence', n: 3 }, from: 0, to: 60 },
  { name: 'Sharing Out', count: 8, recipe: { ops: ALL, cap: 120, mode: 'precedence', n: 3 }, from: 0, to: 62 },
  { name: 'Products', count: 8, recipe: { ops: PMT, cap: 140, mode: 'precedence', n: 3 }, from: 62, to: 78 },
  { name: 'All Four', count: 8, recipe: { ops: ALL, cap: 200, mode: 'precedence', n: 3 }, from: 62, to: 90 },
  { name: 'Longer Reach', count: 8, recipe: { ops: PMT, cap: 200, mode: 'precedence', n: 3 }, from: 78, to: 999 },
  { name: 'Plus and Minus', count: 8, recipe: { ops: PM, cap: 45, mode: 'precedence', n: 3 }, from: 0, to: 118 },
  { name: 'Both Ways', count: 8, recipe: { ops: PM, cap: 60, mode: 'precedence', n: 3 }, from: 118, to: 128 },
  { name: 'Nothing Given', count: 8, recipe: { ops: PM, cap: 60, mode: 'precedence', n: 3 }, from: 128, to: 999 },
];

export type Built = Nine & {
  readonly id: string;
  readonly band: Band;
  readonly score: number;
  readonly chapter: number;
};

/**
 * Build the whole ladder, deterministically.
 *
 * Same seed, same boards, every time — which is what lets the gate re-prove
 * the shipped bytes rather than trusting the run that made them.
 */
export function buildNine(seed = 'nine-1', onProgress?: (msg: string) => void): Built[] {
  const out: Built[] = [];
  let no = 0;

  LADDER.forEach((chapter, ci) => {
    const rng = makeRng(`${seed}:${ci}`);
    const seen = new Set<string>();
    let made = 0;
    let tries = 0;
    while (made < chapter.count && tries < 400_000) {
      tries++;
      const board = makeNine(chapter.recipe, rng);
      if (!board) continue;
      const score = scoreOf(board.reading);
      if (score < chapter.from || score >= chapter.to) continue;

      /* Two boards with the same six targets and the same operators are the
         same puzzle wearing a different number. */
      const key = `${board.rowOps.join('')}|${board.colOps.join('')}|${board.rowTargets.join(',')}|${board.colTargets.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      no++;
      made++;
      out.push({
        n: board.n,
        mode: board.mode,
        rowOps: board.rowOps,
        colOps: board.colOps,
        rowTargets: board.rowTargets,
        colTargets: board.colTargets,
        answer: board.answer,
        id: `nine-${no}`,
        band: bandOf(score),
        score: Math.round(score * 10) / 10,
        chapter: ci + 1,
      });
    }
    onProgress?.(`${chapter.name}: ${made}/${chapter.count} in ${tries} draws`);
  });

  return out;
}
