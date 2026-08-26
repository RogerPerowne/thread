/**
 * Build the shipped boards.
 *
 * Each mode is a ladder of recipes that get bigger and busier. Inside a band
 * the boards are ordered by the honest difficulty signal — how many search
 * nodes it takes to prove the answer unique — so the ramp is measured rather
 * than asserted.
 *
 *   npx tsx scripts/build-boards.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { makeRng } from '../src/platform/rng.js';
import { makeBoard, type Recipe } from '../src/games/thread/make.js';
import type { Board } from '../src/games/thread/board.js';

type Band = { readonly count: number } & Recipe;

const SEED = process.env.SEED ?? 'thread-2';
/** How long any one chapter may spend looking. */
const BAND_SECONDS = Number(process.env.BAND_SECONDS ?? 150);

/**
 * The ladders. Sizes stop around twenty-five posts: past that a board stops
 * fitting a thumb, and proving uniqueness starts costing seconds rather than
 * milliseconds — the two limits happen to agree.
 */
const LADDERS: Record<'classic' | 'coloured' | 'grid', Band[]> = {
  classic: [
    { count: 10, cols: 3, rows: 3, strands: 1, shake: 3.5 },
    { count: 10, cols: 4, rows: 3, strands: 1, shake: 3.5 },
    { count: 10, cols: 4, rows: 4, strands: 1, shake: 3.2 },
    { count: 10, cols: 5, rows: 4, strands: 1, shake: 3 },
    { count: 10, cols: 5, rows: 5, strands: 1, shake: 2.6 },
    { count: 10, cols: 6, rows: 5, strands: 1, shake: 2.2 },
  ],
  coloured: [
    { count: 10, cols: 4, rows: 3, strands: 2, shake: 3.5 },
    { count: 10, cols: 4, rows: 4, strands: 2, shake: 3.2 },
    { count: 10, cols: 5, rows: 4, strands: 3, shake: 3 },
    { count: 10, cols: 5, rows: 5, strands: 3, shake: 2.6 },
    { count: 10, cols: 5, rows: 5, strands: 4, shake: 2.4 },
  ],
  /*
   * Grid grows the furthest, because a lattice board is nothing but its size
   * and its pinned pairs — and the designer now finds the pairs for itself
   * (see `refine`), so a chapter can ask for a bigger lattice and be told how
   * much pinning it takes rather than having to guess. Sixteen cells to
   * fifty-six across seven chapters.
   */
  grid: [
    { count: 10, cols: 4, rows: 4, strands: 3, shake: 0 },
    { count: 10, cols: 5, rows: 4, strands: 4, shake: 0 },
    { count: 10, cols: 5, rows: 5, strands: 4, shake: 0 },
    { count: 10, cols: 6, rows: 5, strands: 5, shake: 0 },
    { count: 10, cols: 6, rows: 6, strands: 6, shake: 0 },
    { count: 10, cols: 7, rows: 6, strands: 7, shake: 0 },
    { count: 10, cols: 7, rows: 7, strands: 8, shake: 0 },
    { count: 10, cols: 8, rows: 7, strands: 9, shake: 0 },
  ],
};

/**
 * The board grows with the chapter, so the ladder is a real one: nine posts in
 * chapter one, thirty by the last.
 *
 * Classic gets six chapters, Coloured five and Grid eight. That is not an
 * oversight in either direction, it is where the proof runs out in each case.
 *
 * Coloured stops at about thirty posts: many short strings can be paired up
 * more ways than few long ones, so past that no cut of the board is unique.
 * Grid goes much further because the designer can keep pinning pairs until it
 * is — but every pair needs a colour a player can tell from the others, and
 * there are twelve of those. Fifty-six cells is where a lattice starts needing
 * a thirteenth. Twelve by twelve would want somewhere north of twenty-five,
 * which is not a puzzle, it is a colour-matching exam.
 *
 * Difficulty inside a chapter is the search cost, which is measured;
 * difficulty between chapters is the size, which is chosen.
 */
export const CHAPTER_NAMES: Record<string, string[]> = {
  classic: ['First Nine', 'Wider', 'Sixteen', 'Twenty', 'Twenty-Five', 'The Long Way'],
  coloured: ['Two Strings', 'Sharing', 'Three Strings', 'Crowded', 'Four Strings', 'Full House'],
  grid: [
    'The Lattice', 'Twenty', 'Five Square', 'Thirty', 'Thirty-Six', 'Forty-Two',
    'Seven Square', 'Fifty-Six',
  ],
};

/**
 * Two boards with the same answer shape are the same puzzle wearing different
 * paint, so the answer itself is the fingerprint.
 */
function fingerprint(b: Board): string {
  const norm = b.solution.map((p) => {
    const fwd = p.join(',');
    const rev = [...p].reverse().join(',');
    return fwd < rev ? fwd : rev;
  });
  return `${b.posts.length}|${norm.sort().join('/')}`;
}

function buildMode(mode: 'classic' | 'coloured' | 'grid'): Board[] {
  const out: Board[] = [];
  const seen = new Set<string>();
  let bandNo = 0;

  for (const band of LADDERS[mode]) {
    bandNo++;
    const made: { board: Board; nodes: number }[] = [];
    const wanted = band.count;
    let seed = 0;
    const cap = wanted * 60;
    /*
     * A wall-clock budget as well as an attempt count. Proving a big board
     * unique is expensive and the cost is not knowable in advance, so without
     * this a single unlucky band can grind for an hour. Better a short chapter
     * that the log names than a build nobody can wait out.
     */
    const until = Date.now() + BAND_SECONDS * 1000;

    while (made.length < wanted && seed < cap && Date.now() < until) {
      const rng = makeRng(`${SEED}/${mode}/${bandNo}/${seed++}`);
      const m = makeBoard(mode, 'pending', band, rng);
      if (!m) continue;
      const fp = fingerprint(m.board);
      if (seen.has(fp)) continue;
      seen.add(fp);
      made.push(m);
    }

    made.sort((a, b) => a.nodes - b.nodes);
    for (const m of made) {
      const n = out.length + 1;
      // The mode's whole name, not its initial: classic and coloured share
      // a first letter, and two boards with one id share a solved mark.
      out.push({ ...m.board, id: `${mode}-${n}`, chapter: bandNo });
    }
    const grade = made.length
      ? `${made[0].nodes}..${made[made.length - 1].nodes}`
      : '-';
    console.log(
      `  ${mode.padEnd(9)} band ${bandNo}  ${band.cols}x${band.rows}` +
      `/${band.strands}  ${String(made.length).padStart(2)}/${wanted}` +
      `  nodes ${grade}`,
    );
  }
  return out;
}

console.log(`Building boards with seed "${SEED}"\n`);
mkdirSync('boards', { recursive: true });

let total = 0;
for (const mode of ['classic', 'coloured', 'grid'] as const) {
  const boards = buildMode(mode);
  const json = JSON.stringify(boards);
  writeFileSync(`boards/${mode}.json`, json);
  console.log(`  wrote boards/${mode}.json  (${boards.length} boards, ${Math.round(json.length / 1024)} kB)\n`);
  total += boards.length;
}
console.log(`Total: ${total} boards`);
