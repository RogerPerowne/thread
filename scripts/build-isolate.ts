/**
 * Build Isolate's boards.
 *
 *   npx tsx scripts/build-isolate.ts
 *
 * Deterministic from one seed. Every board is re-proved from what is about to
 * be written rather than from what the designer remembers: its own answer has
 * to satisfy it, no second answer may exist, and it has to be reasonable —
 * finishable by crossing-out rather than by trying walls and seeing. The
 * spread the bands are cut from is printed, because a threshold nobody can
 * re-measure is a threshold nobody can check.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildIsolate, LADDER, makeIsolate, bandOf } from '../src/games/isolate/design.js';
import { search, isUnique, analyse, scoreOf } from '../src/games/isolate/solve.js';
import { judge } from '../src/games/isolate/model.js';
import { makeRng } from '../src/platform/rng.js';

const SEED = process.env.SEED ?? 'isolate-1';

console.log(`Building Isolate with seed "${SEED}"\n`);
const t0 = Date.now();
const made = buildIsolate(SEED, (msg) => console.log(`  ${msg}`));

let bad = 0;
for (const b of made) {
  if (!judge(b, new Set(b.answer)).solved) {
    console.error(`  ${b.id} rejects its own answer`);
    bad++;
  }
  const found = search(b, 2);
  if (!isUnique(found)) {
    console.error(`  ${b.id} has ${found.count} answers${found.exhausted ? '' : ' (search cut off)'}`);
    bad++;
  }
  const reading = analyse(b);
  if (!reading.byReason) {
    console.error(`  ${b.id} cannot be reasoned out — ${reading.stuck} walls left undecided`);
    bad++;
  }
  if (Math.abs(scoreOf(reading) - b.score) > 0.11) {
    console.error(`  ${b.id} scores ${scoreOf(reading).toFixed(1)}, shipped as ${b.score}`);
    bad++;
  }
  /* Every drawn wall is one of the answer's, or the board contradicts itself
     before the player has touched it. */
  for (const edge of b.given) {
    if (!b.answer.includes(edge)) {
      console.error(`  ${b.id} draws a wall its own answer does not have`);
      bad++;
      break;
    }
  }
  if (b.dots.length % 2 !== 0) {
    console.error(`  ${b.id} has an odd number of circles`);
    bad++;
  }
}

const shipped = made.map((b) => ({
  id: b.id,
  band: b.band,
  score: b.score,
  chapter: b.chapter,
  w: b.w,
  h: b.h,
  dots: b.dots,
  sizes: b.sizes,
  crosses: b.crosses,
  given: b.given,
  answer: b.answer,
}));

mkdirSync('puzzles', { recursive: true });
const json = JSON.stringify(shipped);
writeFileSync('puzzles/isolate.json', json);

const counts = new Map<string, number>();
for (const s of shipped) counts.set(s.band, (counts.get(s.band) ?? 0) + 1);
console.log('');
for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);

console.log('\nthe spread the bands are cut from');
const pooled: number[] = [];
for (const chapter of LADDER) {
  const rng = makeRng(`spread:${chapter.name}`);
  const scores: number[] = [];
  const crosses: number[] = [];
  const walls: number[] = [];
  let tries = 0;
  const until = Date.now() + 8000;
  while (scores.length < 20 && tries < 2000 && Date.now() < until) {
    tries++;
    const b = makeIsolate(chapter.recipe, rng);
    if (!b) continue;
    scores.push(scoreOf(b.reading));
    crosses.push(b.crosses.length);
    walls.push(b.given.length);
  }
  scores.sort((a, b) => a - b);
  pooled.push(...scores);
  const q = (p: number) => (scores[Math.floor(scores.length * p)] ?? 0).toFixed(0);
  const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}..${Math.max(...xs)}` : '-');
  console.log(
    `  ${chapter.name.padEnd(13)} ${chapter.recipe.w}x${chapter.recipe.h} rooms to ${chapter.recipe.biggest}`
    + `  n=${String(scores.length).padStart(2)}   q1 ${q(0.25)}  med ${q(0.5)}  q3 ${q(0.75)}`
    + `   crosses ${range(crosses)}  drawn walls ${range(walls)}`,
  );
}
pooled.sort((a, b) => a - b);
const pq = (p: number) => (pooled[Math.floor(pooled.length * p)] ?? 0).toFixed(1);
console.log(`  pooled n=${pooled.length}  q1 ${pq(0.25)}  med ${pq(0.5)}  q3 ${pq(0.75)}`);
void bandOf;

console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (bad > 0) {
  console.error(`\n${bad} board${bad === 1 ? '' : 's'} did not check out.`);
  process.exit(1);
}
console.log('Every board has one answer, and every one can be reasoned out.');
