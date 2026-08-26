/**
 * Playing a board.
 *
 * WHAT GOOD CONTROLS ARE, FOR THIS GAME
 *
 * The player's whole job is to put the posts in an order. Everything below
 * follows from taking that seriously, and from one further observation: the
 * thing that makes a puzzle game hard to put down is not that the input is
 * clever, it is that the input is never in the way. Every rule here is chosen
 * so that being wrong costs nothing.
 *
 *   1. ONE VERB. Point at a post. That is the entire input. Tapping a post and
 *      sweeping a thumb through it do exactly the same thing, so there is no
 *      mode to be in and nothing that has to be learned twice.
 *
 *   2. TAP AND DRAG ARE BOTH FIRST CLASS. Dragging is fast, and it is also a
 *      hand held over the board you are trying to read, and a thirty-post
 *      board is a long thing to hold. Tapping is precise, keeps the board
 *      visible, and can be put down mid-solve. A player should be able to
 *      switch between them in the middle of a string without thinking about
 *      it, and here they can, because of rule 1.
 *
 *   3. WHAT YOU SEE IS THE WHOLE STATE. Nothing is held back, remembered, or
 *      restored later. An earlier version kept the part of the string past
 *      where you grabbed in a hidden tail and rejoined it when you let go; it
 *      was clever and it was the direct cause of a bug where a warning could
 *      not be cleared, because taking the bad run off and letting go put it
 *      straight back. Predictable beats clever.
 *
 *   4. LIFTING YOUR FINGER IS A PAUSE, NEVER A DECISION. It does not commit
 *      and it does not discard. The next touch carries on from where the
 *      string ends.
 *
 *   5. GOING BACK IS THE SAME GESTURE AS GOING FORWARD. Point at a post that
 *      is already on the string and the string ends there again. One post back
 *      or six, tapped or dragged. Correcting a mistake should cost what making
 *      it cost — never a careful reverse over every post in turn.
 *
 *   6. A REFUSED MOVE CHANGES NOTHING, AND SAYS SO. You are never left undoing
 *      something that did not happen. But silence is not an option either:
 *      nothing happening is exactly what a missed touch looks like, so the
 *      string glows.
 *
 *   7. NOTHING IS EVER LOST TO A MIS-TOUCH. Pressing the board and letting go
 *      without moving changes nothing. Every gesture is one Undo.
 *
 *   8. THE ANSWER IS INSTANT AND SPECIFIC. The post you catch pulses, the
 *      string you cannot extend glows, the stretch you take off is drawn
 *      coming off. All of it CSS, so none of it costs a frame of the drag.
 *
 *   9. THE BOARD NEVER MOVES. No scroll, no zoom, no reflow. The line carrying
 *      the warning holds its height whether or not it has anything in it, and
 *      Next holds its place from the start.
 *
 * WHAT TURNS RED
 *
 * A warning means a rule BROKEN — a post used twice, two strings lying on each
 * other. How much is left to do is not a warning and is never shown as one: it
 * is true from the first move to the last, so a red line saying it would be on
 * for the whole game, and one that is always on is one nobody can read.
 */

import { h } from './dom.js';
import { topBar, pill } from './components.js';
import { mountBoard } from './render.js';
import {
  compile, runBetween, segPointDist2, POST_R, grabRadius, type Board,
} from '../core/board.js';
import { judge, firstBreak, whatIsLeft } from '../core/check.js';
import * as haptics from '../render/haptics.js';

/** How close to catch the string itself, between posts, as a share of the
 * reach for a post — so it scales with the board like the reach does. */
