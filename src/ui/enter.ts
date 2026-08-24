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
import { miniature } from './components.js';
import { modeMark } from './icons.js';
import { objectiveOf } from '../core/level.js';
import { showsRegion } from '../core/objective.js';
import type { PathView } from './path.js';
import type { Level } from '../core/level.js';
import * as haptics from '../render/haptics.js';

const FLY = 520;
const HOLD = 420;
const LAND = 340;

export interface EnterOpts {
  view: PathView;
  index: number;
  color: string;
  eyebrow: string;
  title: string;
  level: Level;
  reducedMotion: boolean;
  /** Mount the play screen. Called once, between the hold and the landing. */
  go: () => void;
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
  const { view, index, reducedMotion, go } = opts;
  if (reducedMotion) {
    go();
    return;
  }
  cancelEnter();
  haptics.bump();

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
      flight.at(1);
      const r = flight.faceRect();
      const k = Math.min(1, (e - FLY) / 200);
      card.fade(1);
      card.settle(k);
      card.place(r, k);
      card.draw(Math.min(1, (e - FLY) / (HOLD * 0.8)));
      raf = requestAnimationFrame(frame);
      return;
    }

    if (!mounted) {
      mounted = true;
      const from = flight.faceRect();
      handingOver = true;
      go();
      handingOver = false;
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
   * On a level that shows its target, the card draws that shape: it is what
   * you are about to make, and seeing it drawn is a pleasant way in. On a
   * level that hides it — a corral, a clue board — the same drawing would be
   * the answer, so the mode's own mark goes there instead.
   */
  const reveals = showsRegion(objectiveOf(opts.level));
  const art = reveals
    ? miniature(opts.level, { showPegs: true, mono: true, ink: 'var(--card)' })
    : modeMark(opts.level.mode, 'var(--card)');
  const outline = reveals ? art.querySelector('path') : null;
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
