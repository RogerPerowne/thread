/**
 * The app: what boards exist, what has been solved, and which screen is on.
 *
 * Four routes, and each one is a place rather than a state: home, a mode's
 * chapters, a chapter's path, a board. The back button always goes up one.
 */

import { playScreen } from './playscreen.js';
import { homeScreen, chaptersScreen, pathScreen, type Screen } from './screens.js';
import { cancelEnter } from './enter.js';
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
  classic: 'One string, and every post on the board.',
  coloured: 'Several strings, each to its own two ends.',
  grid: 'A lattice, filled corner to corner.',
};

export const CHAPTER_NAMES: Record<Mode, string[]> = {
  classic: ['First Nine', 'Wider', 'Sixteen', 'Twenty', 'Twenty-Five', 'The Long Way'],
  coloured: ['Two Strings', 'Sharing', 'Three Strings', 'Crowded', 'Four Strings'],
  grid: [
    'The Lattice', 'Twenty', 'Five Square', 'Thirty', 'Thirty-Six', 'Forty-Two',
    'Seven Square', 'Fifty-Six',
  ],
};

const isMode = (v: string): v is Mode => (MODES as readonly string[]).includes(v);

/** The chapter numbers a mode actually has, in order. */
export function chaptersOf(mode: Mode): number[] {
  const seen = new Set<number>();
  for (const b of BOARDS[mode]) seen.add(b.chapter);
  return [...seen].sort((a, b) => a - b);
}

/** The boards of one chapter, in their shipped order. */
export function boardsIn(app: App, mode: Mode, chapter: number): Board[] {
  void app;
  return BOARDS[mode].filter((b) => b.chapter === chapter);
}

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
// App
// ---------------------------------------------------------------------------

export class App {
  readonly solved = loadSolved();
  readonly boards = BOARDS;
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  /** A board's 1-based place in its whole mode, which is what the URL uses. */
  indexOf(board: Board): number {
    return BOARDS[board.mode as Mode].indexOf(board) + 1;
  }

  private render(): void {
    cancelEnter();
    this.current?.dispose?.();
    this.board = null;
    this.current = this.route();
    this.root.replaceChildren(this.current.el);
    scrollTo(0, 0);
  }

  private route(): Screen {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

    if (parts[0] === 'm' && isMode(parts[1])) return chaptersScreen(this, parts[1]);

    if (parts[0] === 'c' && isMode(parts[1])) {
      const mode = parts[1];
      const chapters = chaptersOf(mode);
      const ch = Number(parts[2]);
      return pathScreen(this, mode, chapters.includes(ch) ? ch : chapters[0]);
    }

    if (parts[0] === 'p' && isMode(parts[1])) {
      const mode = parts[1];
      const list = BOARDS[mode];
      const n = Number(parts[2]);
      const i = Number.isFinite(n) && n >= 1 && n <= list.length ? n - 1 : 0;
      const board = list[i];
      this.board = board;
      return playScreen(board, {
        place: { index: i + 1, total: list.length },
        chapter: `${MODE_NAME[mode]} · ${CHAPTER_NAMES[mode][board.chapter - 1] ?? ''}`,
        done: this.solved.has(board.id),
        onSolved: () => this.markSolved(board.id),
        onNext: () => {
          const next = list[i + 1];
          if (next && next.chapter === board.chapter) this.go(`#/p/${mode}/${i + 2}`);
          else this.go(`#/c/${mode}/${board.chapter}`);
        },
        onBack: () => this.go(`#/c/${mode}/${board.chapter}`),
      });
    }

    return homeScreen(this);
  }
}