const GRAB_STRING = 0.72;

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
  /** This board's thumb reach: see `grabRadius`. */
  const GRAB_POST = grabRadius(board);
  const GRAB_LINE = GRAB_POST * GRAB_STRING;

  let paths: number[][] = board.strands.map(() => []);
  const history: number[][][] = [];
  /*
   * The strand being worked on. It follows the player rather than being
   * chosen: point at a string, or at one of its pinned ends, and that is the
   * one you are holding. On a Classic board there is only ever one.
   */
  let active = 0;
  /** Is a press in progress? */
  let holding = false;
  /** Where the thumb was at the last sample, so the gap can be walked. */
  let lastAt: { x: number; y: number } | null = null;
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

    /*
     * Red is for something that is WRONG, and nothing else. "Posts left over"
     * and "ends not joined" are true from the moment a board opens until the
     * moment it is solved, so showing them as warnings put the board in red for
     * the whole game — and a warning that never goes cannot be acted on, or
     * even noticed. They are said quietly, as what is left to do, and the line
     * turns red only for a rule the player has actually broken.
     */
    const broken = laid ? firstBreak(v) : '';
    const left = laid ? whatIsLeft(v) : 'Drag from a coloured post';
    note.textContent = v.solved ? 'Solved' : (broken || left);
    note.classList.toggle('bad', !v.solved && broken !== '');
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

  /**
   * The string nearest this point, if any: which strand, and which post along
   * it your thumb is on. Grabbing between two posts picks the nearer of the
   * two, so pulling a straight out sideways starts from the right end.
   */
  function stringAt(x: number, y: number): { strand: number; at: number } | null {
    let best: { strand: number; at: number } | null = null;
    let bestD = GRAB_LINE * GRAB_LINE;
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

  /** Can this strand begin at this post? A pinned strand may start at either
   * of its own two ends; an unpinned one may start anywhere. */
  function canStart(strand: number, post: number): boolean {
    const spec = board.strands[strand];
    if (!spec) return false;
    return spec.from < 0 ? true : post === spec.from || post === spec.to;
  }

  /** The strand this post is a pinned end of, or -1. */
  function pinnedOwner(post: number): number {
    for (let s = 0; s < board.strands.length; s++) {
      const spec = board.strands[s];
      if (spec.from === post || spec.to === post) return s;
    }
    return -1;
  }

  /*
   * Where the pointer picked the string up, on the strand it is editing.
   *
   * Nothing is removed at that moment: press on the middle of a string and let
   * go again and the board is exactly as it was. The cut happens when you
   * actually go somewhere else, which is the point at which you have said what
   * you want. Holding the removal back like this is what makes a press
   * harmless, and a harmless press is what lets a player poke at the board
   * without fear — which is most of what makes one of these addictive.
   */
  let cutFrom: number | null = null;
  /** Has this gesture changed the board? Drives undo, and tap-to-wind-back. */
  let changed = false;
  /** One undo step per gesture, taken before the first change it makes. */
  let snapped = false;

  function touch(): void {
    if (!snapped) { snapshot(); snapped = true; }
    changed = true;
  }

  /*
   * The post the last refusal was about. Saying it again on every pointer
   * sample while the thumb rests there would be a strobe, not an answer.
   */
  let refused = -1;

  function refuse(post: number): void {
    if (post === refused) return;
    refused = post;
    view.refuse(paths[active]);
    haptics.bump();
  }

  /**
   * Point at a post. This is the whole game's input.
   *
   * A tap calls it once; a drag calls it for every post the thumb crosses.
   * There is no second verb and no mode — which is why the two can be mixed
   * freely, mid-solve, without the player having to decide which one they are
   * doing.
   */
  function reach(post: number): void {
    // A pinned end belongs to its own string. Pointing at one means "this
    // string now", not "run the string I am holding into someone else's end".
    const pin = pinnedOwner(post);
    if (pin >= 0 && pin !== active && !paths[active].includes(post)) active = pin;

    const path = paths[active];

    if (path.length === 0) {
      if (!canStart(active, post)) { refuse(post); return; }
      touch();
      path.push(post);
      cutFrom = null;
      refused = -1;
      view.flashPost(post);
      haptics.tick();
      repaint(true);
      return;
    }

    /*
     * Already on this string: wind back to it, however far back it is. Going
     * forward and going back are the same gesture, so undoing a mistake costs
     * exactly what making it cost — no reversing over five posts in turn and
     * landing inside every one of them.
     */
    const at = path.indexOf(post);
    if (at >= 0) {
      cutFrom = at;
      if (at === path.length - 1) return;
      touch();
      // The post it now ends at goes first, so the recoil runs outwards from
      // there: string pulled back in, rather than a line that stops existing.
      view.retract(active, path.slice(at));
      path.length = at + 1;
      refused = -1;
      haptics.notch();
      repaint(true);
      return;
    }

    const from = cutFrom ?? path.length - 1;
    if (runBetween(c, path[from], post) < 0) { refuse(post); return; }

    touch();
    if (from < path.length - 1) {
      view.retract(active, path.slice(from));
      path.length = from + 1;
    }
    cutFrom = null;
    steal(post, active);
    path.push(post);
    refused = -1;
    view.flashPost(post);
    haptics.tick();
    repaint(true);
  }

  /**
   * Every post the thumb passed through since the last sample, in order.
   *
   * A pointer sample is wherever the finger happened to be when the browser
   * looked. On a phone those are tens of pixels apart and a post is worth
   * about thirty, so a quick sweep across three posts could arrive as one move
   * that began on the first and ended past the third — and the two in between
   * simply never happened. Walking the line between two samples is what makes
   * a fast drag mean the same thing as a slow one.
   */
  function sweep(to: { x: number; y: number }): void {
    const from = lastAt ?? to;
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    // A step of half a post cannot skip one, and the cap keeps a wild jump
    // from costing a frame.
    const steps = Math.min(96, Math.max(1, Math.ceil(span / POST_R)));
    let seen = -1;
    for (let i = 1; i <= steps && holding; i++) {
      const k = i / steps;
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      const post = view.nearestPost(x, y, GRAB_POST);
      if (post < 0) { seen = -1; continue; }
      if (post === seen) continue;
      seen = post;
      reach(post);
    }
  }

  // --- pointer -------------------------------------------------------------

  const onDown = (e: PointerEvent) => {
    if (solved) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB_POST);

    holding = true;
    changed = false;
    snapped = false;
    refused = -1;
    cutFrom = null;

    if (post >= 0) {
      const owner = ownerOf(post);
      if (owner) {
        // Picking the string up. Nothing is taken off until you go somewhere.
        active = owner.strand;
        cutFrom = owner.at;
      } else {
        reach(post);
        if (!changed) { holding = false; return; }
      }
    } else {
      const grab = stringAt(p.x, p.y);
      if (!grab) { holding = false; return; }
      active = grab.strand;
      cutFrom = grab.at;
    }

    lastAt = p;
    view.el.setPointerCapture(e.pointerId);
    e.preventDefault();
    repaint(true);
  };

  const onMove = (e: PointerEvent) => {
    if (!holding) return;
    /*
     * Take every position the browser has for this move, not just the latest.
     * A phone coalesces pointer moves — several real positions arrive as one
     * event — and the ones it folded away are exactly the ones between two
     * posts. Asking for them back is the difference between a string that
     * follows your finger and one that follows where your finger stopped.
     */
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const sample of samples.length > 0 ? samples : [e]) {
      const p = view.at(sample.clientX, sample.clientY);
      sweep(p);
      lastAt = p;
    }

    // Whatever happened, the loose end goes where the thumb is.
    const p = lastAt ?? view.at(e.clientX, e.clientY);
    const path = paths[active];
    const head = path[cutFrom ?? path.length - 1];
    if (head !== undefined) {
      const near = view.nearestPost(p.x, p.y, GRAB_POST * 1.6);
      if (near >= 0 && near !== head && !path.includes(near)
        && runBetween(c, head, near) < 0) refuse(near);
      else if (near < 0 || near === head || path.includes(near)) refused = -1;
      const canReach = near < 0 || near === head || path.includes(near)
        || runBetween(c, head, near) >= 0;
      view.setLead(active, head, p.x, p.y, canReach);
    }
    e.preventDefault();
  };

  const onUp = () => {
    if (!holding) return;
    /*
     * A press that never went anywhere is a tap. On a post already on the
     * string that means "put the end back here" — which is the only way to
     * wind back without dragging, and so the thing that makes the game
     * playable by tapping alone.
     */
    if (!changed && cutFrom !== null) {
      const path = paths[active];
      if (cutFrom < path.length - 1) {
        touch();
        view.retract(active, path.slice(cutFrom));
        path.length = cutFrom + 1;
        haptics.notch();
      }
    }
    holding = false;
    cutFrom = null;
    lastAt = null;
    refused = -1;
    view.clearLead();
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
      // The same verb the thumb uses, so the keyboard is not a second game.
      reach(cursor);
      repaint(false);
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace') {
      const path = paths[active];
      if (path.length > 0) {
        snapshot();
        view.retract(active, path.slice(path.length - 2));
        path.pop();
      }
      repaint(false);
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && board.strands.length > 1) {
      active = (active + 1) % board.strands.length;
      const start = board.strands[active].from;
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
