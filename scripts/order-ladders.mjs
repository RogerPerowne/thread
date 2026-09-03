/**
 * Put every ladder's chapters in the order its own measure puts them.
 *
 *   node scripts/order-ladders.mjs        # report only
 *   node scripts/order-ladders.mjs --write
 *
 * A chapter is one recipe, and which recipe is harder than which is not
 * something anybody can tell by looking. Hand-ordered by "a bigger board must
 * be harder", every one of the six ladders came out wrong: Hexagony's flower
 * with five numbers is easier than its three by two with three, One to Nine
 * runs backwards from the obvious order end to end, and Zigzag's diagonals
 * matter more than any two sizes put together.
 *
 * So the chapters are built, their medians read off the boards they actually
 * made, and the chapters then put in THAT order. This script does the putting;
 * the source records the answer, so nothing has to be re-measured to build.
 *
 * It only works because a chapter is seeded by its RECIPE and not by where it
 * sits. Seeded by position, moving a chapter changes which boards it makes,
 * which changes its median, which changes where it should sit — a ladder that
 * will not sit still. Seeded by what it is, a chapter makes the same thirty
 * boards wherever it ends up, so this is a permutation and one pass settles it.
 * Run it twice: the second run should say every ladder is already in order.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const WRITE = process.argv.includes('--write');

/** Each game's shipped boards, and the file its LADDER is written in. */
const GAMES = [
  ['thread', 'boards/thread.json', 'scripts/build-boards.ts'],
  ['zigzag', 'puzzles/zigzag.json', 'src/games/zigzag/design.ts'],
  ['nine', 'puzzles/nine.json', 'src/games/nine/design.ts'],
  ['shape', 'puzzles/shape.json', 'src/games/shape/design.ts'],
  ['hex', 'puzzles/hex.json', 'src/games/hex/design.ts'],
  ['isolate', 'puzzles/isolate.json', 'src/games/isolate/design.ts'],
];

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

let moved = 0;
for (const [name, json, src] of GAMES) {
  const boards = JSON.parse(readFileSync(json, 'utf8'));
  const numbers = [...new Set(boards.map((b) => b.chapter))].sort((a, b) => a - b);
  const scoresOf = (n) => boards.filter((b) => b.chapter === n).map((b) => b.score);
  const order = numbers
    .map((n) => [n, median(scoresOf(n))])
    .sort((a, b) => a[1] - b[1])
    .map(([n]) => n);

  if (order.every((n, i) => n === numbers[i])) {
    console.log(`${name.padEnd(8)} already in order`);
    continue;
  }

  const text = readFileSync(src, 'utf8');
  /* The array's own bracket, not the one in `Chapter[]`. */
  const opens = text.indexOf('= [', text.indexOf('LADDER')) + 2;
  const closes = text.indexOf('];', opens);
  const lines = text.slice(opens + 1, closes).split('\n').filter((l) => l.trim().startsWith('{'));
  if (lines.length !== numbers.length) {
    console.log(`${name.padEnd(8)} SKIP: ${lines.length} entries against ${numbers.length} chapters`);
    continue;
  }

  /* The short chapter is whichever one ends up last, so the count moves too. */
  const put = order
    .map((n) => lines[n - 1])
    .map((l, i) => l.replace(/count: \d+/, `count: ${i === lines.length - 1 ? 20 : 30}`));

  console.log(`${name.padEnd(8)} ${WRITE ? 'reordered' : 'would reorder'} ${order.join(',')}`);
  moved++;
  if (WRITE) {
    writeFileSync(src, `${text.slice(0, opens + 1)}\n${put.join('\n')}\n${text.slice(closes)}`);
  }
}

if (!WRITE && moved > 0) {
  console.log('\nRun again with --write, then rebuild those games and run this once more.');
}
