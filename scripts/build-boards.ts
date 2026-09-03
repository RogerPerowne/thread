/**
 * Build Thread's boards.
 *
 *   npx tsx scripts/build-boards.ts
 *
 * One ladder, six chapters, deterministic from one seed. Every board is
 * re-proved from what is about to be written rather than from what the
 * designer remembers: its own answer has to satisfy it, no second answer may
 * exist, and it has to be reasonable — finishable by crossing-out rather than
 * by trying routes and seeing. The spread the bands are cut from is printed,
 * because a threshold nobody can re-measure is a threshold nobody can check.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { makeRng } from '../src/platform/rng.js';
import { makeBoard, INKS, type Recipe } from '../src/games/thread/make.js';
import { compile, type Board } from '../src/games/thread/board.js';
import { judge } from '../src/games/thread/check.js';
import { search } from '../src/games/thread/search.js';
import { analyse, scoreOf } from '../src/games/thread/reason.js';
import type { Band } from '../src/platform/types.js';

const SEED = process.env.SEED ?? 'thread-3';
/** How long any one chapter may spend looking. */
const CHAPTER_SECONDS = Number(process.env.CHAPTER_SECONDS ?? 240);

type Chapter = { readonly name: string; readonly count: number } & Recipe;

/**
 * The ladder.
 *
 * Sixteen posts to forty-two, and fewer boards than there used to be by a
 * factor of four. Every board on it can be reasoned out from what is drawn —
 * which the boards that came before could not: measured, the free-form ones
 * fell to crossing-out alone in one case in twenty, and the lattice ones in
 * nineteen out of twenty. That is the whole argument for the lattice, and it
 * is why there is only one ladder now instead of three.
 */
const LADDER: Chapter[] = [
  { name: 'Sixteen', count: 30, cols: 4, rows: 4, strands: 2 },
  { name: 'Twenty', count: 30, cols: 5, rows: 4, strands: 2 },
  { name: 'Three Strings', count: 30, cols: 5, rows: 4, strands: 3 },
  { name: 'Five Square', count: 30, cols: 5, rows: 5, strands: 2 },
  { name: 'A Third Colour', count: 30, cols: 5, rows: 5, strands: 3 },
  { name: 'Thirty', count: 30, cols: 6, rows: 5, strands: 3 },
  { name: 'Four Strings', count: 30, cols: 6, rows: 5, strands: 4 },
  { name: 'Thirty-Six', count: 30, cols: 6, rows: 6, strands: 3 },
  { name: 'Six Square', count: 30, cols: 6, rows: 6, strands: 4 },
  { name: 'Forty-Two', count: 30, cols: 7, rows: 6, strands: 3 },
  { name: 'Seven Across', count: 30, cols: 7, rows: 6, strands: 4 },
  { name: 'Five Strings', count: 30, cols: 7, rows: 6, strands: 5 },
  { name: 'Forty-Nine', count: 30, cols: 7, rows: 7, strands: 4 },
  { name: 'Seven Square', count: 30, cols: 7, rows: 7, strands: 5 },
  { name: 'Fifty-Six', count: 30, cols: 8, rows: 7, strands: 4 },
  { name: 'The Long Board', count: 30, cols: 8, rows: 7, strands: 5 },
  { name: 'Every Colour', count: 20, cols: 8, rows: 7, strands: 6 },
];

/**
 * Two boards with the same answer shape are the same puzzle wearing different
 * paint, so the answer itself is the fingerprint.
 */
function fingerprint(b: Board): string {
  const norm = b.solution.map((p) => {
    const fwd = p.join(',');
    const rev = [...p].reverse().join(',');
    return fwd < rev ? fwd : rev;
  });
  return `${b.posts.length}|${norm.sort().join('/')}`;
}

/*
 * The bands, from the measured spread rather than from the size of the board.
 * scripts/build-boards.ts prints the spread on every run; if the score ever
 * changes these are re-measured rather than nudged.
 */
export function bandOf(score: number): Band {
  if (score < 48.5) return 'gentle';
  if (score < 53) return 'steady';
  if (score < 58) return 'tricky';
  return 'severe';
}

