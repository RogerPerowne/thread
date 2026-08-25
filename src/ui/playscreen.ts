/**
 * Playing a board.
 *
 * Press anywhere on a string — a post, or the string itself between two posts
 * — and drag. The string is picked up at that point and follows your thumb;
 * everything past where you grabbed waits, and joins back on the moment your
 * new route meets it again. Being made to redraw a string from its end because
 * you wanted to change its middle is the kind of friction that makes a puzzle
 * feel like admin.
 *
 * The rule is checked on every change rather than at the end. A string that is
 * already touching another will still be touching it when you let go, and the
 * end is the worst possible moment to find that out. A warning appears the
 * instant it is true and goes the instant it is not.
 *
 * Nothing here reflows. The line carrying the warning holds its height whether
 * or not it has anything in it, and Next holds its place from the start — a
 * board that jumps under your thumb because a word appeared is worse than the
 * word being missing.
 */

import { h } from './dom.js';
import { topBar, pill } from './components.js';
import { mountBoard } from './render.js';
import { compile, runBetween, segPointDist2, type Board } from '../core/board.js';
import { judge, firstFault } from '../core/check.js';
import * as haptics from '../render/haptics.js';

/** How close a thumb has to get to catch a post, in board units. */
const GRAB_POST = 7;
/** How close to catch the string itself, between posts. */
const GRAB_STRING = 5;

export type PlayHooks = {
  onSolved(): void;
  onNext(): void;
  onBack(): void;
  /** 1-based position in its mode, and how many there are. */
  readonly place: { index: number; total: number };
  /** Mode and chapter, for the top bar. */
  readonly chapter: string;
  readonly done: boolean;
};

