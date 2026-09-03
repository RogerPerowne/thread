/**
 * Build Zigzag's boards.
 *
 *   npx tsx scripts/build-zigzag.ts
 *
 * Deterministic from one seed, so the same command always writes the same
 * file. Boards are ordered by measured difficulty inside each size band, which
 * is what makes the ladder a real one rather than a list.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { buildZigzag, bandOf, LADDER } from '../src/games/zigzag/design.js';

const SEED = process.env.SEED ?? 'zig-1';

console.log(`Building Zigzag with seed "${SEED}"\n`);
const t0 = Date.now();
const made = buildZigzag(SEED, (msg) => console.log(`  ${msg}`));

const shipped = made.map((m, i) => ({
  id: `zigzag-${i + 1}`,
  band: bandOf(m),
  score: Math.round(m.score * 10) / 10,
  chapter: m.chapter,
  nodes: m.nodes,
  forced: Math.round(m.forcedShare * 1000) / 1000,
  ...m.zig,
}));

/* The ladder has to climb. Chapter medians are the honest check: any one board
   can be easier than the one before it, but a chapter that is easier than the
   one below it is a ladder that lies. */
const medians = LADDER.map((_, ci) => {
  const xs = shipped.filter((s) => s.chapter === ci + 1).map((s) => s.score).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
});
console.log('\nchapter medians');
LADDER.forEach((c, ci) => {
  const n = shipped.filter((s) => s.chapter === ci + 1).length;
  console.log(`  ${String(ci + 1).padStart(2)} ${c.name.padEnd(22)} ${String(n).padStart(3)} boards  median ${medians[ci].toFixed(1)}`);
});

const counts = new Map<string, number>();
for (const s of shipped) counts.set(s.band, (counts.get(s.band) ?? 0) + 1);

mkdirSync('puzzles', { recursive: true });
const json = JSON.stringify(shipped);
writeFileSync('puzzles/zigzag.json', json);

for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);
console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
