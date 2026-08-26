/**
 * Thread, as the platform sees it.
 *
 * Everything the rest of the app knows about this game is in this file. The
 * board, the rules, the solver and the designer are all behind it, and none of
 * them appear anywhere outside this folder.
 */

import { svg } from '../../platform/dom.js';
import { ThreadSession } from './session.js';
import { mountThread } from './play.js';
import type { Board } from './board.js';
import type { Band, GamePackage, Puzzle } from '../../platform/types.js';
import type { ThreadState } from './session.js';
import classicRaw from '../../../boards/classic.json';
import colouredRaw from '../../../boards/coloured.json';
import gridRaw from '../../../boards/grid.json';
import './thread.css';

// JSON widens the point pairs to number[], so the cast goes through unknown.
// The build script wrote these and the gate re-proves them, so the shape is
// known and this is the one place it is asserted.
const ALL: Board[] = [
  ...(classicRaw as unknown as Board[]),
  ...(colouredRaw as unknown as Board[]),
  ...(gridRaw as unknown as Board[]),
];

/**
 * The band a board lands in.
 *
 * From the measured search cost, not from the size. A nine-post board that
 * takes three thousand nodes to prove unique is a harder puzzle than a
 * thirty-post board that takes three hundred, and telling a player otherwise
 * because one has more dots on it would be a lie the ladder tells itself.
 */
function bandOf(nodes: number): Band {
  if (nodes < 400) return 'gentle';
  if (nodes < 4000) return 'steady';
  if (nodes < 40000) return 'tricky';
  return 'severe';
}

/*
 * The shipped boards carry no node count — the gate has it, the JSON does not.
 * Until the designer writes it out, the chapter stands in for it: chapters are
 * ordered by measured difficulty within a mode, so the mapping is honest even
 * though it is coarser than the real number.
 */
const puzzles: Puzzle<Board>[] = ALL.map((board) => ({
  id: board.id,
  game: 'thread',
  seed: board.id,
  band: bandOf([120, 900, 3000, 9000, 30000, 60000, 90000, 120000][board.chapter - 1] ?? 3000),
  effort: board.chapter,
  data: board,
}));

/**
 * The miniature: string finding its way round a few posts, over and over.
 *
 * Abstract rather than a real board. It has to read at seventy-six pixels and
 * say "a line goes between these" in about a second, which a real puzzle
 * cannot do.
 */
function miniature(host: HTMLElement, still: boolean): () => void {
  const posts: [number, number][] = [
    [22, 24], [50, 18], [78, 30], [80, 62], [52, 76], [22, 58],
  ];
  const line = svg('path', {
    fill: 'none', stroke: 'var(--a-thread)', 'stroke-width': 5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const root = svg('svg', { viewBox: '0 0 100 94', 'aria-hidden': 'true' }, line);
  for (const [x, y] of posts) {
    root.appendChild(svg('circle', { cx: x, cy: y, r: 4.4, fill: 'var(--a-thread)', 'fill-opacity': 0.28 }));
  }
  host.appendChild(root);

  const d = posts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join('');
  line.setAttribute('d', d);
  const len = line.getTotalLength?.() ?? 300;
  line.setAttribute('stroke-dasharray', String(len));

  if (still) {
    line.setAttribute('stroke-dashoffset', '0');
    return () => root.remove();
  }

  let raf = 0;
  let t0 = 0;
  const frame = (now: number) => {
    if (!t0) t0 = now;
    // Draws in, holds, unwinds, holds. The pause is what stops it reading as a
    // spinner: a loop with no rest in it is an animation nobody stops noticing.
    const t = ((now - t0) / 4200) % 1;
    const k = t < 0.35 ? t / 0.35 : t < 0.5 ? 1 : t < 0.85 ? 1 - (t - 0.5) / 0.35 : 0;
    line.setAttribute('stroke-dashoffset', String(len * (1 - k)));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); root.remove(); };
}

export const thread: GamePackage<Board, ThreadState> = {
  meta: {
    id: 'thread',
    name: 'Thread',
    tagline: 'One string, every post, nothing touching.',
    accent: 'a-thread',
    shareName: 'Thread',
    rules: [
      'Use every post on the board.',
      'String never lies across other string, or across itself.',
      'String never crosses a block.',
      'A string may go back on itself as sharply as you like — a turn at a post is a wrap round a nail, and a wrap is not a fault.',
      'On a coloured board, each string has to join its own two ends. Two dots of one colour say which.',
    ],
  },
  puzzles: () => puzzles,
  begin: (puzzle) => new ThreadSession(puzzle.data),
  mount: (host, session, view) => mountThread(host, session as ThreadSession, view),
  miniature,
  tutorial: [],
};
