/**
 * Home.
 *
 * Laid out the way the NYT Games app is: a masthead, then the thing you were
 * last playing as a single featured card, then every other mode as a row with
 * a soft coloured icon tile, a slab-serif title and one line of plain English.
 * Locked rows say what unlocks them rather than hiding — a visible goal is
 * worth more than a mystery.
 */

import { h, svg } from './dom.js';
import { miniature, sectionHeader, themeSwatch, threadSwatch, gameCard } from './components.js';
import { modeMark } from './icons.js';
import { type App, MODE_BLURB, MODE_TITLE, type Route, isChapterMode, type ChapterMode } from './app.js';
import { modeColor, chapterColor } from './palette.js';
import { MODE_UNLOCKS, solvedCount, collectionCount } from '../game/progress.js';
import { THEMES, SKINS, THREAD_COLORS } from '../render/theme.js';
import { dailyLevel } from '../game/generate.js';
import { estimateDifficulty } from '../core/difficulty.js';
import { deriveTarget, objectiveOf, type Level } from '../core/level.js';
import { dateKey } from '../core/rng.js';
import { ticker, easeInOut } from '../render/tween.js';
import { audio } from '../render/audio.js';
import { starPoints, ringPoints } from '../core/shapes.js';

export function homeScreen(app: App): { el: HTMLElement; dispose?: () => void } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, scroll);

  scroll.append(
    masthead(),
    h('div', { class: 'cardlist' }, continueCard(app), dailyCard(app)),
    sectionHeader('Ways to play'),
    modeList(app),
    sectionHeader('Collection', { text: 'Stats', onClick: () => app.go({ name: 'stats' }) }),
    collectionRow(app),
    h('p', { class: 'note', text: 'Everything stays on this device. No account, no ads, no tracking.' }),
  );

  return { el, dispose: () => ticker.cancelAll() };
}

// ---------------------------------------------------------------------------
// 1. Masthead — the game quietly demonstrating itself
// ---------------------------------------------------------------------------

