/**
 * One chapter's thirty levels, as a grid.
 *
 * The path screen answers "where am I in this game"; this answers "which of
 * these thirty do I want". They are different questions and a path is the
 * wrong shape for the second one — five hundred tiles on a meander is a
 * journey you cannot scan, and a grid of thirty is one you take in at a
 * glance.
 *
 * Every tile is coloured by its BAND, which is a measured thing: how much
 * deduction the board actually takes, worked out by the game's own analyser
 * when the board was built. So the grid is a picture of the chapter's shape —
 * pale at the top left, dark at the bottom right — and where the step up
 * inside a chapter happens is something you can see before you press anything.
 */

import { h } from '../platform/dom.js';
import { iconButton } from '../platform/ui/components.js';
import { icon } from '../platform/ui/icons.js';
import * as store from '../platform/store.js';
import { BAND_NAME, BANDS, type Band, type Puzzle } from '../platform/types.js';
import type { AnyGame } from '../platform/registry.js';

export type LevelHooks = {
  onBack(): void;
  open(puzzleId: string): void;
};

/** Which step of the ramp a band is, 1..4. */
function rung(band: Band): number {
  const at = BANDS.indexOf(band);
  return at < 0 ? 1 : at + 1;
}

export function levelScreen(
  game: AnyGame, chapterAt: number, hooks: LevelHooks,
): { el: HTMLElement; dispose(): void } {
  const gid = game.meta.id;
  const chapters = game.chapters();
  const chapter = chapters[chapterAt];
  const all = game.puzzles();

  /*
   * Where the player is, across the WHOLE game rather than this chapter: the
   * first puzzle they have not finished. A chapter you have already been past
   * should not light one of its levels as if it were still waiting for you.
   */
  const nowId = all.find((p) => !store.isDone(gid, p.id))?.id ?? null;
  const numberOf = new Map(all.map((p, i) => [p.id, i + 1]));
  const done = chapter.puzzles.filter((p) => store.isDone(gid, p.id)).length;

  const grid = h('div', { class: 'levelgrid', role: 'list' });
  chapter.puzzles.forEach((p: Puzzle<unknown>, i) => {
    const isDone = store.isDone(gid, p.id);
    const going = !isDone && Boolean(store.resumeOf(gid, p.id));
    const state = isDone ? 'done' : p.id === nowId ? 'now' : going ? 'going' : 'ahead';
    const tile = h('button', {
      class: `level b${rung(p.band as Band)} ${state}`,
      type: 'button',
      role: 'listitem',
      'data-puzzle': p.id,
      'aria-label': `Level ${i + 1}, ${BAND_NAME[p.band as Band]}`
        + `${isDone ? ', solved' : going ? ', in progress' : ''}`,
      onclick: () => hooks.open(p.id),
    }, h('span', { class: 'n num', text: String(i + 1) }));
    /* A tick as well as the fill, because the fill is saying the band and one
       mark cannot honestly say two things. */
    if (isDone) tile.appendChild(h('i', { class: 'tick' }, icon.tick()));
    grid.appendChild(tile);
  });

  /*
   * The key. Four swatches in the ramp's own order, so the grid can be read
   * without anyone having played a level of it first — and so the ramp is
   * plainly a ramp rather than four colours somebody liked.
   */
  const key = h('div', { class: 'levelkey', 'aria-hidden': 'true' },
    ...BANDS.map((b) => h('span', { class: `swatch b${rung(b)}` },
      h('i'), h('span', { text: BAND_NAME[b] }))));

  const first = chapter.puzzles[0];
  const el = h('div', { class: 'screen fixed levels' },
    h('div', { class: 'gamebar chrome' },
      iconButton('back', `Back to ${game.meta.name}`, () => hooks.onBack()),
      h('div', { class: 'middle' },
        h('div', { class: 'title', text: chapter.name }),
        h('div', { class: 'sub' },
          h('span', { text: `Chapter ${chapterAt + 1}` }),
          h('span', { class: 'dot', text: `${done} of ${chapter.puzzles.length} solved` }),
        ),
      ),
      h('div', { class: 'right' }),
    ),
    h('div', { class: 'levelwrap' }, grid, key),
  );
  el.style.setProperty('--accent', `var(--${game.meta.accent})`);

  /* Where the number sits in the whole game, for anyone who wants it. */
  if (first) el.dataset.from = String(numberOf.get(first.id) ?? 1);

  return { el, dispose() { el.remove(); } };
}