type Shipped = Board & { readonly score: number; readonly band: Band };

console.log(`Building Thread with seed "${SEED}"\n`);
const t0 = Date.now();
const out: Shipped[] = [];
const seen = new Set<string>();
let no = 0;

LADDER.forEach((chapter, ci) => {
  const made: { board: Board; score: number; walls: number; inks: number }[] = [];
  let seed = 0;
  const cap = chapter.count * 200;
  const until = Date.now() + CHAPTER_SECONDS * 1000;

  while (made.length < chapter.count && seed < cap && Date.now() < until) {
    const rng = makeRng(`${SEED}/${ci + 1}/${seed++}`);
    const m = makeBoard('pending', chapter, rng);
    if (!m) continue;
    const fp = fingerprint(m.board);
    if (seen.has(fp)) continue;
    seen.add(fp);
    made.push({
      board: m.board,
      score: scoreOf(m.reading),
      walls: m.board.blocks.length,
      inks: m.board.strands.length,
    });
  }

  /* Inside a chapter the boards climb by the measured score, so the ramp is
     the measurement rather than the order they happened to be found in. */
  made.sort((a, b) => a.score - b.score);
  for (const m of made) {
    no++;
    out.push({
      ...m.board,
      id: `thread-${no}`,
      chapter: ci + 1,
      score: Math.round(m.score * 10) / 10,
      band: bandOf(m.score),
    });
  }
  const walls = made.map((m) => m.walls);
  const inks = made.map((m) => m.inks);
  const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}..${Math.max(...xs)}` : '-');
  console.log(
    `  ${chapter.name.padEnd(12)} ${chapter.cols}x${chapter.rows}`
    + `  ${String(made.length).padStart(2)}/${chapter.count}`
    + `  score ${made.length ? `${made[0].score.toFixed(0)}..${made[made.length - 1].score.toFixed(0)}` : '-'}`
    + `  walls ${range(walls)}  strings ${range(inks)}`,
  );
});

let bad = 0;
for (const b of out) {
  const c = compile(b);
  if (!judge(c, b.solution).solved) {
    console.error(`  ${b.id} rejects its own answer`);
    bad++;
  }
  const found = search(c, 2, 600_000);
  if (found.exhausted || found.solutions.length !== 1) {
    console.error(`  ${b.id} has ${found.solutions.length} answers${found.exhausted ? ' (search cut off)' : ''}`);
    bad++;
  }
  const reading = analyse(c);
  if (!reading.byReason) {
    console.error(`  ${b.id} cannot be reasoned out`);
    bad++;
  }
  if (Math.abs(scoreOf(reading) - b.score) > 0.11) {
    console.error(`  ${b.id} scores ${scoreOf(reading).toFixed(1)}, shipped as ${b.score}`);
    bad++;
  }
  if (b.strands.length > INKS.length) {
    console.error(`  ${b.id} wants ${b.strands.length} colours and there are ${INKS.length}`);
    bad++;
  }
  if (new Set(b.strands.map((s) => s.color)).size !== b.strands.length) {
    console.error(`  ${b.id} uses one colour twice`);
    bad++;
  }
}

mkdirSync('boards', { recursive: true });
const json = JSON.stringify(out);
writeFileSync('boards/thread.json', json);

const counts = new Map<string, number>();
for (const b of out) counts.set(b.band, (counts.get(b.band) ?? 0) + 1);
console.log('');
for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);

const scores = out.map((b) => b.score).sort((a, b) => a - b);
const q = (p: number) => (scores[Math.floor(scores.length * p)] ?? 0).toFixed(1);
console.log(`\n  the spread the bands are cut from: q1 ${q(0.25)}  med ${q(0.5)}  q3 ${q(0.75)}`);

console.log(`\n${out.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (bad > 0) {
  console.error(`\n${bad} board${bad === 1 ? '' : 's'} did not check out.`);
  process.exit(1);
}
console.log('Every board has one answer, and every one can be reasoned out.');
