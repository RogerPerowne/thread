/**
 * The screens around the board: home, a mode's chapters, and a chapter's path.
 *
 * The register is the New York Times games list — a masthead, then full-bleed
 * cards in one saturated colour with black type on them. The colour does the
 * work of an icon: you learn a chapter by its colour long before you read its
 * name.
 *
 * The path screen is the isometric one: levels as tiles standing on a ribbon
 * that meanders away from you, first level at the bottom, and you climb.
 */

import { h } from './dom.js';
import { topBar, gameCard, sectionHeader } from './components.js';
import { chapterPath, type PathNode, type PathView } from './path.js';
import { modeColor, chapterColor } from './palette.js';
import { modeMark } from './icons.js';
import { enterLevel } from './enter.js';
import type { App, Mode } from './shell.js';
import { MODES, MODE_NAME, MODE_LINE, CHAPTER_NAMES, boardsIn, chaptersOf } from './shell.js';

export type Screen = { el: HTMLElement; dispose?(): void };

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export function homeScreen(app: App): Screen {
  const list = h('div', { class: 'cardlist' });

  for (const mode of MODES) {
    const all = app.boards[mode];
    const done = all.filter((b) => app.solved.has(b.id)).length;
    list.appendChild(gameCard({
      id: mode,
      color: modeColor(mode),
      title: MODE_NAME[mode],
      blurb: MODE_LINE[mode],
      foot: `${done} of ${all.length}`,
      note: done === all.length ? 'All done' : `${chaptersOf(mode).length} chapters`,
      art: modeMark(mode, 'var(--card-ink)'),
      onOpen: () => app.go(`#/m/${mode}`),
    }));
  }

  const el = h('div', { class: 'screen home' },
    h('header', { class: 'masthead' },
      h('h1', { class: 'wordmark', text: 'THREAD' }),
      h('p', { class: 'hero-sub', text: 'Use every post. Never touch.' }),
    ),
    h('div', { class: 'scroll' }, sectionHeader('Ways to play'), list),
  );
  return { el };
}

// ---------------------------------------------------------------------------
// A mode's chapters
// ---------------------------------------------------------------------------

export function chaptersScreen(app: App, mode: Mode): Screen {
  const list = h('div', { class: 'cardlist' });

  for (const ch of chaptersOf(mode)) {
    const boards = boardsIn(app, mode, ch);
    const done = boards.filter((b) => app.solved.has(b.id)).length;
    const posts = boards[0]?.posts.length ?? 0;
    const strings = boards[0]?.strands.length ?? 1;
    list.appendChild(gameCard({
      id: `chapter-${ch}`,
      color: chapterColor(mode, ch),
      title: CHAPTER_NAMES[mode][ch - 1] ?? `Chapter ${ch}`,
      blurb: `${posts} posts${strings > 1 ? `, ${strings} strings` : ''}`,
      foot: `Chapter ${ch}`,
      note: `${done} of ${boards.length}`,
      art: modeMark(mode, 'var(--card-ink)'),
      onOpen: () => app.go(`#/c/${mode}/${ch}`),
    }));
  }

  const el = h('div', { class: 'screen chapterlist' },
    topBar(MODE_NAME[mode], { onBack: () => app.go('#/') }),
    h('div', { class: 'scroll' }, list),
  );
  return { el };
}

// ---------------------------------------------------------------------------
// A chapter, as a path you climb
// ---------------------------------------------------------------------------

export function pathScreen(app: App, mode: Mode, chapter: number): Screen {
  const boards = boardsIn(app, mode, chapter);
  const color = chapterColor(mode, chapter);
  const name = CHAPTER_NAMES[mode][chapter - 1] ?? `Chapter ${chapter}`;

  let view: PathView;
  let firstUnsolved = true;

  const nodes: PathNode[] = boards.map((board, i) => {
    const solved = app.solved.has(board.id);
    const isNext = !solved && firstUnsolved;
    if (!solved) firstUnsolved = false;
    return {
      label: `Level ${i + 1}`,
      sub: isNext ? 'Play' : undefined,
      stars: solved ? 3 : 0,
      state: solved ? 'done' : isNext ? 'next' : 'ahead',
      onOpen: () => enterLevel({
        view,
        index: i,
        color,
        eyebrow: `${MODE_NAME[mode]} · ${name}`,
        title: `Level ${i + 1}`,
        board,
        reducedMotion: app.reducedMotion,
        onArrive: () => app.go(`#/p/${mode}/${app.indexOf(board)}`),
      }),
    };
  });

  view = chapterPath(nodes, color);

  const scroll = h('div', { class: 'scroll' }, view.el);
  const el = h('div', { class: 'screen chapterscreen path', style: `--card:${color}` },
    h('header', { class: 'chapterhead' },
      h('button', {
        class: 'iconbtn back', 'aria-label': 'Back',
        onclick: () => app.go(`#/m/${mode}`),
      }, backArrow()),
      h('div', { class: 'headtext' },
        h('span', { class: 'label', text: `${MODE_NAME[mode]} · Chapter ${chapter}` }),
        h('h1', { class: 'display', text: name }),
      ),
    ),
    scroll,
  );

  // Land on the level you are up to rather than at the bottom of the chapter.
  requestAnimationFrame(() => view.scrollToCurrent('auto'));

  return { el, dispose: () => view.reset() };
}

function backArrow(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '22');
  s.setAttribute('height', '22');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M15 5 L8 12 L15 19');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  s.appendChild(p);
  return s;
}
