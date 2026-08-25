/**
 * A board at thumbnail size, for the card you fly into.
 *
 * It draws the posts and the pinned ends and nothing else — there is no answer
 * to withhold, because the whole point of this game is that the board never
 * tells you the route. The faint lead between each pair of ends is a gesture
 * at "these two belong together", not a route: it is drawn straight, which is
 * almost never the way the string actually goes.
 */

import { svg } from './dom.js';
import { POST_R, VIEW, type Board } from '../core/board.js';

export function miniBoard(board: Board, ink: string): SVGSVGElement {
  const root = svg('svg', {
    viewBox: `${VIEW.at} ${VIEW.at} ${VIEW.side} ${VIEW.side}`,
    class: 'mini', 'aria-hidden': 'true',
  });

  for (const b of board.blocks) {
    root.appendChild(svg('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h, rx: 0.8,
      fill: ink, 'fill-opacity': 0.45,
    }));
  }

  // One faint lead, so the card has a line to draw itself in with.
  const lead: string[] = [];
  for (const s of board.strands) {
    if (s.from < 0) continue;
    const a = board.posts[s.from];
    const b = board.posts[s.to];
    lead.push(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`);
  }
  root.appendChild(svg('path', {
    class: 'mini-lead', d: lead.join(''), fill: 'none', stroke: ink,
    'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-opacity': 0.5,
  }));

  const pinned = new Set<number>();
  for (const s of board.strands) if (s.from >= 0) { pinned.add(s.from); pinned.add(s.to); }
  for (let i = 0; i < board.posts.length; i++) {
    const [x, y] = board.posts[i];
    root.appendChild(svg('circle', {
      cx: x, cy: y, r: pinned.has(i) ? POST_R * 1.3 : POST_R * 0.85,
      fill: ink, 'fill-opacity': pinned.has(i) ? 1 : 0.55,
    }));
  }
  return root;
}
