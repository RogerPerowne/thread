/**
 * One game's whole ladder.
 *
 * A chip per puzzle, grouped by band, numbered rather than named — a hundred
 * and ninety titles would be a hundred and ninety things to read and none of
 * them would help. The chip says three things at a glance: where it sits, and
 * whether it is solved, started, or untouched.
 */

import { h } from '../platform/dom.js';
import { iconButton } from '../platform/ui/components.js';
import * as store from '../platform/store.js';
import { BANDS, BAND_NAME, type Band } from '../platform/types.js';
import type { AnyGame } from '../platform/registry.js';

export function archiveScreen(
  game: AnyGame, hooks: { onBack(): void; open(puzzleId: string): void },
): { el: HTMLElement; dispose(): void } {
  const puzzles = game.puzzles();
  const stats = store.statsOf(game.meta.id);

  const groups = BANDS.map((band) => {
    const inBand = puzzles
      .map((p, i) => ({ p, n: i + 1 }))
      .filter(({ p }) => p.band === band);
    if (inBand.length === 0) return null;
    return h('section', { class: 'section' },
      h('div', { class: 'label', text: BAND_NAME[band as Band] }),
      h('div', { class: 'chips' }, ...inBand.map(({ p, n }) => {
        const done = store.isDone(game.meta.id, p.id);
        const going = !done && Boolean(store.resumeOf(game.meta.id, p.id));
        return h('button', {
          class: `chip chrome num${done ? ' done' : ''}${going ? ' going' : ''}`,
          type: 'button',
          'data-puzzle': p.id,
          'aria-label': `Puzzle ${n}, ${done ? 'solved' : going ? 'in progress' : 'not started'}`,
          text: String(n),
          onclick: () => hooks.open(p.id),
        });
      })),
    );
  }).filter(Boolean);

  const el = h('div', { class: 'screen scrolls' },
    h('div', { class: 'gamebar chrome' },
      iconButton('back', 'Back to Games', () => hooks.onBack()),
      h('div', { class: 'middle' },
        h('div', { class: 'title', text: game.meta.name }),
        h('div', { class: 'sub' },
          h('span', { class: 'num', text: `${stats.solved} of ${puzzles.length} solved` }),
        ),
      ),
      h('div', { class: 'right' }),
    ),
    ...groups,
  );
  el.style.setProperty('--accent', `var(--${game.meta.accent})`);
  return { el, dispose() { /* nothing running */ } };
}
