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

import { svg } from '../../platform/dom.js';
import {
  type Compiled, POST_R, STRING_W, GLOW_R, GLOW_SWELL, viewOf,
} from './board.js';
import type { Verdict } from './check.js';

/** One run of posts per strand, in the order the string passes through them. */
export type Paths = readonly (readonly number[])[];

const SW = STRING_W * 2;

export type BoardView = {
  readonly el: SVGSVGElement;
  /** Repaint from the strings on the board and their verdict. */
  update(paths: Paths, verdict: Verdict): void;
  /** Board-space point from a client point, and the post nearest it. */
  at(clientX: number, clientY: number): { x: number; y: number };
  nearestPost(x: number, y: number, within: number): number;
  /** A post has just been caught: give it a beat so the eye follows. */
  flashPost(i: number): void;
  /** Mark the keyboard cursor. */
  markCursor(i: number): void;
  /** The board is solved: run the string round once. */
  celebrate(): void;
  /**
   * String has just been taken back off. `path` is the discarded run of posts,
   * the post it now ends at first, so the recoil travels outwards from there.
   */
  retract(strand: number, path: readonly number[]): void;
  /** There is no way to lay string where the thumb just went: say so. */
  refuse(path: readonly number[]): void;
  /** Draw attention to some posts, for a hint. Empty clears it. */
  spotlight(posts: readonly number[]): void;
  /**
   * The loose end, following the finger. `post` is where the string currently
   * ends; x and y are where the thumb is, in board space. `reach` says whether
   * letting go there would actually lay string, which is worth showing before
   * the player finds out by nothing happening.
   */
  setLead(strand: number, post: number, x: number, y: number, reach: boolean): void;
  clearLead(): void;
  dispose(): void;
};

