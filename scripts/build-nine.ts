/**
 * Build One to Nine's boards.
 *
 *   npx tsx scripts/build-nine.ts
 *
 * Deterministic from one seed, so the same command always writes the same
 * file. It prints the spread of the difficulty score as well as the counts,
 * because the band thresholds are set from that spread — if the score ever
 * changes, the numbers to re-measure are on the screen rather than in someone's
 * memory.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildNine, LADDER, scoreOf, makeNine } from '../src/games/nine/design.js';
import { analyse, search } from '../src/games/nine/solve.js';
import { makeRng } from '../src/platform/rng.js';

const SEED = process.env.SEED ?? 'nine-1';

console.log(`Building One to Nine with seed "${SEED}"\n`);
const t0 = Date.now();
const made = buildNine(SEED, (msg) => console.log(`  ${msg}`));

// Every shipped board re-proved from what is about to be written, not from
// what the designer remembers about it.
let bad = 0;
for (const b of made) {
  const found = search(b, 2);
  if (found.count !== 1) { console.error(`  ${b.id} has ${found.count} answers`); bad++; }
  const r = analyse(b);
  if (Math.abs(scoreOf(r) - b.score) > 0.11) {
    console.error(`  ${b.id} scores ${scoreOf(r).toFixed(1)}, shipped as ${b.score}`);
    bad++;
  }
}

const shipped = made.map((b) => ({
  id: b.id,
  band: b.band,
  score: b.score,
  chapter: b.chapter,
  n: b.n,
  mode: b.mode,
  rowOps: b.rowOps,
  colOps: b.colOps,
  rowTargets: b.rowTargets,
  colTargets: b.colTargets,
  answer: b.answer,
}));

const counts = new Map<string, number>();
for (const s of shipped) counts.set(s.band, (counts.get(s.band) ?? 0) + 1);

mkdirSync('puzzles', { recursive: true });
const json = JSON.stringify(shipped);
writeFileSync('puzzles/nine.json', json);

console.log('');
for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);

/*
 * The spread the bands are cut from. Sampled fresh rather than taken from the
 * boards that were kept, because those were filtered by the chapter windows
 * and so are not the population the thresholds are meant to describe.
 */
console.log('\nthe spread the bands are cut from');
for (const chapter of LADDER.slice(0, 3)) {
  const rng = makeRng(`spread:${chapter.name}`);
  const scores: number[] = [];
  let tries = 0;
  let byReason = 0;
  while (scores.length < 600 && tries < 200_000) {
    tries++;
    const b = makeNine(chapter.recipe, rng);
    if (!b) continue;
    scores.push(scoreOf(b.reading));
    if (b.reading.byReason) byReason++;
  }
  scores.sort((a, b) => a - b);
  const q = (p: number) => (scores[Math.floor(scores.length * p)] ?? 0).toFixed(0);
  console.log(
    `  ${chapter.recipe.ops.join('').padEnd(5)} reasoned out ${String(Math.round((byReason / scores.length) * 100)).padStart(3)}%`
    + `   q1 ${q(0.25)}  med ${q(0.5)}  q3 ${q(0.75)}`,
  );
}

console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (bad > 0) {
  console.error(`\n${bad} board${bad === 1 ? '' : 's'} did not check out.`);
  process.exit(1);
}
console.log('Every board has exactly one answer.');
