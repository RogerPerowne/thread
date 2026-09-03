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
  if (score < 65) return 'gentle';
  if (score < 112) return 'steady';
  if (score < 130) return 'tricky';
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
/** How long one chapter may spend looking, before it ships what it has. */
const CHAPTER_MS = Number(process.env.CHAPTER_MS ?? 300_000);

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
/* The narrower sets, which is where the ladder's hard end comes from: taking
   an operator AWAY is what makes a line say less. */
const MT: readonly Op[] = ['-', '*'];
const PT: readonly Op[] = ['+', '*'];
const PMD: readonly Op[] = ['+', '-', '/'];
const PL: readonly Op[] = ['+'];

export const LADDER: readonly Chapter[] = [
  { name: 'Everything Allowed', count: 30, recipe: { ops: PT, cap: 140, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Bigger Products', count: 30, recipe: { ops: MT, cap: 140, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Times and Add', count: 30, recipe: { ops: PT, cap: 200, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Times and Take', count: 30, recipe: { ops: MT, cap: 200, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'A Way In', count: 30, recipe: { ops: PMT, cap: 90, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'In Order', count: 30, recipe: { ops: ALL, cap: 200, mode: 'leftToRight', n: 3 }, from: 0, to: 999 },
  { name: 'All Four', count: 30, recipe: { ops: ALL, cap: 200, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Sharing Out', count: 30, recipe: { ops: ALL, cap: 120, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Longer Reach', count: 30, recipe: { ops: PMT, cap: 200, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Products', count: 30, recipe: { ops: PMT, cap: 140, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Left to Right', count: 30, recipe: { ops: PMT, cap: 200, mode: 'leftToRight', n: 3 }, from: 0, to: 999 },
  { name: 'Plus and Minus', count: 30, recipe: { ops: PM, cap: 45, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Nothing Given', count: 30, recipe: { ops: PM, cap: 90, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Both Ways', count: 30, recipe: { ops: PM, cap: 60, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'No Multiplying', count: 30, recipe: { ops: PMD, cap: 90, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Sharing Only', count: 30, recipe: { ops: PMD, cap: 200, mode: 'precedence', n: 3 }, from: 0, to: 999 },
  { name: 'Adding Alone', count: 20, recipe: { ops: PL, cap: 45, mode: 'precedence', n: 3 }, from: 0, to: 999 },
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

  /*
   * Seeded by the RECIPE, not by where the chapter sits.
   *
   * The ladder's order is decided by measuring the boards, which means the
   * chapters get moved after they are built. Seeded by position, moving one
   * changes which boards it makes, which changes its median, which changes
   * where it should sit — a ladder that will not sit still. Seeded by what it
   * is, a chapter makes the same thirty boards wherever it ends up, so putting
   * them in order is a permutation and one pass settles it.
   */
  const seenRecipe = new Map<string, number>();
  LADDER.forEach((chapter, ci) => {
    const r = chapter.recipe;
    const key = `${r.ops.join('')}|${r.cap}|${r.mode}|${r.n}`;
    const nth = seenRecipe.get(key) ?? 0;
    seenRecipe.set(key, nth + 1);
    const rng = makeRng(`${seed}:${key}:${nth}`);
    const seen = new Set<string>();
    const batch: Omit<Built, 'id'>[] = [];
    let tries = 0;
    const until = Date.now() + CHAPTER_MS;
    while (batch.length < chapter.count && tries < 400_000 && Date.now() < until) {
      tries++;
      const board = makeNine(chapter.recipe, rng);
      if (!board) continue;
      const score = scoreOf(board.reading);

      /* Two boards with the same six targets and the same operators are the
         same puzzle wearing a different number. */
      const key = `${board.rowOps.join('')}|${board.colOps.join('')}|${board.rowTargets.join(',')}|${board.colTargets.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      batch.push({
        n: board.n,
        mode: board.mode,
        rowOps: board.rowOps,
        colOps: board.colOps,
        rowTargets: board.rowTargets,
        colTargets: board.colTargets,
        answer: board.answer,
        band: bandOf(score),
        score: Math.round(score * 10) / 10,
        chapter: ci + 1,
      });
    }
    /* Sorted inside the chapter, so its levels climb rather than arriving in
       whatever order the generator happened to find them. */
    batch.sort((a, b) => a.score - b.score);
    for (const b of batch) out.push({ ...b, id: `nine-${++no}` });
    onProgress?.(`${chapter.name}: ${batch.length}/${chapter.count} in ${tries} draws`);
  });

  return out;
}
