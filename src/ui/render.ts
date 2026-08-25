/**
 * Drawing a board.
 *
 * The string is drawn as a polyline through post centres, stroked at
 * 2 * STRING_W with round caps and joins — which is exactly the set of points
 * the rule measures. What you see and what is judged are the same shape, so
 * a string that looks clear is clear.
 *
 * Every node here is made once and then only has its attributes set. Dragging
 * a string across a board touches a handful of `d` strings and nothing else:
 * no node is created, moved or replaced while you play, which is what keeps it
 * smooth on a phone.
 */

import { svg } from './dom.js';
import {
  type Compiled, POST_R, STRING_W, VIEW,
} from '../core/board.js';
import { tautPath } from '../core/taut.js';
import type { Verdict, Attempt } from '../core/check.js';

const SW = STRING_W * 2;

export type BoardView = {
  readonly el: SVGSVGElement;
  /** Repaint from an attempt and its verdict. Allocates nothing per call. */
  update(attempt: Attempt, verdict: Verdict): void;
  /** Board-space point from a client point, and the post nearest it. */
  at(clientX: number, clientY: number): { x: number; y: number };
  nearestPost(x: number, y: number, within: number): number;
  /** A post has just been caught: give it a beat so the eye follows. */
  flashPost(i: number): void;
  /** Mark the keyboard cursor. */
  markCursor(i: number): void;
  /** The board is solved: run the string round once. */
  celebrate(): void;
  dispose(): void;
};

