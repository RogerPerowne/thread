/**
 * Thread's board, and how it is played.
 *
 * The screen around this — bar, clock, controls, result — belongs to the
 * platform. What is here is the board and the thumb, and nothing else.
 *
 * THE CONTROLS, written down because the rest follows from them.
 *
 *   1. One verb. Point at a post. That is the entire input.
 *   2. Tap and drag are both first class and can be mixed mid-string, because
 *      of 1. Dragging is fast; it is also a hand held over the board.
 *   3. One string per colour, always. Pointing at a post a string already
 *      passes through ends that string there — so going back is the same
 *      gesture as going forward, and there is never a loose second piece of
 *      one colour to keep track of.
 *   4. A string starts at one of its own two pinned ends and grows from its
 *      loose end. It is finished when the loose end arrives at the other pin.
 *   5. Lifting your finger is a pause, never a decision.
 *   6. A refused move changes nothing, and says so.
 *   7. Nothing is lost to a mis-touch. Every gesture is one Undo.
 *   8. Feedback is instant, specific, and free: CSS, never a frame of the drag.
 *   9. The board never moves.
 */

import { mountBoard } from './render.js';
import {
  runBetween, segPointDist2, POST_R, grabRadius,
} from './board.js';
import type { ThreadSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/** How close to catch the string itself, between posts, as a share of the
 * reach for a post — so it scales with the board like the reach does. */
const GRAB_STRING = 0.72;

export function mountThread(
  root: HTMLElement, session: ThreadSession, host: ViewHost,
): View {
  const board = session.board;
  const c = session.c;
  const view = mountBoard(c);
  /** This board's thumb reach: see `grabRadius`. */
  const GRAB_POST = grabRadius(board);
  const GRAB_LINE = GRAB_POST * GRAB_STRING;

  let paths = session.paths;
  /** The strand being worked on. Every move is about exactly one of them. */
  let active = -1;
  /** Is a press in progress? */
  let holding = false;
  /** Where the thumb was at the last sample, so the gap can be walked. */
  let lastAt: { x: number; y: number } | null = null;
  /*
   * The post the thumb last did something at, for as long as it is down.
   *
   * Not per pointer event — per gesture. A thumb that arrives at a post and
   * stays there keeps being sampled there, and every one of those samples
   * would otherwise be a fresh instruction.
   */
  let lastPost = -1;
  /*
   * The post the last refusal was about. Saying it again on every pointer
   * sample while the thumb rests there would be a strobe, not an answer.
   */
  let refused = -1;

  const boardBox = document.createElement('div');
  boardBox.className = 'gameboard thread-board';
  boardBox.style.setProperty('--board-ratio', String(view.ratio));
  boardBox.appendChild(view.el);
  root.appendChild(boardBox);

  // --- the state of one string ---------------------------------------------

  /** The loose end of a strand's string, or -1 if it has not been started. */
  const headOf = (s: number): number => {
    const path = paths[s];
    return path.length === 0 ? -1 : path[path.length - 1];
  };

  /** A finished string ends on its far pin, and may not grow any further. */
  const isDone = (s: number): boolean =>
    paths[s].length > 1 && headOf(s) === session.target(s);

  /** Can this strand's loose end reach that post? */
  const canReach = (s: number, post: number): boolean => {
    const head = headOf(s);
    if (head < 0 || head === post || isDone(s)) return false;
    if (paths[s].includes(post)) return false;
    return runBetween(c, head, post) >= 0;
  };

  /**
   * Repaint, and tell the frame.
   *
   * The board redraws itself from the strings and the verdict; the frame reads
   * the same verdict for its note, its meter and its controls. One judgement
   * per change, read twice, so the two can never disagree.
   */
  function paint(): void {
    paths = session.paths;
    view.update(paths, session.raw());
    host.changed();
  }

  function refuse(post: number): void {
    if (post === refused) return;
    refused = post;
    view.refuse(active >= 0 ? paths[active] : []);
    host.buzz('bump');
  }

  // --- the three things that can happen to a string -------------------------

  /** End a strand's string at the post sitting at `at` along it. */
  function cutBackTo(strand: number, at: number): void {
    const path = paths[strand];
    if (at < 0 || at >= path.length - 1) return;
    session.mark();
    view.retract(strand, path.slice(at));
    path.length = at + 1;
    refused = -1;
    host.buzz('notch');
    paint();
  }

  /** Lay one more run, from the loose end to `post`. */
  function extend(strand: number, post: number): void {
    session.mark();
    paths[strand].push(post);
    refused = -1;
    view.flashPost(post);
    host.buzz(post === session.target(strand) ? 'tie' : 'tick');
    paint();
  }

  /** Begin a strand's string at one of its pinned ends. */
  function startAt(strand: number, post: number): void {
    session.mark();
    paths[strand] = [post];
    refused = -1;
    view.flashPost(post);
    host.buzz('tick');
    paint();
  }

  /**
   * Point at a post. This is the whole game's input.
   *
   * A tap calls it once; a drag calls it for every post the thumb crosses.
   * There is no second verb and no mode, which is why the two can be mixed
   * freely, mid-string, without the player having to decide which they are
   * doing — or, for that matter, whether they are starting again or changing
   * a bit. Those are the same move: end the string here, carry on from there.
   */
  function reach(post: number): void {
    const owner = session.strandAt(post);
    const pin = session.pinAt(post);

    // On the string we are drawing: wind it back to here.
    if (owner >= 0 && owner === active) {
      cutBackTo(owner, paths[owner].indexOf(post));
      return;
    }

    /*
     * Somebody else's string, and our own loose end can reach it: take the
     * post off them and carry on. This is how a route is fixed without having
     * to unpick the string that is in the way first — the other string ends
     * where ours took over, which is exactly what happened to it.
     */
    if (owner >= 0 && active >= 0 && !isDone(active) && canReach(active, post)) {
      const at = paths[owner].indexOf(post);
      session.mark();
      if (at > 0) view.retract(owner, paths[owner].slice(at - 1));
      paths[owner].length = Math.max(0, at);
      extend(active, post);
      return;
    }

    // Somebody else's string, out of reach: that string becomes the one we are
    // working on. Nothing is changed until the next thing pointed at.
    if (owner >= 0) {
      active = owner;
      refused = -1;
      paint();
      return;
    }

    /*
     * A pinned end belongs to its own string and to no other. Pointing at one
     * means "this string now" — never "run the string I am holding into
     * somebody else's end".
     */
    if (pin >= 0 && pin !== active) {
      active = pin;
      if (paths[pin].length === 0) startAt(pin, post);
      else paint();
      return;
    }

    if (active >= 0 && canReach(active, post)) { extend(active, post); return; }

    // Our own far pin, arrived at from an impossible angle, or a bare post
    // with nothing that can reach it.
    if (pin >= 0 && paths[pin].length === 0) { active = pin; startAt(pin, post); return; }
    refuse(post);
  }

  /**
   * The point along a string nearest this one, as an index into its path.
   *
   * Grabbing between two posts picks the nearer of the two, so pulling a
   * straight run out sideways ends the string at the right end of it.
   */
  function stringAt(x: number, y: number): { strand: number; at: number } | null {
    let best: { strand: number; at: number } | null = null;
    let bestD = GRAB_LINE * GRAB_LINE;
    for (let s = 0; s < paths.length; s++) {
      const path = paths[s];
      for (let k = 0; k + 1 < path.length; k++) {
        const a = board.posts[path[k]];
        const b = board.posts[path[k + 1]];
        const d = segPointDist2(a, b, [x, y]);
        if (d >= bestD) continue;
        bestD = d;
        const da = (a[0] - x) ** 2 + (a[1] - y) ** 2;
        const db = (b[0] - x) ** 2 + (b[1] - y) ** 2;
        best = { strand: s, at: da <= db ? k : k + 1 };
      }
    }
    return best;
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
    for (let i = 1; i <= steps && holding; i++) {
      const k = i / steps;
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      const post = view.nearestPost(x, y, GRAB_POST);
      if (post < 0 || post === lastPost) continue;
      lastPost = post;
      reach(post);
    }
  }

  // --- pointer -------------------------------------------------------------

  const onDown = (e: PointerEvent) => {
    if (session.verdict().solved) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB_POST);

    holding = true;
    lastPost = post;
    session.openGesture();
    refused = -1;

    if (post >= 0) reach(post);
    else {
      /*
       * Not on a post: the string itself may still have been grabbed, between
       * two of them. That ends it at the nearer post, which is the same rule
       * as pointing at that post — pressing the middle of a run and pulling it
       * out sideways is how a route is reworked without aiming at a nail.
       */
      const grab = stringAt(p.x, p.y);
      if (!grab) { holding = false; return; }
      active = grab.strand;
      lastPost = paths[grab.strand][grab.at];
      cutBackTo(grab.strand, grab.at);
    }

    lastAt = p;
    view.el.setPointerCapture(e.pointerId);
    e.preventDefault();
    paint();
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
    const head = active >= 0 ? headOf(active) : -1;
    if (head >= 0 && !isDone(active)) {
      const near = view.nearestPost(p.x, p.y, GRAB_POST * 1.6);
      const reachable = near < 0 || near === head || paths[active].includes(near)
        || runBetween(c, head, near) >= 0;
      if (!reachable) refuse(near);
      else if (near < 0 || near === head) refused = -1;
      view.setLead(active, head, p.x, p.y, reachable);
    } else view.clearLead();
    e.preventDefault();
  };

  const onUp = () => {
    if (!holding) return;
    holding = false;
    lastAt = null;
    lastPost = -1;
    refused = -1;
    view.clearLead();
    paint();
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
  let cursor = board.strands[0]?.from ?? 0;
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
      session.openGesture();
      reach(cursor);
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace') {
      if (active >= 0 && paths[active].length > 1) {
        session.openGesture();
        cutBackTo(active, paths[active].length - 2);
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && board.strands.length > 1) {
      // Round the strands, landing the cursor on the next one's pinned end.
      const next = (active + 1) % board.strands.length;
      active = next;
      cursor = headOf(next) >= 0 ? headOf(next) : board.strands[next].from;
      view.markCursor(cursor);
      e.preventDefault();
    }
  };

  view.el.addEventListener('keydown', onKey);

  /*
   * A read-only handle for the end-to-end harness, published while this board
   * is on screen. It answers questions in Thread's own terms and decides
   * nothing; every move a test makes still goes through real pointer events.
   */
  (window as unknown as { __board: unknown }).__board = {
    game: 'thread',
    board,
    runIsLegal: (a: number, b: number) => runBetween(c, a, b) >= 0,
    paths: () => paths.map((p) => [...p]),
  };

  paint();

  return {
    el: boardBox,

    /** Something outside changed the state: undo, redo, restart, a resume. */
    refresh() {
      paths = session.paths;
      view.update(paths, session.raw());
    },

    /**
     * Show a hint's focus. The hint names board things in the game's own
     * language ("post:14") and this is the only place that language is
     * understood — the platform passes the strings through without reading
     * them, which is what lets a hint mean a hexagon in one game and a wall in
     * another.
     */
    spotlight(focus: readonly string[]) {
      view.spotlight(focus.map((f) => Number(f.split(':')[1])).filter((n) => Number.isInteger(n)));
    },

    dispose() {
      view.el.removeEventListener('pointerdown', onDown);
      view.el.removeEventListener('pointermove', onMove);
      view.el.removeEventListener('pointerup', onUp);
      view.el.removeEventListener('pointercancel', onUp);
      view.el.removeEventListener('keydown', onKey);
      delete (window as unknown as { __board?: unknown }).__board;
      view.dispose();
    },
  };
}
