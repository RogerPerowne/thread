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
import { buildZigzag, bandOf } from '../src/games/zigzag/design.js';

const SEED = process.env.SEED ?? 'zig-1';

console.log(`Building Zigzag with seed "${SEED}"\n`);
const t0 = Date.now();
const made = buildZigzag(SEED);

const shipped = made.map((m, i) => ({
  id: `zigzag-${i + 1}`,
  band: bandOf(m),
  nodes: m.nodes,
  forced: Math.round(m.forcedShare * 1000) / 1000,
  ...m.zig,
}));

const counts = new Map<string, number>();
for (const s of shipped) counts.set(s.band, (counts.get(s.band) ?? 0) + 1);

mkdirSync('puzzles', { recursive: true });
const json = JSON.stringify(shipped);
writeFileSync('puzzles/zigzag.json', json);

for (const [band, n] of counts) console.log(`  ${band.padEnd(8)} ${n}`);
console.log(`\n${shipped.length} boards, ${Math.round(json.length / 1024)} kB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
