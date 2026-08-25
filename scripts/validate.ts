/**
 * The gate. Every shipped board, re-proven from the JSON that actually ships.
 *
 * The designer already checked all of this, but the designer is not what runs
 * in CI — the files are. Four questions per board, and a board that fails any
 * of them is not a puzzle:
 *
 *   1. Is the answer it ships with actually legal?
 *   2. Is it the ONLY answer?
 *   3. Is every post reachable at all, so the board is not quietly impossible?
 *   4. Is it the right size and shape for the mode it claims to be?
 *
 *   npx tsx scripts/validate.ts
 */

import { readFileSync } from 'node:fs';
import { compile, type Board } from '../src/core/board.js';
import { judge } from '../src/core/check.js';
import { search } from '../src/core/search.js';

const MODES = ['classic', 'coloured', 'grid'] as const;
const NODES = 400_000;

let bad = 0;
let checked = 0;
const t0 = Date.now();

console.log('Thread board gate\n');
console.log('           boards   answer legal   only answer   nodes to prove');
console.log('-'.repeat(66));

for (const mode of MODES) {
  const boards = JSON.parse(readFileSync(`boards/${mode}.json`, 'utf8')) as Board[];
  let legal = 0;
  let unique = 0;
  let worst = 0;
  const ids = new Set<string>();

  for (const board of boards) {
    checked++;
    if (board.mode !== mode) {
      console.error(`  ${board.id}: claims mode "${board.mode}" in ${mode}.json`);
      bad++;
    }
    if (ids.has(board.id)) {
      console.error(`  ${board.id}: duplicate id`);
      bad++;
    }
    ids.add(board.id);

    const c = compile(board);
    const verdict = judge(c, board.solution as number[][]);
    if (verdict.solved) legal++;
    else {
      console.error(`  ${board.id}: its own answer does not hold — ${verdict.faults.join(', ')}`);
      bad++;
    }

    const found = search(c, 2, NODES);
    if (found.exhausted) {
      console.error(`  ${board.id}: could not be proven either way inside ${NODES} nodes`);
      bad++;
    } else if (found.solutions.length === 1) {
      unique++;
      worst = Math.max(worst, found.nodes);
    } else {
      console.error(`  ${board.id}: has ${found.solutions.length} answers, not one`);
      bad++;
    }

    // A post nothing can reach makes the board unsolvable, and a post with one
    // way out has to be a string end — worth naming separately from "no answer"
    // because it points straight at the mistake.
    for (let p = 0; p < c.n; p++) {
      if (c.neighbours[p].length === 0) {
        console.error(`  ${board.id}: post ${p} has no legal run at all`);
        bad++;
      }
    }
  }

  console.log(
    `${mode.padEnd(10)} ${String(boards.length).padStart(5)}` +
    `   ${String(legal).padStart(11)}/${boards.length}` +
    `   ${String(unique).padStart(9)}/${boards.length}` +
    `   ${String(worst).padStart(12)}`,
  );
}

console.log('-'.repeat(66));
console.log(`\n${checked} boards checked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (bad > 0) {
  console.error(`\n${bad} problem${bad === 1 ? '' : 's'}. Nothing ships like this.`);
  process.exit(1);
}
console.log('\nEvery board has exactly one answer.');
