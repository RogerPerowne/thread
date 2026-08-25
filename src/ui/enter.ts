/**
 * Going into a level.
 *
 * The tile you press is not a button that swaps a screen: it is the thing you
 * are about to play. The camera rises off the isometric view until it is
 * looking straight down at that tile, un-turning the 45 degrees the projection
 * carries, so its top face — a square all along — finally lands on the screen
 * as a square. That square becomes the title card, and the title card becomes
 * the board. One object the whole way through, which is what makes the level
 * feel like somewhere you went rather than something that replaced the screen.
 *
 * Timing is one rAF loop rather than a chain of timers. The sequence crosses a
 * screen change, and the ticker is cancelled by design on every one of those,
 * so this cannot be hung off it; and a stale timer writing into the next
 * screen is the cause of most transition glitches.
 *
 * There is no loading here to report on, so the card does not pretend to have
 * a progress bar. It shows what you are about to play and draws the level's
 * outline once, which is a beat, not a claim.
 */

import { h, svg } from './dom.js';
import { miniBoard } from './mini.js';
import type { PathView } from './path.js';
import type { Board } from '../core/board.js';
import * as haptics from '../render/haptics.js';
import { warmCompile } from '../core/board.js';

const FLY = 520;
const HOLD = 420;
const LAND = 340;

export interface EnterOpts {
  view: PathView;
  index: number;
  color: string;
  eyebrow: string;
  title: string;
  board: Board;
  reducedMotion: boolean;
  /** Mount the play screen. Called once, between the hold and the landing. */
  onArrive: () => void;
}

let running: (() => void) | null = null;
/*
 * Mounting the play screen disposes the chapter screen, which is where the
 * cancel hook lives — so without this the sequence would tear itself down at
 * the exact moment it hands over. A cancel that arrives while the handover is
 * in flight is this sequence's own, and is ignored.
 */
let handingOver = false;

/** Stop any flight in progress and put everything back. Safe to call twice. */
export function cancelEnter(): void {
  if (handingOver) return;
  running?.();
  running = null;
}

export function enterLevel(opts: EnterOpts): void {
  const { view, index, reducedMotion, onArrive: go } = opts;
  if (reducedMotion) {
    go();
    return;
  }
  cancelEnter();
  haptics.bump();

  /*
   * Work the board out now, while the finger is still down and nothing is
   * moving. Otherwise the first thing the play screen does is compile it —
   * tens of milliseconds of it — in the middle of the landing, which is a
   * visible stall at exactly the moment the animation is asking to be
   * believed.
   */
  warmCompile(opts.board);

  const svgRoot = view.el.querySelector('svg');
  svgRoot?.classList.add('flying');
  const tile = svgRoot?.querySelectorAll('.ptile')[index];
  tile?.classList.add('takeoff');

  /*
   * The card takes the colour of the face it is replacing before it becomes
   * paper, so a solved tile — which is solid ink — does not flash white the
   * instant the camera arrives. The tile itself is what you see during the
   * flight; the card only becomes visible once the two are the same square.
   */
  const faceFill = tile?.querySelector('.top')?.getAttribute('fill') ?? '#ffffff';
  const flight = view.flight(index);
  const card = buildCard(opts, faceFill);
  document.body.appendChild(card.el);

  let raf = 0;
  let t0 = 0;
  let mounted = false;
  let holdRect: DOMRect | null = null;
  let landing: { from: DOMRect; to: DOMRect } | null = null;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    card.el.remove();
    svgRoot?.classList.remove('flying');
    tile?.classList.remove('takeoff');
  };
  running = cleanup;

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const easeOut = (t: number) => 1 - (1 - t) ** 3;

  const frame = (now: number) => {
    if (!t0) t0 = now;
    const e = now - t0;

    if (e < FLY) {
      flight.at(ease(e / FLY));
      card.place(flight.faceRect(), 0);
      card.fade(0);
      raf = requestAnimationFrame(frame);
      return;
    }

    if (e < FLY + HOLD) {
      /*
       * The camera has arrived. Redrawing the same still frame twenty-five
       * times over is work for nothing, so the tile is drawn once and its
       * rectangle kept — which also means the path screen can be taken out
       * from under the card without the rectangle going with it.
       */
      if (holdRect === null) {
        flight.at(1);
        holdRect = flight.faceRect();
      }
      const k = Math.min(1, (e - FLY) / 200);
      card.fade(1);
      card.settle(k);
      card.place(holdRect, k);
      card.draw(Math.min(1, (e - FLY) / (HOLD * 0.8)));

      /*
       * Mount the play screen partway through the hold rather than at the end
       * of it. Building a screen costs tens of milliseconds, and at the end of
       * the hold that lands exactly on the first frame of the landing — a
       * stall at the one moment the animation is asking to be believed. Here
       * the card is stationary and covers the screen, so the swap behind it
       * costs a frame nobody can see.
       */
      if (!mounted && e > FLY + HOLD * 0.45) {
        mounted = true;
        handingOver = true;
        go();
        handingOver = false;
      }
      raf = requestAnimationFrame(frame);
      return;
    }

    if (!landing) {
      if (!mounted) {
        mounted = true;
        handingOver = true;
        go();
        handingOver = false;
      }
      const from = holdRect ?? flight.faceRect();
      // The play screen is in the document now, so the board can be measured
      // rather than guessed at.
      const board = document.querySelector('.boardsurface');
      const to = board ? board.getBoundingClientRect() : from;
      landing = { from, to };
      const shell = document.querySelector('.playwrap') as HTMLElement | null;
      shell?.classList.add('arriving');
      card.el.classList.add('landing');
    }

    const t = Math.min(1, (e - FLY - HOLD) / LAND);
    if (landing) {
      const k = easeOut(t);
      const r = new DOMRect(
        landing.from.x + (landing.to.x - landing.from.x) * k,
        landing.from.y + (landing.to.y - landing.from.y) * k,
        landing.from.width + (landing.to.width - landing.from.width) * k,
        landing.from.height + (landing.to.height - landing.from.height) * k,
      );
      card.place(r, 1);
      card.fade(1 - k);
      const shell = document.querySelector('.playwrap') as HTMLElement | null;
      if (shell) shell.style.opacity = String(k);
    }

    if (t < 1) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const shell = document.querySelector('.playwrap') as HTMLElement | null;
    if (shell) {
      shell.style.opacity = '';
      shell.classList.remove('arriving');
    }
    cleanup();
    running = null;
  };
  raf = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------

