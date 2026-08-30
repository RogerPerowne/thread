/**
 * Shape Up, as the platform sees it.
 */

import { svg } from '../../platform/dom.js';
import { ShapeSession } from './session.js';
import { mountShape } from './view.js';
import { LADDER } from './design.js';
import { glyphPath } from './glyphs.js';
import type { Board } from './model.js';
import type { ShapeState } from './session.js';
import type { Band, GamePackage, Puzzle } from '../../platform/types.js';
import raw from '../../../puzzles/shape.json';
import './shape.css';

type Shipped = Board & { id: string; band: Band; score: number; chapter: number };

const ALL = raw as unknown as Shipped[];

const puzzles: Puzzle<Board>[] = ALL.map((b) => ({
  id: b.id,
  game: 'shape',
  seed: b.id,
  band: b.band,
  effort: b.score,
  data: b,
}));

/**
 * The miniature: shapes arriving in a row, one of each, with a clue watching.
 *
 * Four cells rather than a real board, because a six by six at seventy-six
 * pixels is a grey texture. What it has to say in a second is "these marks go
 * in these cells and something outside is watching", and four cells say it.
 */
function miniature(host: HTMLElement, still: boolean): () => void {
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const xs = [16, 44, 72];
  const order = [1, 3, 2];

  root.appendChild(svg('path', {
    d: glyphPath(1, 9),
    transform: 'translate(16 22)',
    fill: 'var(--a-shape)', 'fill-opacity': 0.55,
  }));
  root.appendChild(svg('path', {
    d: 'M 16 32 L 16 40 M 12.5 36.5 L 16 40.5 L 19.5 36.5',
    stroke: 'var(--a-shape)', 'stroke-opacity': 0.45, 'stroke-width': 2.4,
    fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

  const marks: SVGPathElement[] = [];
  for (let i = 0; i < 3; i++) {
    root.appendChild(svg('rect', {
      x: xs[i] - 13, y: 50, width: 26, height: 26, rx: 3,
      fill: 'var(--a-shape)', 'fill-opacity': 0.13,
    }));
    const m = svg('path', {
      d: glyphPath(order[i], 8),
      transform: `translate(${xs[i]} 63)`,
      fill: 'var(--a-shape)',
      opacity: 0,
    });
    root.appendChild(m);
    marks.push(m);
  }
  host.appendChild(root);

  if (still) {
    for (const m of marks) m.setAttribute('opacity', '1');
    return () => root.remove();
  }

  let step = 0;
  const timer = window.setInterval(() => {
    step = (step + 1) % 5;
    marks.forEach((m, i) => m.setAttribute('opacity', step > i ? '1' : '0'));
  }, 620);
  return () => { clearInterval(timer); root.remove(); };
}

export const shape: GamePackage<Board, ShapeState> = {
  meta: {
    id: 'shape',
    name: 'Shape Up',
    tagline: 'One of each shape in every row and column.',
    rules: [
      'Every row and every column holds one of each shape, and the rest is empty.',
      'A clue outside the grid says what you would see looking in: one dot under it means the first shape you meet along that line, two dots means the second.',
      'Choose a shape from the row under the board, then tap the cells it goes in — or drag it straight from there onto the board.',
      'A drag paints a run, and tapping a cell that already holds the chosen mark takes it off again.',
      'The dot marks a cell you have settled as empty. It is a note to yourself: the board is solved when the shapes are right, whether or not you drew them.',
    ],
    accent: 'a-shape',
    shareName: 'Shape Up',
  },
  puzzles: () => puzzles,
  chapters: () => LADDER.map((chapter, i) => ({
    name: chapter.name,
    puzzles: puzzles.filter((p) => (p.data as Shipped).chapter === i + 1),
  })).filter((c) => c.puzzles.length > 0),
  begin: (puzzle) => new ShapeSession(puzzle.data),
  mount: (host, session, view) => mountShape(host, session as ShapeSession, view),
  miniature,
  tutorial: [],
};
