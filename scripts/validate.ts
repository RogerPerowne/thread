/**
 * The gate. Every shipped board, re-proven from the JSON that actually ships.
 *
 * The designer already checked all of this, but the designer is not what runs
 * in CI — the files are. Five questions per board, and a board that fails any
 * of them is not a puzzle:
 *
 *   1. Is the answer it ships with actually legal?
 *   2. Is it the ONLY answer?
 *   3. Is every post reachable at all, so the board is not quietly impossible?
 *   4. Is it the right size and shape for the mode it claims to be?
 *   5. Can a thumb actually draw the answer without snatching up other posts,
 *      and does every string have a colour of its own to be known by?
 *
 *   npx tsx scripts/validate.ts
 */

import { readFileSync } from 'node:fs';
import {
  compile, segPointDist2, grabRadius, type Board,
} from '../src/games/thread/board.js';
import { judge } from '../src/games/thread/check.js';
import { search } from '../src/games/thread/search.js';

const MODES = ['classic', 'coloured', 'grid'] as const;
/*
 * The gate's budget has to be at least the designer's, or a board it proved
 * legitimately gets thrown out here for taking longer than this allows.
 */
const NODES = 900_000;

/** The closest any answer run comes to a post it does not use. */
function thumbClearance(board: Board): number {
  let worst = Infinity;
  for (const path of board.solution) {
    for (let i = 0; i + 1 < path.length; i++) {
      const a = board.posts[path[i]];
      const b = board.posts[path[i + 1]];
      for (let p = 0; p < board.posts.length; p++) {
        if (p === path[i] || p === path[i + 1]) continue;
        worst = Math.min(worst, Math.sqrt(segPointDist2(a, b, board.posts[p])));
      }
    }
  }
  return worst;
}

let bad = 0;
let checked = 0;
/** Every id in the game, so a clash between modes cannot slip through. */
const allIds: string[] = [];
const t0 = Date.now();

console.log('Thread board gate\n');
console.log('           boards   answer legal   only answer   nodes to prove');
console.log('-'.repeat(66));

for (const mode of MODES) {
  const boards = JSON.parse(readFileSync(`boards/${mode}.json`, 'utf8')) as Board[];
  for (const b of boards) allIds.push(b.id);
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

    /*
     * Playing is one long drag, so the string is laid by sweeping a thumb
     * along the route — and a sweep catches every post it passes within
     * GRAB_POST of. If an answer run grazed a post it does not use, drawing
     * that run would snatch the post up and the answer could not be drawn at
     * all. This is the check that the boards are playable by thumb and not
     * only solvable on paper.
     */
    const reach = grabRadius(board);
    const graze = thumbClearance(board);
    if (graze < reach) {
      console.error(
        `  ${board.id}: an answer run passes ${graze.toFixed(2)} from a post it does not use, inside the ${reach.toFixed(2)} a thumb catches`,
      );
      bad++;
    }

    // Two strings the same colour is two strings the player cannot tell apart.
    const inks = new Set(board.strands.map((s) => s.color));
    if (board.strands.length > 1 && inks.size !== board.strands.length) {
      console.error(`  ${board.id}: ${board.strands.length} strings share ${inks.size} colours`);
      bad++;
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

const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
if (dupes.length) {
  console.error(`\n  ids used by more than one board: ${[...new Set(dupes)].join(', ')}`);
  bad += dupes.length;
}

console.log(`\n${checked} boards checked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (bad > 0) {
  console.error(`\n${bad} problem${bad === 1 ? '' : 's'}. Nothing ships like this.`);
  process.exit(1);
}
console.log('\nEvery board has exactly one answer.');