export function mountBoard(c: Compiled): BoardView {
  const board = c.board;
  // The window is this board's own extent, so nothing it draws can fall off
  // the edge and a board that does not fill the square is drawn larger.
  const view = viewOf(board);
  const el = svg('svg', {
    class: 'board-svg',
    viewBox: `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.side.toFixed(2)} ${view.side.toFixed(2)}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-label': 'board',
    // The solve animation grows the stroke from whatever it is, so the width
    // lives in a variable rather than being repeated in the keyframes.
    // The keyframes grow these from whatever they are, so the numbers live in
    // variables rather than being repeated — and the halo's swell is the same
    // number the board's window was sized from.
    style: `--sw:${SW};--swell:${GLOW_SWELL}`,
  });

  // --- blocks ---------------------------------------------------------------
  const gBlocks = svg('g', { class: 'blocks' });
  for (const b of board.blocks) {
    gBlocks.appendChild(svg('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h, rx: 0.9, class: 'block',
    }));
  }

  /*
   * The refusal glow, under everything, so the post and the string stay crisp
   * on top of it and the light reads as coming from behind the board.
   */
  const gGlow = svg('g', { class: 'glows' });
  const glowEl: SVGCircleElement[] = [];

  // --- posts, under the string so it reads as wrapped around them -----------
  const gPosts = svg('g', { class: 'posts' });
  const postEl: SVGCircleElement[] = [];
  const ringEl: SVGCircleElement[] = [];
  for (let i = 0; i < board.posts.length; i++) {
    const [x, y] = board.posts[i];
    const glow = svg('circle', {
      cx: x, cy: y, r: GLOW_R, class: 'glow',
    });
    gGlow.appendChild(glow);
    glowEl.push(glow);
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
  /* New pieces are inserted before this, so the loose end and the recoils stay
     on top of the string rather than being buried by it. */
  const waitingAnchor = svg('g');
  gStrings.appendChild(waitingAnchor);
  for (const s of board.strands) {
    const p = svg('path', {
      class: 'string', fill: 'none', stroke: s.color, 'stroke-width': SW,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    gStrings.insertBefore(p, waitingAnchor);
    strandEl.push(p);
  }

  /*
   * The loose end. A string that only moves when your thumb crosses a post
   * feels like it is being placed for you; one that reaches out to wherever
   * your thumb is feels like something you are holding.
   */
  const lead = svg('path', {
    class: 'lead', fill: 'none', 'stroke-width': SW,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0,
  });
  gStrings.appendChild(lead);

  // --- the nail heads, on top, so the string passes behind them -------------
  const gHeads = svg('g', { class: 'heads' });
  const headEl: SVGCircleElement[] = [];
  for (let i = 0; i < board.posts.length; i++) {
    const [x, y] = board.posts[i];
    const head = svg('circle', { cx: x, cy: y, r: POST_R * 0.42, class: 'head' });
    gHeads.appendChild(head);
    headEl.push(head);
  }

  el.append(gGlow, gBlocks, gPosts, gClash, gStrings, gHeads);

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

  /*
   * Taking string back off.
   *
   * The discarded stretch is drawn on a spare path and pulled back in: a dash
   * as long as the whole thing, wound off from the far end towards the post
   * the string now ends at, thinning as it goes. String that recoils reads as
   * string you took back; a line that simply stops being there reads as a bug,
   * and on a board you are still dragging across it is easy to miss entirely.
   *
   * ONE recoil per strand, and a new one that carries on from where the last
   * finished is JOINED to it rather than started beside it. Winding back over
   * five posts in one sweep is five cuts in as many frames, and five separate
   * animations of the same piece of string overlapping each other is the
   * flicker this used to have. Merged, it is one stretch of string coming off
   * — which is also what actually happened.
   */
  const recoilEl: SVGPathElement[] = [];
  /** The run each strand is currently winding off, loose end LAST. */
  const recoilRun: number[][] = [];
  board.strands.forEach((s, i) => {
    const p = svg('path', {
      class: 'recoil', fill: 'none', stroke: s.color, 'stroke-width': SW,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    /* The stylesheet owns how long the wind-off takes; nothing here has a
       copy of that number to fall out of step with. */
    p.addEventListener('animationend', () => {
      recoilRun[i] = [];
      p.classList.remove('go');
      p.setAttribute('d', '');
    });
    gStrings.appendChild(p);
    recoilEl.push(p);
    recoilRun.push([]);
  });

  function retract(strand: number, path: readonly number[]): void {
    const node = recoilEl[strand];
    if (!node || path.length < 2) return;

    /*
     * `path` arrives with the post the string now ends at first. If the last
     * wind-off started where this one ends, the two are one continuous stretch
     * and are drawn as one.
     */
    const run = [...path];
    const held = recoilRun[strand];
    if (held.length > 0 && held[0] === run[run.length - 1]) run.push(...held.slice(1));
    recoilRun[strand] = run;

    let d = '';
    for (let i = 0; i < run.length; i++) {
      const [x, y] = board.posts[run[i]];
      d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    }
    node.setAttribute('d', d);
    node.classList.remove('go');
    // Measuring the path is what makes the dash exactly its own length, so the
    // recoil ends at the new head rather than somewhere near it; reading it
    // also restarts the animation rather than letting the removal and the
    // addition collapse into one frame with no change.
    const len = node.getTotalLength();
    node.style.setProperty('--len', String(len));
    node.setAttribute('stroke-dasharray', String(len));
    node.classList.add('go');
  }

  /*
   * A refused reach. The posts already on the string pulse, from the loose end
   * backwards, so the answer names the string it is about rather than being a
   * general flash of red — and the stagger makes it read as a run down the
   * string instead of everything blinking at once.
   */
  let refusing = 0;
  /*
   * Which posts are wearing the pulse right now. Clearing "the path we were
   * just given" is not the same thing: a second refusal on a shorter string
   * cancels the first one's timer, and every post the first one marked and the
   * second one did not would keep its red for good.
   */
  let refusedNow: readonly number[] = [];

  function clearRefused(): void {
    for (const p of refusedNow) {
      postEl[p]?.classList.remove('refused');
      glowEl[p]?.classList.remove('refused');
    }
    refusedNow = [];
  }

  function refuse(path: readonly number[]): void {
    clearRefused();
    for (let i = 0; i < path.length; i++) {
      const step = String(path.length - 1 - i);
      for (const node of [postEl[path[i]], glowEl[path[i]]]) {
        if (!node) continue;
        node.style.setProperty('--step', step);
        // Reading a layout property restarts the animation rather than letting
        // the removal and the addition collapse into one frame with no change.
        void node.getBoundingClientRect();
        node.classList.add('refused');
      }
    }
    refusedNow = [...path];
    clearTimeout(refusing);
    refusing = window.setTimeout(clearRefused, 900);
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
    clearTimeout(refusing);
    clearRefused();
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
      /*
       * The colour goes on as a custom property, not as a fill attribute.
       * `.post` sets its fill in the stylesheet, and any rule beats a
       * presentation attribute — so the attribute version had been quietly
       * doing nothing since it was written. On a Classic board, with one
       * string, nobody noticed. On a lattice with twelve pairs it is the whole
       * puzzle: the ends are the only instruction there is, and if they are
       * all the same dark dot with a pale ring there is nothing to read.
       */
      postEl[p].style.setProperty('--ink', s.color);
      postEl[p].classList.add('end');
      ringEl[p].style.setProperty('--ink', s.color);
      ringEl[p].classList.add('pinned');
    }
  }

  const buf: string[] = [];
  const EMPTY: readonly number[] = [];

  /*
   * One drawn path per strand, made once when the board is mounted.
   *
   * There is exactly one string per colour and there always was one to draw,
   * so nothing here is created, moved or replaced while the board is being
   * played: a drag sets a handful of `d` attributes and touches nothing else.
   */
  function update(paths: Paths, verdict: Verdict): void {
    for (let s = 0; s < strandEl.length; s++) {
      const path = paths[s] ?? EMPTY;
      if (path.length === 0) { strandEl[s].setAttribute('d', ''); continue; }
      buf.length = 0;
      for (let k = 0; k < path.length; k++) {
        const [x, y] = board.posts[path[k]];
        buf.push(`${k === 0 ? 'M' : 'L'}${x} ${y}`);
      }
      // A single post is a stub of string on the nail, not an empty path: it
      // shows the string has been started.
      strandEl[s].setAttribute('d', path.length === 1 ? `${buf[0]}l0 0` : buf.join(''));
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

  function setLead(strand: number, post: number, x: number, y: number, reach: boolean): void {
    const a = board.posts[post];
    if (!a) return;
    lead.setAttribute('d', `M${a[0]} ${a[1]}L${x.toFixed(2)} ${y.toFixed(2)}`);
    lead.setAttribute('stroke', board.strands[strand]?.color ?? '#888');
    lead.classList.toggle('out-of-reach', !reach);
    lead.setAttribute('opacity', '1');
  }

  /*
   * A hint's focus. The same swelling ring the refusal uses, in the ink colour
   * rather than the bad one and left standing rather than thrown — one visual
   * idea doing two jobs, which is how a board stays legible.
   */
  let spotlit: readonly number[] = [];
  function spotlight(posts: readonly number[]): void {
    for (const p of spotlit) postEl[p]?.classList.remove('lookhere');
    spotlit = posts;
    for (const p of posts) postEl[p]?.classList.add('lookhere');
  }

  function clearLead(): void {
    lead.setAttribute('opacity', '0');
  }

  function at(clientX: number, clientY: number): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    const side = Math.min(r.width, r.height);
    const ox = r.left + (r.width - side) / 2;
    const oy = r.top + (r.height - side) / 2;
    return {
      x: view.x + ((clientX - ox) / side) * view.side,
      y: view.y + ((clientY - oy) / side) * view.side,
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
  return {
    el, update, at, nearestPost, flashPost, markCursor, celebrate,
    retract, refuse, spotlight, setLead, clearLead, dispose,
  };
}