function masthead(): HTMLElement {
  const board = h('div', { class: 'hero-board' });
  // Stretched to the masthead's own proportions: a square sliced into a wide
  // band shows almost nothing of the loop.
  const root = svg('svg', {
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const pegs = ringPoints(7, 40);
  for (const [x, y] of pegs) {
    root.appendChild(svg('ellipse', { cx: x, cy: y, rx: 0.9, ry: 2.4, fill: 'currentColor' }));
  }
  const path = svg('path', {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.3,
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
  });
  root.appendChild(path);
  board.appendChild(root);

  // A string idly wrapping and unwrapping a star, on a slow loop.
  const star = starPoints(7, 3, 40);
  const total = star.length;
  let forward = true;

  const draw = (v: number) => {
    const clamped = Math.max(0, Math.min(total, v));
    const n = Math.floor(clamped);
    const frac = clamped - n;
    if (clamped < 0.015) {
      path.setAttribute('d', '');
      return;
    }
    let d = `M${star[0][0].toFixed(1)} ${star[0][1].toFixed(1)}`;
    for (let i = 1; i <= n && i < total; i++) d += `L${star[i][0].toFixed(1)} ${star[i][1].toFixed(1)}`;
    if (n < total && frac > 0) {
      const a = star[n % total];
      const b = star[(n + 1) % total];
      d += `L${(a[0] + (b[0] - a[0]) * frac).toFixed(1)} ${(a[1] + (b[1] - a[1]) * frac).toFixed(1)}`;
    }
    if (n >= total) d += 'Z';
    path.setAttribute('d', d);
  };

  const loop = () => {
    ticker.add({
      from: forward ? 0 : total,
      to: forward ? total : 0,
      dur: 5600,
      ease: easeInOut,
      onUpdate: draw,
      onDone: () => {
        forward = !forward;
        ticker.after(1000, loop);
      },
    });
  };
  loop();
  ticker.requestFrame();

  return h('div', {
    class: 'masthead',
    onclick: () => audio.pluckIdle(),
    role: 'img',
    'aria-label': 'Thread',
  },
    board,
    h('div', { class: 'kicker', text: today() }),
    h('h1', { class: 'wordmark display', text: 'THREAD' }),
    h('div', { class: 'hero-sub', text: 'One string. Close the loop. Match the shape.' }),
  );
}

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// 2. Continue — the single most important element on the screen
// ---------------------------------------------------------------------------

function continueCard(app: App): HTMLElement {
  const last = app.save.lastPlayed?.mode ?? '';
  const lastMode: ChapterMode = isChapterMode(last) ? last : 'classic';
  const level = app.nextLevel(lastMode);
  const chapterLevels = app.chapterLevels(lastMode, level.chapter);
  const idx = chapterLevels.findIndex((l) => l.id === level.id) + 1;
  const name = level.name ?? `Chapter ${level.chapter}`;
  const started = app.save.stats.solved > 0;

  return gameCard({
    id: 'continue',
    color: chapterColor(lastMode, level.chapter),
    title: started ? 'Keep going' : 'Start playing',
    blurb: `${MODE_TITLE[lastMode] ?? lastMode} \u00b7 ${name}`,
    foot: `Level ${idx} of ${chapterLevels.length}`,
    note: started ? `${app.save.stats.solved} solved` : 'From the beginning',
    // Continue can land on a corral or a clue board, whose shape is the
    // answer. Those get their mode's mark rather than a spoiler.
    art: revealsShape(level)
      ? miniature(level, { ink: 'var(--card-ink)', mono: true })
      : modeMark(lastMode, 'var(--card-ink)'),
    onOpen: () => app.go({ name: 'play', mode: lastMode, levelId: level.id }),
  });
}

// ---------------------------------------------------------------------------
// 3. Daily
// ---------------------------------------------------------------------------

function dailyCard(app: App): HTMLElement {
  const key = dateKey();
  const level = dailyLevel(key);
  const rec = app.save.daily.history[key];
  const solved = rec?.solved ?? false;

  // No server means no honest "% of players who solved it today", and inventing
  // one would be presenting a fabricated statistic as fact. How hard today's
  // puzzle is can be said truthfully, from the same estimator used everywhere.
  const streak = app.save.daily.streak;

  return gameCard({
    id: 'daily',
    color: modeColor('daily'),
    title: 'Daily Thread',
    blurb: solved ? `Solved. ${difficultyBand(level)}.` : `${difficultyBand(level)}.`,
    foot: today(),
    note: streak > 0 ? `${streak} day streak` : solved ? 'Done' : 'Same for everyone',
    art: solved ? miniature(level, { ink: 'var(--card-ink)', mono: true }) : modeMark('daily', 'var(--card-ink)'),
    onOpen: () => app.go({ name: 'play', mode: 'daily' }),
  });
}

/** Does this level put its answer on screen anyway? */
function revealsShape(level: Level): boolean {
  const k = objectiveOf(level).kind;
  return k === 'shape' || k === 'silhouette' || k === 'par';
}

/** An honest read on today's puzzle, from the static difficulty estimator. */
function difficultyBand(level: Level): string {
  const b = estimateDifficulty(level, deriveTarget(level).raster).b;
  if (b < -1.2) return 'A gentle one today';
  if (b < -0.2) return 'A fair one today';
  if (b < 0.8) return 'A bit of a knot today';
  if (b < 1.8) return 'A hard one today';
  return 'A brute today';
}

// ---------------------------------------------------------------------------
// 4. Modes
// ---------------------------------------------------------------------------

/** The order they are meant to be met in, not the order the rules are written. */
const HOME_ORDER = [
  'classic', 'shadow', 'par', 'corral', 'wire',
  'weave', 'blitz', 'onelife', 'zen', 'assess', 'workshop',
];

function modeList(app: App): HTMLElement {
  const list = h('div', { class: 'cardlist' });
  const rules = [...MODE_UNLOCKS].sort(
    (a, b) => HOME_ORDER.indexOf(a.id) - HOME_ORDER.indexOf(b.id),
  );

  for (const rule of rules) {
    const id = rule.id;
    if (id === 'daily') continue; // it has a card of its own
    const progress = progressFor(app, id);

    list.appendChild(gameCard({
      id,
      color: modeColor(id),
      title: rule.label,
      blurb: MODE_BLURB[id] ?? '',
      foot: progress.text,
      art: modeMark(id, 'var(--card-ink)'),
      onOpen: () => app.go(routeFor(id)),
    }));
  }
  return list;
}

function routeFor(id: string): Route {
  if (isChapterMode(id)) return { name: 'chapters', mode: id };
  if (id === 'assess') return { name: 'assess' };
  if (id === 'workshop') return { name: 'workshop' };
  return { name: 'play', mode: id };
}

function progressFor(app: App, id: string): { fraction: number; text: string } {
  if (isChapterMode(id)) {
    const ids = app.levelsFor(id).map((l) => l.id);
    const done = solvedCount(app.save, ids);
    return { fraction: done / Math.max(ids.length, 1), text: `${done}/${ids.length}` };
  }
  if (id === 'blitz') return { fraction: Math.min(1, app.save.stats.blitzBest / 25), text: app.save.stats.blitzBest ? `Best ${app.save.stats.blitzBest}` : '' };
  if (id === 'onelife') return { fraction: Math.min(1, app.save.stats.oneLifeBest / 25), text: app.save.stats.oneLifeBest ? `Best ${app.save.stats.oneLifeBest}` : '' };
  if (id === 'zen') return { fraction: Math.min(1, app.save.stats.zenSolved / 50), text: app.save.stats.zenSolved ? `${app.save.stats.zenSolved}` : '' };
  if (id === 'assess') {
    const last = app.save.assess.history.at(-1);
    return { fraction: last ? 1 : 0, text: last ? String(last.score) : '' };
  }
  if (id === 'workshop') return { fraction: 0, text: app.save.workshop.length ? `${app.save.workshop.length}` : '' };
  return { fraction: 0, text: '' };
}

// ---------------------------------------------------------------------------
// 5. Collection
// ---------------------------------------------------------------------------

function collectionRow(app: App): HTMLElement {
  const ctx = app.unlockCtx;
  const { have, total } = collectionCount(app.save, ctx);
  const row = h('div', { class: 'collection' });

  for (const t of THEMES) {
    const on = app.save.settings.theme === t.id;
    row.appendChild(h('button', {
      class: `swatch${on ? ' on' : ''}`,
      style: 'padding:0;overflow:hidden',
      title: t.name,
      'aria-label': `Theme ${t.name}`,
      onclick: () => {
        app.save.settings.theme = t.id;
        app.applySettings();
        app.persist();
        app.go({ name: 'home' });
      },
    }, themeSwatch(t.board, t.thread, t.peg)));
  }

  for (let i = 0; i < SKINS.length; i++) {
    const sk = SKINS[i];
    const on = app.save.settings.skin === sk.id;
    row.appendChild(h('button', {
      class: `swatch${on ? ' on' : ''}`,
      style: 'padding:0;overflow:hidden;background:var(--panel)',
      title: sk.name,
      'aria-label': `Thread ${sk.name}`,
      onclick: () => {
        app.save.settings.skin = sk.id;
        app.persist();
        app.go({ name: 'home' });
      },
    }, threadSwatch(THREAD_COLORS[i % THREAD_COLORS.length], sk.dash, sk.weight, sk.cap)));
  }

  row.appendChild(h('span', {
    class: 'label num',
    style: 'align-self:center;padding-left:4px;white-space:nowrap',
    text: `${have}/${total}`,
  }));
  return row;
}