export function mountBoard(c: Compiled): BoardView {
  const board = c.board;
  const el = svg('svg', {
    class: 'board-svg',
    viewBox: `${VIEW.at} ${VIEW.at} ${VIEW.side} ${VIEW.side}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-label': 'board',
    // The solve animation grows the stroke from whatever it is, so the width
    // lives in a variable rather than being repeated in the keyframes.
    style: `--sw:${SW}`,
  });

  // --- blocks ---------------------------------------------------------------
  const gBlocks = svg('g', { class: 'blocks' });
  for (const b of board.blocks) {
    gBlocks.appendChild(svg('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h, rx: 0.9, class: 'block',
    }));
  }

  // --- posts, under the string so it reads as wrapped around them -----------
  const gPosts = svg('g', { class: 'posts' });
  const postEl: SVGCircleElement[] = [];
  const ringEl: SVGCircleElement[] = [];
  for (let i = 0; i < board.posts.length; i++) {
    const [x, y] = board.posts[i];
    const ring = svg('circle', { cx: x, cy: y, r: POST_R + 1.5, class: 'pin' });
    const dot = svg('circle', { cx: x, cy: y, r: POST_R, class: 'post' });
    gPosts.append(ring, dot);
    ringEl.push(ring);
    postEl.push(dot);
  }

  // --- clash haloes, beneath the strings so the string stays readable -------
  const gClash = svg('g', { class: 'clashes' });
  const clashEl: SVGLineElement[] = [];

  // --- the strings ----------------------------------------------------------
  const gStrings = svg('g', { class: 'strings' });
  const strandEl: SVGPathElement[] = [];
  for (const s of board.strands) {
    const p = svg('path', {
      class: 'string', fill: 'none', stroke: s.color, 'stroke-width': SW,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    gStrings.appendChild(p);
    strandEl.push(p);
  }

  // --- the nail heads, on top, so the string passes behind them -------------
  const gHeads = svg('g', { class: 'heads' });
  const headEl: SVGCircleElement[] = [];
  for (let i = 0; i < board.posts.length; i++) {
    const [x, y] = board.posts[i];
    const head = svg('circle', { cx: x, cy: y, r: POST_R * 0.42, class: 'head' });
    gHeads.appendChild(head);
    headEl.push(head);
  }

  el.append(gBlocks, gPosts, gClash, gStrings, gHeads);

  /*
   * Animation is CSS class flips, never per-frame JavaScript. A caught post
   * and a solved board both want a short, self-cancelling beat, and the
   * compositor can run those without the main thread being involved at all —
   * which is what keeps a drag at full rate while things are moving.
   */
  const flashes = new Map<number, number>();
  function flashPost(i: number): void {
    const node = postEl[i];
    if (!node) return;
    node.classList.remove('caught');
    // Reading a layout property restarts the animation rather than letting the
    // class removal and addition collapse into one frame with no change.
    void node.getBoundingClientRect();
    node.classList.add('caught');
    clearTimeout(flashes.get(i));
    flashes.set(i, window.setTimeout(() => node.classList.remove('caught'), 320));
  }

  function markCursor(i: number): void {
    for (const p of postEl) p.classList.remove('cursor');
    postEl[i]?.classList.add('cursor');
  }

  let celebrating = 0;
  function celebrate(): void {
    el.classList.remove('celebrate');
    void el.getBoundingClientRect();
    el.classList.add('celebrate');
    clearTimeout(celebrating);
    celebrating = window.setTimeout(() => el.classList.remove('celebrate'), 900);
  }

  function dispose(): void {
    for (const t of flashes.values()) clearTimeout(t);
    flashes.clear();
    clearTimeout(celebrating);
  }

  /*
   * Pinned ends wear their string's colour from the start. On a Coloured board
   * that is the only instruction there is — two dots of a colour say "join
   * these" without a word of text.
   */
  const pinned = new Uint8Array(board.posts.length);
  for (const s of board.strands) {
    if (s.from < 0) continue;
    for (const p of [s.from, s.to]) {
      pinned[p] = 1;
      postEl[p].setAttribute('fill', s.color);
      postEl[p].classList.add('end');
      ringEl[p].setAttribute('stroke', s.color);
      ringEl[p].classList.add('pinned');
    }
  }

  function update(attempt: Attempt, verdict: Verdict): void {
    for (let s = 0; s < strandEl.length; s++) {
      // Taut, so the string wraps every post it uses rather than running
      // through the middle of it. See core/taut.ts.
      strandEl[s].setAttribute('d', tautPath(board.posts, attempt[s] ?? []));
    }

    // Leftover posts are only worth pointing out once there is something to
    // compare them against: on an untouched board every post is "leftover",
    // and greying the whole thing says nothing.
    const started = verdict.progress > 0;
    for (let i = 0; i < postEl.length; i++) {
      if (pinned[i]) continue;
      postEl[i].classList.toggle('spare', started && verdict.unused.includes(i));
    }

    const marks = verdict.clashes;
    while (clashEl.length < marks.length) {
      const line = svg('line', { class: 'clash' });
      gClash.appendChild(line);
      clashEl.push(line);
    }
    for (let i = 0; i < clashEl.length; i++) {
      const m = marks[i];
      if (!m) { clashEl[i].setAttribute('opacity', '0'); continue; }
      const a = board.posts[m[0]];
      const b = board.posts[m[1]];
      clashEl[i].setAttribute('x1', String(a[0]));
      clashEl[i].setAttribute('y1', String(a[1]));
      clashEl[i].setAttribute('x2', String(b[0]));
      clashEl[i].setAttribute('y2', String(b[1]));
      clashEl[i].setAttribute('opacity', '1');
    }
    el.classList.toggle('solved', verdict.solved);
  }

  function at(clientX: number, clientY: number): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    const side = Math.min(r.width, r.height);
    const ox = r.left + (r.width - side) / 2;
    const oy = r.top + (r.height - side) / 2;
    return {
      x: VIEW.at + ((clientX - ox) / side) * VIEW.side,
      y: VIEW.at + ((clientY - oy) / side) * VIEW.side,
    };
  }

  function nearestPost(x: number, y: number, within: number): number {
    let best = -1;
    let bestD = within * within;
    for (let i = 0; i < board.posts.length; i++) {
      const dx = board.posts[i][0] - x;
      const dy = board.posts[i][1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  void c;
  return { el, update, at, nearestPost, flashPost, markCursor, celebrate, dispose };
}
