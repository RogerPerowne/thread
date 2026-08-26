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
 * already lying on another will still be lying on it when you let go, and the
 * end is the worst possible moment to find that out. A warning appears the
 * instant it is true and goes the instant it is not — which is only possible
 * because a warning here means a rule BROKEN. How much is left to do is not a
 * warning and is never shown as one: it would be true from the first move to
 * the last, and a red line that is always on is one nobody can read.
 *
 * Nothing here reflows. The line carrying the warning holds its height whether
 * or not it has anything in it, and Next holds its place from the start — a
 * board that jumps under your thumb because a word appeared is worse than the
 * word being missing.
 */

import { h } from './dom.js';
import { topBar, pill } from './components.js';
import { mountBoard } from './render.js';
import {
  compile, runBetween, conflicts, segPointDist2, POST_R, GRAB_POST, type Board,
} from '../core/board.js';
import { judge, firstBreak, whatIsLeft } from '../core/check.js';
import * as haptics from '../render/haptics.js';

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
    tail = [];
    view.setWaiting(0, []);
    haptics.tick();
    repaint(false);
  }

  function clearAll(): void {
    snapshot();
    paths = board.strands.map(() => []);
    tail = [];
    view.setWaiting(0, []);
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
    view.setWaiting(strand, tail);
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
      view.setWaiting(s, tail);
      return true;
    }
    return false;
  }

  /**
   * Wind the string back to the post at `at`, dropping everything past it.
   *
   * One post back or six, it is the same move: you have changed your mind
   * about a stretch of string. Having to reverse over every post in turn to
   * take back a run of them is the kind of precision a thumb on a moving board
   * cannot deliver, and failing at it silently is why a warning could feel
   * stuck — the board was right that two strings were touching, and the player
   * had no reliable way to take one of them off.
   *
   * What comes off does NOT join the waiting tail. The tail is the part of the
   * string you have not got back to yet; this is a stretch you have just
   * decided against, and putting it in the tail would have the string quietly
   * lay it again the moment you let go.
   */
  function rewindTo(at: number): void {
    const path = paths[dragging];
    if (at >= path.length - 1) return;
    // The new head first, so the recoil runs outwards from where the string
    // now ends — string being pulled back in, rather than a line vanishing.
    view.retract(dragging, path.slice(at));
    path.length = at + 1;
    refused = -1;
    haptics.notch();
    repaint(true);
  }

  /*
   * The post the last refusal was about. Saying it again on every pointer
   * sample while the thumb rests there would be a strobe, not an answer.
   */
  let refused = -1;

  /**
   * The thumb has come to rest on a post there is no way to reach.
   *
   * A block across the gap, or another post in the line. Nothing happening is
   * the worst possible answer, because it is exactly what a missed touch looks
   * like — so the string you have laid pulses, from the loose end backwards,
   * which says both that the game heard you and which string it is about.
   *
   * Only where the thumb ENDS UP, never where it passed through. Sweeping
   * across a board goes near all sorts of posts you had no intention of
   * joining, and pulsing at each of them would be a board that flinches.
   */
  function refuseAt(x: number, y: number): void {
    const path = paths[dragging];
    const head = path[path.length - 1];
    const post = view.nearestPost(x, y, GRAB_POST);
    if (post < 0 || post === head || path.includes(post) || tail.includes(post)
      || runBetween(c, head, post) >= 0) {
      refused = -1;
      return;
    }
    if (post === refused) return;
    refused = post;
    view.refuse(path);
    haptics.bump();
  }

  /** The thumb has reached `post`. Everything a drag can do happens here. */
  function reach(post: number): void {
    const path = paths[dragging];
    const head = path[path.length - 1];
    if (post === head) return;

    // Somewhere on the string already: wind back to it.
    const at = path.indexOf(post);
    if (at >= 0) { rewindTo(at); return; }

    const run = runBetween(c, head, post);

    // Meeting the waiting tail again joins the string back up.
    const inTail = tail.indexOf(post);
    if (inTail >= 0 && run >= 0) {
      path.push(...tail.slice(inTail));
      tail = [];
      view.setWaiting(dragging, tail);
      refused = -1;
      view.flashPost(post);
      haptics.tie();
      repaint(true);
      return;
    }

    // No way to lay string from here to there. Passing over such a post on the
    // way somewhere else is not an attempt to go there, so nothing is said
    // here — `onMove` speaks when the thumb actually stops on one.
    if (run < 0) return;

    steal(post, dragging);
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
   * looked. On a phone that is tens of pixels apart, and a post is worth about
   * thirty — so a quick sweep across three posts could easily be reported as
   * one move that started on the first and ended past the third, and the two
   * in between simply never happened. Playing the whole board in one gesture,
   * which is how anyone actually plays it, was therefore a matter of luck.
   *
   * Walking the line between the two samples fixes it: what the thumb crossed
   * is what the string does, whether it was moved slowly or thrown.
   */
  function sweep(to: { x: number; y: number }): void {
    const from = lastAt ?? to;
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    // A step of half a post cannot skip one, and the cap keeps a wild jump —
    // or a first sample after a scroll — from costing a frame.
    const steps = Math.min(96, Math.max(1, Math.ceil(span / POST_R)));
    let seen = -1;
    for (let i = 1; i <= steps && dragging >= 0; i++) {
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

  /** Every run on the board right now, as compiled run ids. */
  function laidRuns(except: number): number[] {
    const out: number[] = [];
    for (let s = 0; s < paths.length; s++) {
      if (s === except) continue;
      const path = paths[s];
      for (let i = 0; i + 1 < path.length; i++) {
        const id = runBetween(c, path[i], path[i + 1]);
        if (id >= 0) out.push(id);
      }
    }
    return out;
  }

  /**
   * On letting go, join the waiting tail back on rather than dropping it.
   * Keeping as much of it as possible is the whole point of being able to grab
   * a string in the middle.
   *
   * As much as is still GOOD, though. Rejoining a stretch that lies across
   * another string is how a warning came to look stuck: you would drag the
   * offending run off, let go, and the string would quietly lay it again —
   * so the board went on saying two strings were touching however many times
   * you took the touch away. What still fits comes back; what no longer does
   * is dropped, which is the answer the player was asking for.
   */
  function reconnect(): void {
    if (dragging < 0 || tail.length === 0) { tail = []; return; }
    const path = paths[dragging];
    const busy = laidRuns(dragging);
    const ours: number[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const id = runBetween(c, path[i], path[i + 1]);
      if (id >= 0) ours.push(id);
    }
    const clear = (a: number, b: number): boolean => {
      const id = runBetween(c, a, b);
      if (id < 0) return false;
      for (const other of busy) if (conflicts(c, id, other)) return false;
      for (const other of ours) if (conflicts(c, id, other)) return false;
      ours.push(id);
      return true;
    };
    for (let i = 0; i < tail.length; i++) {
      if (path.includes(tail[i])) continue;
      if (!clear(path[path.length - 1], tail[i])) continue;
      // From here the tail is laid post by post and stops at the first one
      // that no longer fits, rather than all-or-nothing.
      for (let k = i; k < tail.length; k++) {
        if (path.includes(tail[k])) continue;
        if (k > i && !clear(path[path.length - 1], tail[k])) break;
        path.push(tail[k]);
      }
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
    lastAt = p;
    refused = -1;
    view.el.setPointerCapture(e.pointerId);
    e.preventDefault();
    repaint(true);
  };

  const onMove = (e: PointerEvent) => {
    if (dragging < 0) return;
    /*
     * Take every position the browser has for this move, not just the latest.
     * A phone coalesces pointer moves — several real positions arrive as one
     * event — and the ones it folded away are exactly the ones between two
     * posts. Asking for them back is the difference between a string that
     * follows your finger and one that follows where your finger stopped.
     */
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const s of samples.length > 0 ? samples : [e]) {
      const p = view.at(s.clientX, s.clientY);
      sweep(p);
      lastAt = p;
    }

    // Whatever happened, the loose end goes where the thumb is.
    const p = lastAt ?? view.at(e.clientX, e.clientY);
    refuseAt(p.x, p.y);
    const path = paths[dragging];
    const head = path[path.length - 1];
    if (head !== undefined) {
      const near = view.nearestPost(p.x, p.y, GRAB_POST * 1.6);
      const canReach = near < 0 || near === head
        || path.includes(near)
        || runBetween(c, head, near) >= 0;
      view.setLead(dragging, head, p.x, p.y, canReach);
    }
    e.preventDefault();
  };

  const onUp = () => {
    if (dragging < 0) return;
    reconnect();
    dragging = -1;
    lastAt = null;
    refused = -1;
    view.clearLead();
    view.setWaiting(0, []);
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
        reach(cursor);
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
