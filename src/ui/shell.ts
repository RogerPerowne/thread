/**
 * The whole app around the board: three cards, a list of numbers, and a game.
 *
 * There is deliberately nothing else. The previous home screen had eleven
 * modes, a collection row, a daily card and an assessment on it, and the
 * effect of all that was to make the thing you actually came to do hard to
 * find. Three cards fit on a phone without scrolling, and every one of them is
 * a game you can start in one press.
 */

import { h } from './dom.js';
import { playScreen } from './playscreen.js';
import type { Board } from '../core/board.js';
import classicRaw from '../../boards/classic.json';
import colouredRaw from '../../boards/coloured.json';
import gridRaw from '../../boards/grid.json';

export const MODES = ['classic', 'coloured', 'grid'] as const;
export type Mode = (typeof MODES)[number];

// JSON widens the point pairs to number[], so the cast goes through unknown.
// The build script wrote these and the gate checks them, so the shape is known.
export const BOARDS: Record<Mode, Board[]> = {
  classic: classicRaw as unknown as Board[],
  coloured: colouredRaw as unknown as Board[],
  grid: gridRaw as unknown as Board[],
};

export const MODE_NAME: Record<Mode, string> = {
  classic: 'Classic',
  coloured: 'Coloured',
  grid: 'Grid',
};

export const MODE_LINE: Record<Mode, string> = {
  classic: 'One string. Every post, no touching.',
  coloured: 'Several strings, each to its own end.',
  grid: 'Fill the lattice, corner to corner.',
};

export const MODE_INK: Record<Mode, string> = {
  classic: '#E9A23B',
  coloured: '#5B8DEF',
  grid: '#4CA97A',
};

const isMode = (v: string): v is Mode => (MODES as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const KEY = 'thread.solved';

/** Ids of solved boards. Nothing else is kept: there is nothing else to keep. */
export function loadSolved(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSolved(s: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* private mode: play on, just do not remember */
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

type Screen = { el: HTMLElement; dispose?(): void };

function homeScreen(app: App): Screen {
  const cards = MODES.map((m) => {
    const total = BOARDS[m].length;
    const done = BOARDS[m].filter((b) => app.solved.has(b.id)).length;
    return h('button', {
      class: 'card',
      'data-card': m,
      style: `--card:${MODE_INK[m]}`,
      onclick: () => app.go(`#/m/${m}`),
    },
      h('h2', { text: MODE_NAME[m] }),
      h('p', { text: MODE_LINE[m] }),
      h('span', { class: 'tally', text: `${done} / ${total}` }),
    );
  });

  return {
    el: h('div', { class: 'screen home' },
      h('header', { class: 'mast' },
        h('h1', { class: 'wordmark', text: 'THREAD' }),
        h('p', { class: 'rule', text: 'Use every post. Never touch.' }),
      ),
      h('div', { class: 'cards' }, ...cards),
    ),
  };
}

function pickScreen(app: App, mode: Mode): Screen {
  const list = BOARDS[mode];
  const grid = h('div', { class: 'picker' });
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const done = app.solved.has(b.id);
    grid.appendChild(h('button', {
      class: `chip${done ? ' done' : ''}`,
      'data-level': String(i + 1),
      text: String(i + 1),
      onclick: () => app.go(`#/p/${mode}/${i + 1}`),
    }));
  }
  return {
    el: h('div', { class: 'screen pick', style: `--card:${MODE_INK[mode]}` },
      h('header', { class: 'top' },
        h('button', { class: 'back', 'aria-label': 'Back', onclick: () => app.go('#/') }, backArrow()),
        h('span', { class: 'where', text: MODE_NAME[mode] }),
        h('span', { class: 'spacer' }),
      ),
      grid,
    ),
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export class App {
  readonly solved = loadSolved();
  /**
   * The board on screen, for the end-to-end harness. It drives the game
   * through real pointer events; this only lets it see where the posts are.
   */
  board: Board | null = null;
  private current: Screen | null = null;

  constructor(private readonly root: HTMLElement) {
    addEventListener('hashchange', () => this.render());
    this.render();
  }

  go(hash: string): void {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  }

  markSolved(id: string): void {
    this.solved.add(id);
    saveSolved(this.solved);
  }

  private render(): void {
    this.current?.dispose?.();
    this.board = null;
    this.current = this.route();
    this.root.replaceChildren(this.current.el);
    scrollTo(0, 0);
  }

  private route(): Screen {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'm' && isMode(parts[1])) return pickScreen(this, parts[1]);
    if (parts[0] === 'p' && isMode(parts[1])) {
      const mode = parts[1];
      const n = Number(parts[2]);
      const list = BOARDS[mode];
      const i = Number.isFinite(n) && n >= 1 && n <= list.length ? n - 1 : 0;
      const board = list[i];
      this.board = board;
      return playScreen(board, {
        place: { index: i + 1, total: list.length },
        done: this.solved.has(board.id),
        onSolved: () => this.markSolved(board.id),
        onNext: () => this.go(i + 1 < list.length ? `#/p/${mode}/${i + 2}` : `#/m/${mode}`),
        onBack: () => this.go(`#/m/${mode}`),
      });
    }
    return homeScreen(this);
  }
}

function backArrow(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '22');
  s.setAttribute('height', '22');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M15 4 L7 12 L15 20');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.4');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}
