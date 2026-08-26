/**
 * Build Shape Up's boards.
 *
 *   npx tsx scripts/build-shape.ts
 *
 * Deterministic from one seed. Every board is re-proved unique from what is
 * about to be written rather than from what the designer remembers, and the
 * spread the bands are cut from is printed, because a threshold nobody can
 * re-measure is a threshold nobody can check.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildShape, LADDER, makeShape, scoreOf } from '../src/games/shape/design.js';
import { search, isUnique, analyse } from '../src/games/shape/solve.js';
import { judge } from '../src/games/shape/model.js';
import { makeRng } from '../src/platform/rng.js';

const SEED = process.env.SEED ?? 'shape-1';

console.log(`Building Shape Up with seed "${SEED}"\n`);
const t0 = Date.now();
const made = buildShape(SEED, (msg) => console.log(`  ${msg}`));

let bad = 0;
for (const b of made) {
  if (!judge(b, b.answer.slice()).solved) {
    console.error(`  ${b.id} rejects its own answer`);
    bad++;
  }
  const found = search(b, 2);
  if (!isUnique(found)) {
    console.error(`  ${b.id} has ${found.count} answers${found.exhausted ? '' : ' (search cut off)'}`);
    bad++;
  }
  const score = scoreOf(analyse(b));
  if (Math.abs(score - b.score) > 0.11) {
    console.error(`  ${b.id} scores ${score.toFixed(1)}, shipped as ${b.score}`);
    bad++;
  }
  /*
   * Every clue is load-bearing: the designer removed each one, found the board
   * stopped being unique, and put it back. Re-checked here, because a clue
   * that could be removed is a clue the player has to read for nothing.
   */
  for (let i = 0; i < b.clues.length; i++) {
    const without = b.clues.filter((_, k) => k !== i);
    if (isUnique(search({ ...b, clues: without }, 2))) {
      console.error(`  ${b.id} carries a clue it does not need`);
      bad++;
      break;
    }
  }
}

const shipped = made.map((b) => ({
  id: b.id,
  band: b.band,
  score: b.score,
  chapter: b.chapter,
  w: b.w,
  h: b.h,
  shapes: b.shapes,
  clues: b.clues,
  answer: b.answer,
}));

const counts = new Map<string, number>();
for (const s of shipped) counts.set(s.band, (counts.get(s.band) ?? 0) + 1);

mkdirSync('puzzles', { recursive: true });
const json = JSON.stringify(shipped);
writeFileSync('puzzles/shape.json', json);

console.log('');
for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);

console.log('\nthe spread the bands are cut from');
for (const chapter of LADDER) {
  if (chapter.from !== 0) continue;
  const rng = makeRng(`spread:${chapter.recipe.w}${chapter.recipe.h}${chapter.recipe.shapes}`);
  const scores: number[] = [];
  let tries = 0;
  let reasoned = 0;
  const until = Date.now() + 6000;
  while (scores.length < 40 && tries < 400 && Date.now() < until) {
    tries++;
    const b = makeShape(chapter.recipe, rng);
    if (!b) continue;
    scores.push(scoreOf(b.reading));
    if (b.reading.byReason) reasoned++;
  }
  scores.sort((a, b) => a - b);
  const q = (p: number) => (scores[Math.floor(scores.length * p)] ?? 0).toFixed(0);
  console.log(
    `  ${chapter.recipe.w}x${chapter.recipe.h} ${chapter.recipe.shapes} shapes`
    + `  n=${String(scores.length).padStart(2)}  reasoned out ${String(Math.round((reasoned / Math.max(1, scores.length)) * 100)).padStart(3)}%`
    + `   q1 ${q(0.25)}  med ${q(0.5)}  q3 ${q(0.75)}`,
  );
}

console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (bad > 0) {
  console.error(`\n${bad} board${bad === 1 ? '' : 's'} did not check out.`);
  process.exit(1);
}
console.log('Every board has exactly one answer, and every clue is needed.');
