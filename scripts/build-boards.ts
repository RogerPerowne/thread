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
import { makeRng } from '../src/core/rng.js';
import { makeBoard, type Recipe } from '../src/core/make.js';
import type { Board } from '../src/core/board.js';

type Band = { readonly count: number } & Recipe;

const SEED = process.env.SEED ?? 'thread-2';

/**
 * The ladders. Sizes stop around twenty-five posts: past that a board stops
 * fitting a thumb, and proving uniqueness starts costing seconds rather than
 * milliseconds — the two limits happen to agree.
 */
const LADDERS: Record<'classic' | 'coloured' | 'grid', Band[]> = {
  classic: [
    { count: 8, cols: 3, rows: 3, strands: 1, shake: 4 },
    { count: 8, cols: 4, rows: 3, strands: 1, shake: 4 },
    { count: 12, cols: 4, rows: 4, strands: 1, shake: 4 },
    { count: 12, cols: 5, rows: 4, strands: 1, shake: 3.5 },
  ],
  coloured: [
    { count: 8, cols: 4, rows: 3, strands: 2, shake: 4 },
    { count: 10, cols: 4, rows: 4, strands: 3, shake: 4 },
    { count: 12, cols: 5, rows: 4, strands: 3, shake: 3.5 },
    { count: 10, cols: 5, rows: 4, strands: 4, shake: 3.5 },
  ],
  grid: [
    { count: 8, cols: 4, rows: 4, strands: 3, shake: 0 },
    { count: 10, cols: 5, rows: 4, strands: 4, shake: 0 },
    { count: 12, cols: 5, rows: 5, strands: 5, shake: 0 },
    { count: 10, cols: 5, rows: 5, strands: 6, shake: 0 },
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

    while (made.length < wanted && seed < cap) {
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
      out.push({ ...m.board, id: `${mode[0]}-${n}` });
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
