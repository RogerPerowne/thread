/**
 * The library.
 *
 * This is the product, not a menu. It has a shape rather than a grid: one
 * featured puzzle that is allowed to be large and loud, then the rest of
 * today's games as a deck, then whatever was left half-done, then a way into
 * the archives. A wall of identical rectangles tells a player nothing about
 * what any of them is; a card with the mechanic moving on it tells them almost
 * everything before they have read a word.
 *
 * Every card is built from the register, so a sixth game appears here by being
 * registered and by nothing else.
 */

import { h } from '../platform/dom.js';
import { icon } from '../platform/ui/icons.js';
import { allGames, type AnyGame } from '../platform/registry.js';
import { dailyOf, longDate } from '../platform/daily.js';
import * as store from '../platform/store.js';
import { BAND_NAME, type Band, type Puzzle } from '../platform/types.js';

export type LibraryHooks = {
  open(gameId: string, puzzleId: string): void;
  archive(gameId: string): void;
};

type State = 'new' | 'going' | 'done';

function stateOf(game: AnyGame, puzzle: Puzzle<unknown>): State {
  if (store.isDone(game.meta.id, puzzle.id)) return 'done';
  return store.resumeOf(game.meta.id, puzzle.id) ? 'going' : 'new';
}

const STATE_WORD: Record<State, string> = { new: 'New', going: 'Continue', done: 'Solved' };

export function libraryScreen(hooks: LibraryHooks): { el: HTMLElement; dispose(): void } {
  const teardowns: (() => void)[] = [];
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const games = allGames();
  const featured = games[0];
  const rest = games.slice(1);

  /** One card. `big` is the featured treatment. */
  function card(game: AnyGame, big: boolean): HTMLElement {
    const puzzle = dailyOf(game);
    const state = puzzle ? stateOf(game, puzzle) : 'new';
    const stats = store.statsOf(game.meta.id);
    const done = puzzle ? store.isDone(game.meta.id, puzzle.id) : false;
    const time = puzzle && done ? store.clock(store.statsOf(game.meta.id).best ?? 0) : null;

    const mini = h('div', { class: 'mini' });
    const facts = h('div', { class: 'facts' },
      h('span', { class: `state ${state === 'done' ? 'done' : ''}` },
        state === 'done' ? icon.tick() : null,
        h('span', { text: done && time ? `${STATE_WORD[state]} ${time}` : STATE_WORD[state] })),
      puzzle ? h('span', { class: 'band', text: BAND_NAME[puzzle.band as Band] }) : null,
      stats.streak > 1
        ? h('span', { class: 'state' }, icon.flame(), h('span', { text: `${stats.streak}` }))
        : null,
    );

    const body = h('div', { class: big ? 'body' : '' },
      h('div', { class: 'name display', text: game.meta.name }),
      h('div', { class: 'blurb', text: game.meta.tagline }),
      facts,
    );

    const el = h('button', {
      class: `card game chrome${big ? ' feature' : ''}`,
      type: 'button',
      'data-card': game.meta.id,
      'aria-label': `${game.meta.name}. ${game.meta.tagline} ${STATE_WORD[state]}.`,
      onclick: () => { if (puzzle) hooks.open(game.meta.id, puzzle.id); },
    }, big ? mini : body, big ? body : mini);

    const family = game.meta.accent.replace(/^a-/, '');
    el.style.setProperty('--accent', `var(--${game.meta.accent})`);
    el.style.setProperty('--tint', `var(--t-${family})`);
    el.style.setProperty('--card', `var(--c-${family})`);
    teardowns.push(game.miniature(mini, still));
    return el;
  }

  // --- what is half-done ---------------------------------------------------
  const going: HTMLElement[] = [];
  for (const game of games) {
    for (const id of store.unfinished(game.meta.id)) {
      const puzzle = game.puzzles().find((p) => p.id === id);
      if (!puzzle) continue;
      going.push(h('button', {
        class: 'card chrome',
        type: 'button',
        'data-continue': `${game.meta.id}/${id}`,
        onclick: () => hooks.open(game.meta.id, id),
      },
        h('div', {},
          h('div', { class: 'name display', style: 'font-size:var(--t-lg)', text: game.meta.name }),
          h('div', { class: 'blurb', text: `Part way through ${labelOf(game, puzzle)}` }),
        ),
        icon.next(),
      ));
    }
  }

  const el = h('div', { class: 'screen scrolls library' },
    h('header', { class: 'masthead' },
      h('div', { class: 'wordmark', text: 'Puzzles' }),
      h('div', { class: 'date', text: longDate() }),
    ),

    h('section', { class: 'section' },
      h('div', { class: 'label', text: 'Today' }),
      h('div', { class: 'deck' },
        featured ? card(featured, true) : null,
        ...rest.map((g) => card(g, false)),
      ),
    ),

    going.length > 0
      ? h('section', { class: 'section' },
        h('div', { class: 'label', text: 'Continue' }),
        h('div', { class: 'deck' }, ...going),
      )
      : null,

    h('section', { class: 'section' },
      h('div', { class: 'label', text: 'All puzzles' }),
      h('div', { class: 'deck' }, ...games.map((game) => {
        const total = game.puzzles().length;
        const solved = store.doneCount(game.meta.id);
        const el = h('button', {
          class: 'card chrome',
          type: 'button',
          'data-archive': game.meta.id,
          'aria-label': `${game.meta.name} archive, ${solved} of ${total} solved`,
          onclick: () => hooks.archive(game.meta.id),
        },
          h('div', {},
            h('div', { class: 'name display', style: 'font-size:var(--t-lg)', text: game.meta.name }),
            h('div', { class: 'blurb num', text: `${solved} of ${total} solved` }),
          ),
          icon.stack(),
        );
        el.style.setProperty('--accent', `var(--${game.meta.accent})`);
        return el;
      })),
    ),
  );

  return {
    el,
    dispose() { for (const stop of teardowns) stop(); },
  };
}

/** "No. 14" — a puzzle's place in its own game. */
export function labelOf(game: AnyGame, puzzle: Puzzle<unknown>): string {
  const at = game.puzzles().findIndex((p) => p.id === puzzle.id);
  return at < 0 ? puzzle.id : `No. ${at + 1}`;
}