export function playScreen(board: Board, hooks: PlayHooks): { el: HTMLElement; dispose(): void } {
  const c = compile(board);
  const view = mountBoard(c);

  let paths: number[][] = board.strands.map(() => []);
  const history: number[][][] = [];
  let dragging = -1;
  /** What was past the point we grabbed, waiting to be joined back on. */
  let tail: number[] = [];
  let solved = false;

  const meter = h('i');
  const count = h('span', { class: 'num' });
  const note = h('span', { class: 'ask' });
  const hud = h('div', { class: 'hud' },
    h('div', { class: 'chapter', text: `Level ${hooks.place.index}` }),
    h('div', { class: 'meta' }, count, h('span', { class: 'spool' }, meter)),
    note,
  );

  const surface = h('div', { class: 'boardsurface' }, view.el);
  const boardBox = h('div', { class: 'board' }, surface);

  const undoBtn = pill('Undo', undo);
  const clearBtn = pill('Clear', clearAll);
  const nextBtn = pill('Next', () => hooks.onNext(), 'primary');
  // Held in place from the start rather than added on the solve: a toolbar
  // that grows a button rewrites the width of the other two under your thumb.
  nextBtn.style.visibility = 'hidden';
  const bar = h('div', { class: 'toolbar' }, undoBtn, clearBtn, nextBtn);

  const el = h('div', { class: 'screen play' },
    topBar(hooks.chapter, { onBack: () => hooks.onBack() }),
    h('div', { class: 'playwrap' }, hud, boardBox, bar),
  );

  // --- state ---------------------------------------------------------------

  function snapshot(): void {
    history.push(paths.map((p) => p.slice()));
    if (history.length > 80) history.shift();
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
    meter.style.width = `${Math.round(v.progress * 100)}%`;

    const fault = laid ? firstFault(v) : '';
    note.textContent = v.solved ? 'Solved' : (fault || (laid ? '' : 'Drag from a coloured post'));
    note.classList.toggle('bad', !v.solved && fault !== '');
    note.classList.toggle('good', v.solved);

    if (v.solved && !solved) {
      solved = true;
      haptics.win();
      nextBtn.style.visibility = 'visible';
      el.classList.add('won');
      view.celebrate();
      hooks.onSolved();
    } else if (!v.solved && solved) {
      solved = false;
      nextBtn.style.visibility = hooks.done ? 'visible' : 'hidden';
      el.classList.remove('won');
    }
  }

  function undo(): void {
    const prev = history.pop();
    if (!prev) return;
    paths = prev;
    tail = [];
    haptics.tick();
    repaint(false);
  }

  function clearAll(): void {
    snapshot();
    paths = board.strands.map(() => []);
    tail = [];
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

  /**
   * The string nearest this point, if any: which strand, and which post along
   * it your thumb is on. Grabbing between two posts picks the nearer of the
   * two, so pulling a straight out sideways starts from the right end.
   */
  function stringAt(x: number, y: number): { strand: number; at: number } | null {
    let best: { strand: number; at: number } | null = null;
    let bestD = GRAB_STRING * GRAB_STRING;
    for (let s = 0; s < paths.length; s++) {
      const path = paths[s];
      for (let i = 0; i + 1 < path.length; i++) {
        const a = board.posts[path[i]];
        const b = board.posts[path[i + 1]];
        const d = segPointDist2(a, b, [x, y]);
        if (d >= bestD) continue;
        bestD = d;
        const da = (a[0] - x) ** 2 + (a[1] - y) ** 2;
        const db = (b[0] - x) ** 2 + (b[1] - y) ** 2;
        best = { strand: s, at: da <= db ? i : i + 1 };
      }
    }
    return best;
  }

  /** Pick the string up at `at`, keeping what is past it waiting to rejoin. */
  function pickUp(strand: number, at: number): void {
    snapshot();
    dragging = strand;
    tail = paths[strand].slice(at + 1);
    paths[strand].length = at + 1;
  }

  function begin(post: number): boolean {
    const owner = ownerOf(post);
    if (owner) { pickUp(owner.strand, owner.at); return true; }
    for (let s = 0; s < board.strands.length; s++) {
      const spec = board.strands[s];
      if (spec.from !== post && spec.to !== post) continue;
      snapshot();
      dragging = s;
      tail = paths[s].slice(1);
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
      /*
       * Dragging back over the last post takes it off, and it stays off. It
       * does not join the waiting tail: the tail is the part of the string you
       * have not got back to yet, while this is a post you have just decided
       * against — putting it in the tail would have the string quietly put it
       * back the moment you let go.
       */
      path.pop();
      haptics.notch();
      repaint(true);
      return;
    }
    if (runBetween(c, head, post) < 0) return;

    // Meeting the waiting tail again joins the string back up.
    const inTail = tail.indexOf(post);
    if (inTail >= 0) {
      path.push(...tail.slice(inTail));
      tail = [];
      view.flashPost(post);
      haptics.tie();
      repaint(true);
      return;
    }
    if (path.includes(post)) return;

    steal(post, dragging);
    path.push(post);
    view.flashPost(post);
    haptics.tick();
    repaint(true);
  }

  /**
   * On letting go, join the waiting tail back on rather than dropping it.
   * Keeping as much of it as possible is the whole point of being able to grab
   * a string in the middle.
   */
  function reconnect(): void {
    if (dragging < 0 || tail.length === 0) { tail = []; return; }
    const path = paths[dragging];
    const head = path[path.length - 1];
    for (let i = 0; i < tail.length; i++) {
      if (path.includes(tail[i])) continue;
      if (runBetween(c, head, tail[i]) < 0) continue;
      path.push(...tail.slice(i).filter((p) => !path.includes(p)));
      break;
    }
    tail = [];
  }

  // --- pointer -------------------------------------------------------------

  const onDown = (e: PointerEvent) => {
    if (solved) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB_POST);
    if (post >= 0) {
      if (!begin(post)) return;
    } else {
      const grab = stringAt(p.x, p.y);
      if (!grab) return;
      pickUp(grab.strand, grab.at);
    }
    view.el.setPointerCapture(e.pointerId);
    e.preventDefault();
    repaint(true);
  };

  const onMove = (e: PointerEvent) => {
    if (dragging < 0) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB_POST);
    if (post >= 0) extend(post);
    e.preventDefault();
  };

  const onUp = () => {
    if (dragging < 0) return;
    reconnect();
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
      if (next >= 0) { cursor = next; view.markCursor(cursor); }
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const path = paths[keyStrand];
      if (path.length === 0) {
        const owner = ownerOf(cursor);
        if (owner) { keyStrand = owner.strand; pickUp(owner.strand, owner.at); }
        else if (!begin(cursor)) return;
        else keyStrand = dragging;
      } else {
        dragging = keyStrand;
        extend(cursor);
      }
      reconnect();
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
      if (start >= 0) { cursor = start; view.markCursor(cursor); }
      e.preventDefault();
    }
  };

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
      view.dispose();
    },
  };
}
