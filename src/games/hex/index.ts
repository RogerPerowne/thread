/**
 * Hexagony, as the platform sees it.
 */

import { svg } from '../../platform/dom.js';
import { HexSession } from './session.js';
import { mountHex } from './view.js';
import { LADDER } from './design.js';
import { hexPath, sectorPath, centreOf } from './model.js';
import type { Hex } from './model.js';
import type { HexState } from './session.js';
import type { Band, GamePackage, Puzzle } from '../../platform/types.js';
import raw from '../../../puzzles/hex.json';
import './hex.css';

type Shipped = Hex & { id: string; band: Band; score: number; chapter: number };

const ALL = raw as unknown as Shipped[];

const puzzles: Puzzle<Hex>[] = ALL.map((b) => ({
  id: b.id,
  game: 'hex',
  seed: b.id,
  band: b.band,
  effort: b.score,
  data: b,
}));

/**
 * The miniature: two tiles, and the one on the left arriving to meet the one
 * on the right along the edge they share.
 *
 * Two tiles rather than a board, because a nineteen-tile honeycomb at
 * seventy-six pixels is a texture. What this has to say in a second is "these
 * are hexagons and the faces where they meet have to agree", and two of them
 * saying it once is enough. It is drawn in the game's accent at varying
 * weight rather than in the board's eight colours: on a card the size of a
 * stamp, eight tints is a smudge, and the two faces that meet are the only
 * ones that have to be read — so they are the two that are solid.
 */
function miniature(host: HTMLElement, still: boolean): () => void {
  const root = svg('svg', { class: 'hexmini', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const R = 25;

  /* Direction 0 faces east and direction 3 faces west, so those are the two
     that touch: solid on both tiles, and quieter everywhere else. */
  const weights = [0.16, 0.3, 0.22, 0.42, 0.24, 0.34];
  const tile = (meeting: number): SVGGElement => {
    const g = svg('g', {});
    for (let d = 0; d < 6; d++) {
      g.appendChild(svg('path', {
        d: sectorPath(d, R),
        fill: 'var(--a-hex)',
        'fill-opacity': d === meeting ? 0.92 : weights[(d + meeting) % 6],
      }));
    }
    g.appendChild(svg('path', {
      d: hexPath(R), fill: 'none', stroke: 'var(--paper)', 'stroke-width': 1.6,
    }));
    return g;
  };

  /* Where the two sit when they have met: one step apart along direction 0. */
  const step = centreOf([1, 0]).x * R;
  const rx = 50 + step / 2;
  const lx = 50 - step / 2;

  const right = tile(3);
  const left = tile(0);
  right.setAttribute('transform', `translate(${rx.toFixed(1)} 50)`);
  root.append(right, left);
  host.appendChild(root);

  const put = (x: number) => left.setAttribute('transform', `translate(${x.toFixed(1)} 50)`);
  put(lx);

  if (still) return () => root.remove();

  let step_ = 0;
  const timer = window.setInterval(() => {
    step_ = (step_ + 1) % 4;
    put(step_ === 0 ? lx - 15 : lx);
  }, 720);
  return () => { clearInterval(timer); root.remove(); };
}

export const hex: GamePackage<Hex, HexState> = {
  meta: {
    id: 'hex',
    name: 'Hexagony',
    tagline: 'Fit the tiles so every pair that touches agrees.',
    rules: [
      'Every tile goes in a space, and every space takes a tile.',
      'Where two tiles touch, the two numbers facing each other have to match.',
      'Tiles never turn. A tile with a five on its left can only go where a five is wanted on the left.',
      'Drag a tile from the tray into a space, or tap the tile and then the space.',
    ],
    accent: 'a-hex',
    shareName: 'Hexagony',
  },
  puzzles: () => puzzles,
  chapters: () => LADDER.map((chapter, i) => ({
    name: chapter.name,
    puzzles: puzzles.filter((p) => (p.data as Shipped).chapter === i + 1),
  })).filter((c) => c.puzzles.length > 0),
  begin: (puzzle) => new HexSession(puzzle.data),
  mount: (host, session, view) => mountHex(host, session as HexSession, view),
  miniature,
  tutorial: [],
};
