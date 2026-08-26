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

  /*
   * The board holds PIECES of string, each a contiguous run of posts belonging
   * to a known strand. A strand is one piece when it is finished, and can be
   * more than one while it is being built — which is the point:
   *
   *   - Start at one pinned end, start at the other, and join them in the
   *     middle. Working inwards from both ends is how anyone actually solves a
   *     long string, and with a single path per strand it was impossible.
   *   - Grab the middle of a finished string and go somewhere else, and it
   *     simply breaks in two. The far part stays exactly where it is, in full
   *     view, and joins back on the moment your new route reaches it.
   *
   * That second one used to be done with a hidden tail that was put back when
   * you let go, and it was the direct cause of a warning that could not be
   * cleared: you took the offending run off, released, and the string laid it
   * again. A piece you can see cannot do that to you. Nothing here is held
   * back, and there is nothing to decide between "starting again" and
   * "changing a bit" — breaking and joining are the same two moves either way.
   */
  type Piece = { strand: number; posts: number[] };
  let pieces: Piece[] = [];
  const history: Piece[][] = [];
  /** Which end of which piece the next post joins onto. */
  let grow: { piece: number; end: 0 | 1 } | null = null;
  /** Is a press in progress? */
  let holding = false;
  /** Where the thumb was at the last sample, so the gap can be walked. */
  let lastAt: { x: number; y: number } | null = null;
  /*
   * The post the thumb last did something at, for as long as it is down.
   *
   * Not per pointer event — per gesture. A thumb that arrives at a post and
   * stays there keeps being sampled there, and every one of those samples
   * would otherwise be a fresh instruction. That is harmless for most moves,
   * which are idempotent, and quietly destructive for one: joining two pieces
   * moves the string's end past the post under the thumb, so the very next
   * sample on that same post reads as "end the string here" and undoes the
   * join it just made.
   */
  let lastPost = -1;
  let solved = false;

  const clone = (ps: Piece[]): Piece[] => ps.map((p) => ({ strand: p.strand, posts: p.posts.slice() }));

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
    history.push(clone(pieces));
    if (history.length > 80) history.shift();
  }

  /**
   * The pieces as an attempt the judge can read: one entry per strand, plus
   * any extra pieces on the end.
   *
   * A strand with two pieces cannot have both its ends joined yet, so the
   * ends check fails on it — which is correct, and reads as "not finished"
   * rather than as a fault. Every run on the board is checked either way,
   * because the contact test walks all the entries.
   */
  function attemptOf(): number[][] {
    const out: number[][] = board.strands.map(() => []);
    const extra: number[][] = [];
    const taken = new Uint8Array(board.strands.length);
    for (const piece of pieces) {
      if (!taken[piece.strand]) {
        taken[piece.strand] = 1;
        out[piece.strand] = piece.posts;
      } else extra.push(piece.posts);
    }
    return [...out, ...extra];
  }

  function repaint(partial: boolean): void {
    /*
     * A board nobody has touched is judged as work in progress, not as a wrong
     * answer. Otherwise the first thing a player is told, before they have
     * done anything at all, is that they have broken a rule.
     */
    const laid = pieces.some((p) => p.posts.length > 1);
    const v = judge(c, attemptOf(), partial || !laid);
    view.update(pieces, v);

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
    pieces = prev;
    grow = null;
    haptics.tick();
    repaint(false);
  }

  function clearAll(): void {
    snapshot();
    pieces = [];
    grow = null;
    haptics.tick();
    repaint(false);
  }

  /** Which piece holds this post, and where along it. */
  function find(post: number): { piece: number; at: number } | null {
    for (let i = 0; i < pieces.length; i++) {
      const at = pieces[i].posts.indexOf(post);
      if (at >= 0) return { piece: i, at };
    }
    return null;
  }

  /** Cut a piece back to `from`, drawing what goes. True if it went entirely. */
  function discard(i: number, from = 0): boolean {
    const piece = pieces[i];
    if (piece.posts.length - from > 1) view.retract(piece.strand, piece.posts.slice(from));
    if (from <= 0) { pieces.splice(i, 1); return true; }
    piece.posts.length = from;
    return false;
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

  /**
   * The piece of string nearest this point, and which end of it your thumb is
   * closer to. Grabbing between two posts picks the nearer of the two, so
   * pulling a straight out sideways starts from the right end.
   */
  function pieceAt(x: number, y: number): { piece: number; at: number } | null {
    let best: { piece: number; at: number } | null = null;
    let bestD = GRAB_LINE * GRAB_LINE;
    for (let i = 0; i < pieces.length; i++) {
      const path = pieces[i].posts;
      for (let k = 0; k + 1 < path.length; k++) {
        const a = board.posts[path[k]];
        const b = board.posts[path[k + 1]];
        const d = segPointDist2(a, b, [x, y]);
        if (d >= bestD) continue;
        bestD = d;
        const da = (a[0] - x) ** 2 + (a[1] - y) ** 2;
        const db = (b[0] - x) ** 2 + (b[1] - y) ** 2;
        best = { piece: i, at: da <= db ? k : k + 1 };
      }
    }
    return best;
  }

  /*
   * Where the pointer picked a piece up. Nothing is broken at that moment:
   * press on the middle of a string and let go again and the board is exactly
   * as it was. The break happens when you actually go somewhere else, which is
   * the point at which you have said what you want.
   */
  let cutFrom: { piece: number; at: number } | null = null;
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
    view.refuse(grow ? pieces[grow.piece].posts : []);
    haptics.bump();
  }

  /** The post a piece is currently growing from. */
  function headOf(g: { piece: number; end: 0 | 1 }): number {
    const posts = pieces[g.piece].posts;
    return g.end === 0 ? posts[0] : posts[posts.length - 1];
  }

  /** Put a post on the growing end of the growing piece. */
  function addToGrowing(post: number): void {
    const g = grow!;
    const posts = pieces[g.piece].posts;
    if (g.end === 0) posts.unshift(post); else posts.push(post);
  }

  /**
   * Two pieces of one strand have met: make them one.
   *
   * `other` is joined on at the growing end, oriented so the join is
   * continuous. Which piece survives does not matter to the board, only that
   * the posts end up in the right order.
   */
  function joinTo(other: number): void {
    const g = grow!;
    const mine = pieces[g.piece];
    const theirs = pieces[other];
    const add = theirs.posts;
    if (g.end === 1) mine.posts.push(...add);
    else mine.posts.unshift(...[...add].reverse());
    pieces.splice(other, 1);
    if (other < g.piece) g.piece--;
    grow = { piece: g.piece, end: g.end };
  }

  /**
   * Point at a post. This is the whole game's input.
   *
   * A tap calls it once; a drag calls it for every post the thumb crosses.
   * There is no second verb and no mode, which is why the two can be mixed
   * freely, mid-string, without the player having to decide which they are
   * doing — or, for that matter, whether they are starting again or changing
   * a bit. Those are the same two moves: break here, join there.
   */
  function reach(post: number): void {
    const held = find(post);

    // --- already on a piece --------------------------------------------------
    if (held) {
      const piece = pieces[held.piece];

      // On the piece we are growing: wind it back to here.
      if (grow && held.piece === grow.piece) {
        const posts = piece.posts;
        const last = grow.end === 0 ? 0 : posts.length - 1;
        if (held.at === last) return;
        touch();
        if (grow.end === 1) {
          view.retract(piece.strand, posts.slice(held.at));
          posts.length = held.at + 1;
        } else {
          view.retract(piece.strand, posts.slice(0, held.at + 1).reverse());
          posts.splice(0, held.at);
        }
        refused = -1;
        haptics.notch();
        repaint(true);
        return;
      }

      // Another piece of the same strand: this is the join.
      if (grow && piece.strand === pieces[grow.piece].strand) {
        const head = headOf(grow);
        // Reaching its middle rather than an end: the far side comes off, so
        // the post we met becomes the end that joins on.
        if (held.at !== 0 && held.at !== piece.posts.length - 1) {
          const keepFront = held.at >= piece.posts.length - 1 - held.at;
          touch();
          if (keepFront) {
            view.retract(piece.strand, piece.posts.slice(held.at));
            piece.posts.length = held.at + 1;
          } else {
            view.retract(piece.strand, piece.posts.slice(0, held.at + 1).reverse());
            piece.posts.splice(0, held.at);
          }
        }
        if (runBetween(c, head, post) < 0 && head !== post) { refuse(post); return; }
        touch();
        // Orient the other piece so the post we reached leads.
        const other = pieces[held.piece];
        if (other.posts[0] !== post) other.posts.reverse();
        joinTo(held.piece);
        refused = -1;
        view.flashPost(post);
        haptics.tie();
        repaint(true);
        return;
      }

      // Another strand's string: take the post off it.
      touch();
      const dropped = discard(held.piece, held.at);
      if (dropped && grow && grow.piece > held.piece) grow.piece--;
      if (!grow) { startAt(post); return; }
      const head = headOf(grow);
      if (runBetween(c, head, post) < 0) { repaint(true); return; }
      addToGrowing(post);
      refused = -1;
      view.flashPost(post);
      haptics.tick();
      repaint(true);
      return;
    }

    // --- a post nothing is using --------------------------------------------
    /*
     * A pinned end belongs to its own string. Pointing at one means "this
     * string now" — never "run the string I am holding into somebody else's
     * end", which is what happened when the piece being grown simply carried
     * over from the last gesture.
     */
    const pin = pinnedOwner(post);
    const growingStrand = grow ? pieces[grow.piece].strand : -1;
    if (pin >= 0 && pin !== growingStrand) { startAt(post); return; }

    if (grow) {
      const head = headOf(grow);
      if (post !== head && runBetween(c, head, post) >= 0) {
        touch();
        addToGrowing(post);
        refused = -1;
        view.flashPost(post);
        haptics.tick();
        repaint(true);
        return;
      }
    }
    startAt(post);
  }

  /** Begin a new piece here, if this post may begin one. */
  function startAt(post: number): void {
    const strand = pinnedOwner(post);
    if (strand < 0 || !canStart(strand, post)) { refuse(post); return; }
    touch();
    pieces.push({ strand, posts: [post] });
    grow = { piece: pieces.length - 1, end: 1 };
    cutFrom = null;
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
    for (let i = 1; i <= steps && holding; i++) {
      const k = i / steps;
      const x = from.x + (to.x - from.x) * k;
      const y = from.y + (to.y - from.y) * k;
      const post = view.nearestPost(x, y, GRAB_POST);
      if (post < 0 || post === lastPost) continue;
      lastPost = post;
      /*
       * While a press is still resting on the post it grabbed, nothing has
       * been said yet. Leaving that post is what says it — and the string has
       * to break BEFORE the new post is handled, or the sweep passes back over
       * the grabbed post on its way out, reads it as "end the string here",
       * and throws away the very part the player was keeping.
       */
      if (cutFrom) {
        if (post === pieces[cutFrom.piece].posts[cutFrom.at]) continue;
        breakHere();
      }
      reach(post);
    }
  }

  /**
   * Take hold of a piece at `at`, without changing anything.
   *
   * Which part you keep is decided here and never asked about: the part with
   * the pinned end in it. A string is anchored at its ends, so the half still
   * fastened to one is plainly the half you are keeping, and the half beyond
   * your thumb is the half you are reworking. If neither end is pinned — the
   * far part of a string you broke earlier — the longer part stays, because
   * more work is the thing worth keeping.
   *
   * Nothing happens yet. The break waits until you actually leave the post you
   * pressed, because that is the moment you have said what you want.
   */
  function hold(piece: number, at: number): void {
    const posts = pieces[piece].posts;
    const spec = board.strands[pieces[piece].strand];
    const pinnedFirst = spec.from >= 0
      && (posts[0] === spec.from || posts[0] === spec.to);
    const pinnedLast = spec.from >= 0
      && (posts[posts.length - 1] === spec.from || posts[posts.length - 1] === spec.to);
    let keepFront: boolean;
    if (pinnedFirst) keepFront = true;
    else if (pinnedLast) keepFront = false;
    else keepFront = at >= posts.length - 1 - at;
    grow = { piece, end: keepFront ? 1 : 0 };
    cutFrom = { piece, at };
  }

  /** Break the held piece at the grab point, leaving the far part on the board. */
  function breakHere(): void {
    if (!cutFrom || !grow) return;
    const { piece, at } = cutFrom;
    const posts = pieces[piece].posts;
    cutFrom = null;
    if (grow.end === 1) {
      if (at >= posts.length - 1) return;
      const rest = posts.splice(at + 1);
      if (rest.length > 0) pieces.push({ strand: pieces[piece].strand, posts: rest });
    } else {
      if (at <= 0) return;
      const rest = posts.splice(0, at);
      if (rest.length > 0) pieces.push({ strand: pieces[piece].strand, posts: rest });
    }
    touch();
  }

  // --- pointer -------------------------------------------------------------

  const onDown = (e: PointerEvent) => {
    if (solved) return;
    const p = view.at(e.clientX, e.clientY);
    const post = view.nearestPost(p.x, p.y, GRAB_POST);

    holding = true;
    lastPost = post;
    changed = false;
    snapped = false;
    refused = -1;
    cutFrom = null;

    if (post >= 0) {
      const held = find(post);
      if (held) hold(held.piece, held.at);
      else {
        reach(post);
        if (!changed) { holding = false; return; }
      }
    } else {
      const grab = pieceAt(p.x, p.y);
      if (!grab) { holding = false; return; }
      hold(grab.piece, grab.at);
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
    if (grow) {
      const head = headOf(grow);
      const near = view.nearestPost(p.x, p.y, GRAB_POST * 1.6);
      const mine = pieces[grow.piece].posts;
      const canReach = near < 0 || near === head || mine.includes(near)
        || runBetween(c, head, near) >= 0;
      if (!canReach) refuse(near);
      else if (near < 0 || near === head) refused = -1;
      view.setLead(pieces[grow.piece].strand, head, p.x, p.y, canReach);
    }
    e.preventDefault();
  };

  const onUp = () => {
    if (!holding) return;
    /*
     * A press that never went anywhere is a tap. On a post already on a piece
     * that means "end here" — which is the only way to wind back without
     * dragging, and so the thing that makes the game playable by tapping
     * alone.
     */
    /*
     * Tapping is the opposite of dragging from the same post, and that is the
     * whole of how the game tells "start again here" from "change this bit":
     * whether you went anywhere. A tap ends the string where you tapped and
     * the rest goes. A drag from the same post keeps the rest, standing on the
     * board, ready to join back on. Nobody is asked which they meant.
     */
    if (!changed && cutFrom && grow) {
      const posts = pieces[cutFrom.piece].posts;
      const last = grow.end === 0 ? 0 : posts.length - 1;
      if (cutFrom.at !== last) {
        touch();
        if (grow.end === 1) {
          view.retract(pieces[cutFrom.piece].strand, posts.slice(cutFrom.at));
          posts.length = cutFrom.at + 1;
        } else {
          view.retract(pieces[cutFrom.piece].strand, posts.slice(0, cutFrom.at + 1).reverse());
          posts.splice(0, cutFrom.at);
        }
        haptics.notch();
      }
    }
    holding = false;
    cutFrom = null;
    lastAt = null;
    lastPost = -1;
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
      if (grow) {
        const piece = pieces[grow.piece];
        const posts = piece.posts;
        if (posts.length > 0) {
          snapshot();
          if (grow.end === 1) {
            view.retract(piece.strand, posts.slice(Math.max(0, posts.length - 2)));
            posts.pop();
          } else {
            view.retract(piece.strand, posts.slice(0, 2).reverse());
            posts.shift();
          }
          if (posts.length === 0) { pieces.splice(grow.piece, 1); grow = null; }
        }
      }
      repaint(false);
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && board.strands.length > 1) {
      // Round the strands, landing the cursor on the next one's pinned end.
      const from = grow ? pieces[grow.piece].strand : -1;
      const next = (from + 1) % board.strands.length;
      const start = board.strands[next].from;
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
