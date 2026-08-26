/**
 * The app: three routes, and each one is a place.
 *
 *   #/                    the library
 *   #/g/<game>            that game's whole ladder
 *   #/g/<game>/<puzzle>   playing one
 *
 * Back always goes up exactly one level, and the hash is the truth — a route
 * typed into the bar, a reload, and a press of the back button all land in the
 * same state, because there is only one path in.
 */

import { h } from './dom.js';
import { gameById, allGames } from './registry.js';
import { libraryScreen, labelOf } from '../library/library.js';
import { archiveScreen } from '../library/archive.js';
import { gameFrame } from './ui/frame.js';
import type { Puzzle } from './types.js';

type Screen = { el: HTMLElement; dispose(): void };

export class App {
  private current: Screen | null = null;

  constructor(private readonly root: HTMLElement) {
    window.addEventListener('hashchange', () => this.route());
    this.route();
  }

  private go(hash: string): void {
    if (location.hash === hash) this.route();
    else location.hash = hash;
  }

  private show(screen: Screen): void {
    this.current?.dispose();
    this.current = screen;
    this.root.replaceChildren(screen.el);
    /*
     * A new place starts at its top. Without this a tall archive keeps the
     * scroll position of the library it replaced, which reads as the app
     * having lost its place.
     */
    screen.el.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  private route(): void {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

    if (parts[0] === 'g' && parts[1]) {
      const game = gameById(parts[1]);
      if (!game) { this.go('#/'); return; }

      if (parts[2]) {
        const puzzles = game.puzzles();
        const at = puzzles.findIndex((p) => p.id === parts[2]);
        if (at < 0) { this.go(`#/g/${game.meta.id}`); return; }
        const puzzle: Puzzle<unknown> = puzzles[at];
        const next = puzzles[at + 1] ?? null;
        this.show(gameFrame(game, puzzle, {
          label: labelOf(game, puzzle),
          next,
          onBack: () => this.go(`#/g/${game.meta.id}`),
          onNext: () => { if (next) this.go(`#/g/${game.meta.id}/${next.id}`); },
        }));
        return;
      }

      this.show(archiveScreen(game, {
        onBack: () => this.go('#/'),
        open: (id) => this.go(`#/g/${game.meta.id}/${id}`),
      }));
      return;
    }

    this.show(libraryScreen({
      open: (gameId, puzzleId) => this.go(`#/g/${gameId}/${puzzleId}`),
      archive: (gameId) => this.go(`#/g/${gameId}`),
    }));
  }
}

/**
 * A read-only handle for the end-to-end harness.
 *
 * It reads state and decides nothing. Everything the tests actually do — open
 * a puzzle, lay a string, press Undo — goes through real pointer events on
 * real elements, because a test that calls into the app proves the rules work
 * and nothing at all about whether the game is playable.
 */
export function testHandle(): unknown {
  return {
    games: () => allGames().map((g) => g.meta.id),
    puzzles: (id: string) => gameById(id)?.puzzles().map((p) => p.id) ?? [],
    puzzle: (id: string, pid: string) => gameById(id)?.puzzles().find((p) => p.id === pid) ?? null,
  };
}

export { h };
