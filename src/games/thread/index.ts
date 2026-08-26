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
import raw from '../../../boards/thread.json';
import './thread.css';

type Shipped = Board & { score: number; band: Band };

/*
 * JSON widens the point pairs to number[], so the cast goes through unknown.
 * The build script wrote these and the gate re-proves them, so the shape is
 * known and this is the one place it is asserted.
 */
const ALL = raw as unknown as Shipped[];

/*
 * The chapter names say what changes as you climb: the size of the lattice,
 * which is also — measured — what makes a board harder to reason out.
 */
const CHAPTER_NAMES = [
  'Sixteen', 'Twenty', 'Five Square', 'Thirty', 'Thirty-Six', 'Forty-Two',
  'Seven Square',
];

/*
 * The band is the one the designer measured and wrote into the board, from how
 * far the crossing-out has to be carried — not from how many posts there are.
 * A small board that takes eight passes of reasoning is a harder puzzle than a
 * big one that falls out in three, and telling a player otherwise because one
 * has more dots on it would be a lie the ladder tells itself.
 */
const puzzles: Puzzle<Board>[] = ALL.map((board) => ({
  id: board.id,
  game: 'thread',
  seed: board.id,
  band: board.band,
  effort: board.score,
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
      'String never crosses a wall.',
      'A string may go back on itself as sharply as you like — a turn at a post is a wrap round a nail, and a wrap is not a fault.',
      'Each string has to join its own two ends. Two dots of one colour say which.',
    ],
  },
  puzzles: () => puzzles,
  chapters: () => {
    const numbers = [...new Set(puzzles.map((p) => p.data.chapter))].sort((a, b) => a - b);
    return numbers.map((n) => ({
      name: CHAPTER_NAMES[n - 1] ?? `Chapter ${n}`,
      puzzles: puzzles.filter((p) => p.data.chapter === n),
    }));
  },
  begin: (puzzle) => new ThreadSession(puzzle.data),
  mount: (host, session, view) => mountThread(host, session as ThreadSession, view),
  miniature,
  tutorial: [],
};
