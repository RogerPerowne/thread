/**
 * Build Hexagony's boards.
 *
 *   npx tsx scripts/build-hex.ts
 *
 * Deterministic from one seed. Every board is re-proved from what is about to
 * be written rather than from what the designer remembers: its own answer has
 * to satisfy it, no second answer may exist, no two tiles may be identical,
 * and the score it ships with has to be the score its deduction earns. The
 * spread the bands are cut from is printed, because a threshold nobody can
 * re-measure is a threshold nobody can check.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildHex, LADDER, makeHex, scoreOf } from '../src/games/hex/design.js';
import { search, isUnique, analyse } from '../src/games/hex/solve.js';
import { judge } from '../src/games/hex/model.js';
import { makeRng } from '../src/platform/rng.js';

const SEED = process.env.SEED ?? 'hex-1';

console.log(`Building Hexagony with seed "${SEED}"\n`);
const t0 = Date.now();
const made = buildHex(SEED, (msg) => console.log(`  ${msg}`));

let bad = 0;
for (const b of made) {
  if (!judge(b, b.answer).solved) {
    console.error(`  ${b.id} rejects its own answer`);
    bad++;
  }
  const found = search(b, 2);
  if (!isUnique(found)) {
    console.error(`  ${b.id} has ${found.count} answers${found.exhausted ? '' : ' (search cut off)'}`);
    bad++;
  }
  const keys = new Set(b.tiles.map((t) => t.join(',')));
  if (keys.size !== b.tiles.length) {
    console.error(`  ${b.id} has two tiles the same`);
    bad++;
  }
  const reading = analyse(b);
  if (!reading.byReason) {
    console.error(`  ${b.id} cannot be reasoned out`);
    bad++;
  }
  const score = scoreOf(reading);
  if (Math.abs(score - b.score) > 0.11) {
    console.error(`  ${b.id} scores ${score.toFixed(1)}, shipped as ${b.score}`);
    bad++;
  }
}

const shipped = made.map((b) => ({
  id: b.id,
  band: b.band,
  score: b.score,
  chapter: b.chapter,
  values: b.values,
  cells: b.cells,
  tiles: b.tiles,
  answer: b.answer,
}));

const counts = new Map<string, number>();
for (const s of shipped) counts.set(s.band, (counts.get(s.band) ?? 0) + 1);

mkdirSync('puzzles', { recursive: true });
const json = JSON.stringify(shipped);
writeFileSync('puzzles/hex.json', json);

console.log('');
for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);

console.log('\nthe spread the bands are cut from');
const pooled: number[] = [];
for (const chapter of LADDER) {
  const rng = makeRng(`spread:${chapter.recipe.name}:${chapter.recipe.values}`);
  const scores: number[] = [];
  let tries = 0;
  let drawn = 0;
  const until = Date.now() + 6000;
  while (scores.length < 40 && tries < 4000 && Date.now() < until) {
    tries++;
    const b = makeHex(chapter.recipe, rng);
    if (!b) continue;
    drawn++;
    if (b.reading.byReason) scores.push(scoreOf(b.reading));
  }
  scores.sort((a, b) => a - b);
  pooled.push(...scores);
  const q = (p: number) => (scores[Math.floor(scores.length * p)] ?? 0).toFixed(0);
  console.log(
    `  ${chapter.recipe.name.padEnd(9)} ${chapter.recipe.values} numbers`
    + `  n=${String(scores.length).padStart(2)}  reasoned out ${String(Math.round((scores.length / Math.max(1, drawn)) * 100)).padStart(3)}%`
    + `   q1 ${q(0.25)}  med ${q(0.5)}  q3 ${q(0.75)}`,
  );
}
pooled.sort((a, b) => a - b);
const pq = (p: number) => (pooled[Math.floor(pooled.length * p)] ?? 0).toFixed(1);
console.log(`  pooled n=${pooled.length}  q1 ${pq(0.25)}  med ${pq(0.5)}  q3 ${pq(0.75)}`);

console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (bad > 0) {
  console.error(`\n${bad} board${bad === 1 ? '' : 's'} did not check out.`);
  process.exit(1);
}
console.log('Every board has exactly one answer, and every one can be reasoned out.');
