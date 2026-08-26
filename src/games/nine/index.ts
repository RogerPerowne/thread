/**
 * One to Nine, as the platform sees it.
 */

import { svg } from '../../platform/dom.js';
import { NineSession } from './session.js';
import { mountNine } from './view.js';
import { LADDER } from './design.js';
import type { Nine } from './model.js';
import type { NineState } from './session.js';
import type { Band, GamePackage, Puzzle } from '../../platform/types.js';
import raw from '../../../puzzles/nine.json';
import './nine.css';

type Shipped = Nine & { id: string; band: Band; score: number; chapter: number };

const ALL = raw as unknown as Shipped[];

const puzzles: Puzzle<Nine>[] = ALL.map((b) => ({
  id: b.id,
  game: 'nine',
  seed: b.id,
  band: b.band,
  effort: b.score,
  data: b,
}));

/**
 * The miniature: digits dropping into a row until it comes out.
 *
 * Three cells and a sum, which is the whole mechanic at the size of a stamp.
 * A real board would be nine numbers nobody can read at seventy-six pixels.
 */
function miniature(host: HTMLElement, still: boolean): () => void {
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const xs = [8, 37, 66];
  const chips: SVGGElement[] = [];
  for (let i = 0; i < 3; i++) {
    root.appendChild(svg('rect', {
      x: xs[i], y: 24, width: 26, height: 26, rx: 3,
      fill: 'var(--a-nine)', 'fill-opacity': 0.13,
    }));
    const g = svg('g', {});
    g.append(
      svg('rect', { x: xs[i], y: 24, width: 26, height: 26, rx: 3, fill: 'var(--a-nine)' }),
      svg('text', {
        x: xs[i] + 13, y: 37, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        fill: '#fff', 'font-size': 18, 'font-weight': 700,
        'font-family': "'Libre Franklin', system-ui, sans-serif", text: String([4, 7, 2][i]),
      }),
    );
    g.setAttribute('opacity', '0');
    root.appendChild(g);
    chips.push(g);
  }
  for (const x of [35.5, 64.5]) {
    root.appendChild(svg('text', {
      x, y: 37, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: 'var(--a-nine)', 'fill-opacity': 0.6, 'font-size': 14, text: '+',
    }));
  }
  root.appendChild(svg('text', {
    x: 50, y: 76, 'text-anchor': 'middle', fill: 'var(--a-nine)',
    'font-size': 19, 'font-weight': 700, 'font-family': "'Libre Franklin', system-ui, sans-serif",
    text: '= 13',
  }));
  host.appendChild(root);

  if (still) {
    for (const g of chips) g.setAttribute('opacity', '1');
    return () => root.remove();
  }

  let step = 0;
  const timer = window.setInterval(() => {
    step = (step + 1) % 5;
    chips.forEach((g, i) => g.setAttribute('opacity', step > i ? '1' : '0'));
  }, 620);
  return () => { clearInterval(timer); root.remove(); };
}

export const nine: GamePackage<Nine, NineState> = {
  meta: {
    id: 'nine',
    name: 'One to Nine',
    tagline: 'Nine digits, six sums, one arrangement.',
    rules: [
      'Place the digits 1 to 9, each exactly once.',
      'Every row and every column has to come out at the number beside it.',
      'Sums read the ordinary way: multiply and divide before you add and subtract.',
      'Drag a digit in, or tap one and then a cell. Drag it off the board to take it back.',
    ],
    accent: 'a-nine',
    shareName: 'One to Nine',
  },
  puzzles: () => puzzles,
  chapters: () => LADDER.map((chapter, i) => ({
    name: chapter.name,
    puzzles: puzzles.filter((p) => (p.data as Shipped).chapter === i + 1),
  })).filter((c) => c.puzzles.length > 0),
  begin: (puzzle) => new NineSession(puzzle.data),
  mount: (host, session, view) => mountNine(host, session as NineSession, view),
  miniature,
  tutorial: [],
};
