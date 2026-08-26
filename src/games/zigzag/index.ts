/**
 * Zigzag, as the platform sees it.
 */

import { svg } from '../../platform/dom.js';
import { ZigSession } from './session.js';
import { mountZigzag } from './view.js';
import type { Zig } from './model.js';
import type { ZigState } from './session.js';
import type { Band, GamePackage, Puzzle } from '../../platform/types.js';
import raw from '../../../puzzles/zigzag.json';
import './zigzag.css';

type Shipped = Zig & { id: string; band: Band; nodes: number; forced: number };

const ALL = raw as unknown as Shipped[];

const puzzles: Puzzle<Zig>[] = ALL.map((z) => ({
  id: z.id,
  game: 'zigzag',
  seed: z.id,
  band: z.band,
  effort: z.nodes,
  data: z,
}));

/**
 * The miniature: a line snaking between numbered cells, over and over.
 *
 * Four cells and a line, which is the whole mechanic. It draws in, rests, and
 * unwinds — the rest is what stops it reading as a spinner.
 */
function miniature(host: HTMLElement, still: boolean): () => void {
  const cells: [number, number, number][] = [
    [16, 16, 1], [50, 16, 2], [84, 16, 3],
    [16, 50, 4], [50, 50, 1], [84, 50, 2],
    [16, 84, 3], [50, 84, 4], [84, 84, 1],
  ];
  const route = [0, 4, 1, 5, 2, 8, 7, 3, 6];
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const line = svg('path', {
    fill: 'none', stroke: 'var(--a-zigzag)', 'stroke-width': 7,
    'stroke-opacity': 0.42, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  root.appendChild(line);
  for (const [x, y, v] of cells) {
    root.appendChild(svg('rect', {
      x: x - 13, y: y - 13, width: 26, height: 26, rx: 3,
      fill: 'var(--a-zigzag)', 'fill-opacity': 0.12,
    }));
    root.appendChild(svg('text', {
      x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 15, 'font-family': 'var(--display)', 'font-weight': 700,
      fill: 'var(--a-zigzag)', 'fill-opacity': 0.85, text: String(v),
    }));
  }
  host.appendChild(root);

  const d = route.map((i, k) => `${k === 0 ? 'M' : 'L'}${cells[i][0]} ${cells[i][1]}`).join('');
  line.setAttribute('d', d);
  const len = line.getTotalLength?.() ?? 400;
  line.setAttribute('stroke-dasharray', String(len));

  if (still) {
    line.setAttribute('stroke-dashoffset', '0');
    return () => root.remove();
  }
  let raf = 0;
  let t0 = 0;
  const frame = (now: number) => {
    if (!t0) t0 = now;
    const t = ((now - t0) / 4600) % 1;
    const k = t < 0.4 ? t / 0.4 : t < 0.6 ? 1 : t < 0.9 ? 1 - (t - 0.6) / 0.3 : 0;
    line.setAttribute('stroke-dashoffset', String(len * (1 - k)));
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); root.remove(); };
}

export const zigzag: GamePackage<Zig, ZigState> = {
  meta: {
    id: 'zigzag',
    name: 'Zigzag',
    tagline: 'One line through every cell, in order.',
    accent: 'a-zigzag',
    shareName: 'Zigzag',
    rules: [
      'Draw one line from the marked first cell to the marked last cell.',
      'Every cell has to be used, and none of them twice.',
      'The line steps to any touching cell, including diagonally.',
      'The numbers you cross have to run 1, 2, 3, 4, then 1 again, all the way.',
      'Drag back over the cell before to take a step off.',
    ],
  },
  puzzles: () => puzzles,
  begin: (puzzle) => new ZigSession(puzzle.data),
  mount: (host, session, view) => mountZigzag(host, session as ZigSession, view),
  miniature,
  tutorial: [],
};