interface Card {
  el: HTMLElement;
  place: (r: DOMRect, reveal: number) => void;
  /** 0 = still the tile's face, 1 = paper. */
  settle: (t: number) => void;
  draw: (t: number) => void;
  fade: (o: number) => void;
}

function buildCard(opts: EnterOpts, faceFill: string): Card {
  /*
   * The card draws the board you are about to play — its posts and its pinned
   * ends. There is no answer to give away: the whole point of this game is
   * that nothing on the board tells you the route.
   */
  const art = miniBoard(opts.board, 'var(--card)');
  const outline = art.querySelector('.mini-lead');
  let dash = 0;
  if (outline) {
    dash = 340;
    outline.setAttribute('stroke-dasharray', String(dash));
    outline.setAttribute('stroke-dashoffset', String(dash));
    outline.setAttribute('fill-opacity', '0');
  }

  const body = h('div', { class: 'cardbody' },
    h('div', { class: 'cardart' }, art),
    h('div', { class: 'cardeyebrow', text: opts.eyebrow }),
    h('div', { class: 'cardtitle display', text: opts.title }),
  );
  const el = h('div', {
    class: 'entercard',
    style: `--card:${opts.color};background:${faceFill}`,
    'aria-hidden': 'true',
  }, body);

  return {
    el,
    place: (r, reveal) => {
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      body.style.opacity = String(reveal);
    },
    settle: (t) => {
      el.style.background = t >= 1 ? '' : mix(faceFill, '#ffffff', t);
    },
    draw: (t) => {
      if (outline) {
        outline.setAttribute('stroke-dashoffset', String(dash * (1 - t)));
        outline.setAttribute('fill-opacity', String(0.22 * Math.max(0, t - 0.5) * 2));
      }
    },
    fade: (o) => { el.style.opacity = String(o); },
  };
}

/** Straight-line blend of two #rrggbb colours. */
function mix(a: string, b: string, t: number): string {
  const parse = (c: string) => {
    const hex = c.replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const c = [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]
    .map((v) => Math.round(v).toString(16).padStart(2, '0'));
  return `#${c.join('')}`;
}

export { svg };
