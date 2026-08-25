/**
 * Playing a board.
 *
 * Press a coloured end and drag. The string follows your thumb from post to
 * post; drag back over the last post to take it back. If you run into string
 * that belongs to someone else, you take the post off them — being made to
 * tidy up first is the kind of friction that makes a puzzle feel like admin.
 *
 * The rule is checked on every change rather than at the end. A string that is
 * already touching another will still be touching it when you let go, and the
 * end is the worst possible moment to find that out.
 */

import { h } from './dom.js';
import { mountBoard } from './render.js';
import { compile, runBetween, type Board } from '../core/board.js';
import { judge, firstFault } from '../core/check.js';
import * as haptics from '../render/haptics.js';

/** How close a thumb has to get to a post to catch it, in board units. */
const GRAB = 7.5;

export type PlayHooks = {
  onSolved(): void;
  onNext(): void;
  onBack(): void;
  /** 1-based position in its mode, and how many there are. */
  readonly place: { index: number; total: number };
  readonly done: boolean;
};

export function playScreen(board: Board, hooks: PlayHooks): { el: HTMLElement; dispose(): void } {
  const c = compile(board);
  const view = mountBoard(c);

  let paths: number[][] = board.strands.map(() => []);
  const history: number[][][] = [];
  let dragging = -1;
  let solved = false;

  const count = h('span', { class: 'count' });
  const note = h('span', { class: 'note' });
  const hud = h('div', { class: 'hud' }, count, note);

  const undoBtn = h('button', { class: 'btn', text: 'Undo', onclick: undo });
  const clearBtn = h('button', { class: 'btn', text: 'Clear', onclick: clearAll });
  const nextBtn = h('button', { class: 'btn primary', text: 'Next', onclick: () => hooks.onNext() });
  nextBtn.hidden = true;
  const bar = h('div', { class: 'bar' }, undoBtn, clearBtn, nextBtn);

  const wrap = h('div', { class: 'boardwrap' }, view.el);
  const el = h('div', { class: 'screen play' },
    h('header', { class: 'top' },
      h('button', { class: 'back', 'aria-label': 'Back', onclick: () => hooks.onBack() }, backArrow()),
      h('span', { class: 'where', text: `${hooks.place.index} of ${hooks.place.total}` }),
      h('span', { class: 'spacer' }),
    ),
    hud, wrap, bar,
  );

  // --- state ---------------------------------------------------------------

  function snapshot(): void {
    history.push(paths.map((p) => p.slice()));
    if (history.length > 60) history.shift();
  }

  function repaint(partial: boolean): void {
    /*
     * A board nobody has touched is judged as work in progress, not as a wrong
     * answer. Otherwise the first thing a player is told, before they have
     * done anything at all, is that they have broken a rule.
     */
    const laid = paths.some((p) => p.length > 1);
    const v = judge(c, paths, partial || !laid);
    view.update(paths, v);
    const used = Math.round(v.progress * c.n);
    count.textContent = `${used} of ${c.n} posts`;
    // On an untouched board the line says how to start rather than sitting
    // empty: the coloured posts are the instruction, and this names them.
    note.textContent = laid ? (v.solved ? '' : firstFault(v)) : 'Drag from a coloured post';
    note.classList.toggle('bad', v.faults.length > 0);
    if (v.solved && !solved) {
      solved = true;
      haptics.win();
      note.textContent = 'Solved';
      note.classList.remove('bad');
      nextBtn.hidden = false;
      el.classList.add('won');
      hooks.onSolved();
    } else if (!v.solved) {
      solved = false;
      nextBtn.hidden = hooks.done ? false : true;
      el.classList.remove('won');
    }
  }

  function undo(): void {
    const prev = history.pop();
    if (!prev) return;
    paths = prev;
    haptics.tick();
    repaint(false);
  }

  function clearAll(): void {
    snapshot();
    paths = board.strands.map(() => []);
    haptics.tick();
    repaint(false);
  }

  /** Which strand owns this post right now, and where on its path. */
  function ownerOf(post: number): { strand: number; at: number } | null {
    for (let s = 0; s < paths.length; s++) {
      const i = paths[s].indexOf(post);
      if (i >= 0) return { strand: s, at: i };
    }
    return null;
  }

  /** Take a post off whoever holds it, cutting their string back to before it. */
  function steal(post: number, from: number): void {
    for (let s = 0; s < paths.length; s++) {
      if (s === from) continue;
      const i = paths[s].indexOf(post);
      if (i >= 0) paths[s].length = i;
    }
  }

  // --- pointer -------------------------------------------------------------

  function begin(post: number): boolean {
    const owner = ownerOf(post);
    if (owner) {
      // Grabbing a post mid-string picks the string up from there.
      snapshot();
      dragging = owner.strand;
      paths[owner.strand].length = owner.at + 1;
      return true;
    }
    for (let s = 0; s < board.strands.length; s++) {
      const spec = board.strands[s];
      if (spec.from !== post && spec.to !== post) continue;
      snapshot();
      dragging = s;
      paths[s] = [post];
      return true;
    }
    return false;
  }

  function extend(post: number): void {
    const path = paths[dragging];
    const head = path[path.length - 1];
    if (post === head) return;

    if (path.length >= 2 && post === path[path.length - 2]) {
      path.pop();
      haptics.notch();
      repaint(true);
      return;
    }
    if (runBetween(c, head, post) < 0) return;
    if (path.includes(post)) return;

    steal(post, dragging);
    path.push(post);
    haptics.tick();
    repaint(true);
  }

  const onDown = (e: PointerEvent) => {
    if (solved) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB);
    if (post < 0) return;
    if (!begin(post)) return;
    view.el.setPointerCapture(e.pointerId);
    e.preventDefault();
    repaint(true);
  };

  const onMove = (e: PointerEvent) => {
    if (dragging < 0) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB);
    if (post >= 0) extend(post);
    e.preventDefault();
  };

  const onUp = () => {
    if (dragging < 0) return;
    dragging = -1;
    repaint(false);
  };

  view.el.addEventListener('pointerdown', onDown);
  view.el.addEventListener('pointermove', onMove);
  view.el.addEventListener('pointerup', onUp);
  view.el.addEventListener('pointercancel', onUp);

  // --- keyboard ------------------------------------------------------------
  /*
   * The whole game without a pointer: arrows move a cursor to the nearest post
   * in that direction, Enter lays string to it, Backspace takes one back.
   */
  let cursor = board.strands[0]?.from >= 0 ? board.strands[0].from : 0;
  let keyStrand = 0;
  view.el.tabIndex = 0;

  const nearestIn = (from: number, dx: number, dy: number): number => {
    const [ax, ay] = board.posts[from];
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < board.posts.length; i++) {
      if (i === from) continue;
      const vx = board.posts[i][0] - ax;
      const vy = board.posts[i][1] - ay;
      const along = vx * dx + vy * dy;
      if (along <= 0) continue;
      const off = Math.abs(vx * dy - vy * dx);
      const score = along + off * 2.5;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  };

  const onKey = (e: KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    if (dirs[e.key]) {
      const next = nearestIn(cursor, dirs[e.key][0], dirs[e.key][1]);
      if (next >= 0) { cursor = next; markCursor(); }
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const path = paths[keyStrand];
      if (path.length === 0) {
        const owner = ownerOf(cursor);
        if (owner) { keyStrand = owner.strand; dragging = owner.strand; }
        else if (!begin(cursor)) return;
        else keyStrand = dragging;
      } else {
        dragging = keyStrand;
        extend(cursor);
      }
      dragging = -1;
      repaint(false);
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace') {
      paths[keyStrand].pop();
      repaint(false);
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && board.strands.length > 1) {
      keyStrand = (keyStrand + 1) % board.strands.length;
      const start = board.strands[keyStrand].from;
      if (start >= 0) { cursor = start; markCursor(); }
      e.preventDefault();
    }
  };

  function markCursor(): void {
    view.el.querySelectorAll('.post.cursor').forEach((n) => n.classList.remove('cursor'));
    view.el.querySelectorAll('.post')[cursor]?.classList.add('cursor');
  }

  view.el.addEventListener('keydown', onKey);

  repaint(false);

  return {
    el,
    dispose() {
      view.el.removeEventListener('pointerdown', onDown);
      view.el.removeEventListener('pointermove', onMove);
      view.el.removeEventListener('pointerup', onUp);
      view.el.removeEventListener('pointercancel', onUp);
      view.el.removeEventListener('keydown', onKey);
    },
  };
}

function backArrow(): SVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '22');
  s.setAttribute('height', '22');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M15 4 L7 12 L15 20');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.4');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}
