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
import { buildShape, LADDER, scoreOf } from '../src/games/shape/design.js';
import { search, isUnique, analyse } from '../src/games/shape/solve.js';
import { judge } from '../src/games/shape/model.js';

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

console.log('\nchapter medians — the ladder has to climb');
LADDER.forEach((c, ci) => {
  const xs = shipped.filter((s) => s.chapter === ci + 1).map((s) => s.score).sort((a, b) => a - b);
  const med = xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  console.log(`  ${String(ci + 1).padStart(2)} ${c.name.padEnd(18)} ${String(xs.length).padStart(3)} boards  median ${med.toFixed(1)}`);
});

console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (bad > 0) {
  console.error(`\n${bad} board${bad === 1 ? '' : 's'} did not check out.`);
  process.exit(1);
}
console.log('Every board has exactly one answer, and every clue is needed.');
