/**
 * Isolate, as the platform sees it.
 */

import { svg } from '../../platform/dom.js';
import { IsolateSession } from './session.js';
import { mountIsolate } from './view.js';
import { LADDER } from './design.js';
import type { Board } from './model.js';
import type { IsolateState } from './session.js';
import type { Band, GamePackage, Puzzle } from '../../platform/types.js';
import raw from '../../../puzzles/isolate.json';
import './isolate.css';

type Shipped = Board & { id: string; band: Band; score: number; chapter: number };

const ALL = raw as unknown as Shipped[];

const puzzles: Puzzle<Board>[] = ALL.map((b) => ({
  id: b.id,
  game: 'isolate',
  seed: b.id,
  band: b.band,
  effort: b.score,
  data: b,
}));

/**
 * The miniature: a wall coming down between two pairs of circles.
 *
 * Four cells rather than a board, because a seven by six at seventy-six pixels
 * is a grey texture. What it has to say in a second is "these circles want a
 * room of their own and you draw the walls", and one wall arriving between two
 * pairs says it.
 */
function miniature(host: HTMLElement, still: boolean): () => void {
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const spots: [number, number][] = [[28, 32], [28, 68], [72, 32], [72, 68]];
  for (const [x, y] of spots) {
    root.appendChild(svg('circle', {
      cx: x, cy: y, r: 9, fill: 'none',
      stroke: 'var(--a-isolate)', 'stroke-width': 3, 'stroke-opacity': 0.55,
    }));
  }
  const wall = svg('line', {
    x1: 50, y1: 14, x2: 50, y2: 86,
    stroke: 'var(--a-isolate)', 'stroke-width': 5, 'stroke-linecap': 'round',
  });
  root.appendChild(wall);
  host.appendChild(root);

  if (still) return () => root.remove();

  let step = 0;
  const timer = window.setInterval(() => {
    step = (step + 1) % 4;
    wall.setAttribute('opacity', step === 0 ? '0' : '1');
  }, 720);
  return () => { clearInterval(timer); root.remove(); };
}

export const isolate: GamePackage<Board, IsolateState> = {
  meta: {
    id: 'isolate',
    name: 'Isolate',
    tagline: 'Wall the board into rooms of two circles.',
    rules: [
      'Draw walls on the lines between cells until every room holds exactly two circles.',
      'A number in a circle says how many cells its room has.',
      'Where a cross is printed, at least two walls have to meet.',
      'The walls already drawn are part of the board and cannot be rubbed out.',
      'Press a line to draw a wall, press it again to take it off, or drag along several.',
    ],
    accent: 'a-isolate',
    shareName: 'Isolate',
  },
  puzzles: () => puzzles,
  chapters: () => LADDER.map((chapter, i) => ({
    name: chapter.name,
    puzzles: puzzles.filter((p) => (p.data as Shipped).chapter === i + 1),
  })).filter((c) => c.puzzles.length > 0),
  begin: (puzzle) => new IsolateSession(puzzle.data),
  mount: (host, session, view) => mountIsolate(host, session as IsolateSession, view),
  miniature,
  tutorial: [],
};
