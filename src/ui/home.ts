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
import { miniature, sectionHeader, toast, themeSwatch, threadSwatch } from './components.js';
import { modeIcon, padlock } from './icons.js';
import { type App, MODE_ACCENT, MODE_BLURB, type Route } from './app.js';
import { MODE_UNLOCKS, solvedCount, collectionCount } from '../game/progress.js';
import { THEMES, SKINS, THREAD_COLORS } from '../render/theme.js';
import { themeUnlocked, skinUnlocked } from '../game/progress.js';
import { dailyLevel } from '../game/generate.js';
import { estimateDifficulty } from '../core/difficulty.js';
import { deriveTarget, type Level } from '../core/level.js';
import { dateKey } from '../core/rng.js';
import { ticker, easeInOut } from '../render/tween.js';
import { audio } from '../render/audio.js';
import { starPoints, ringPoints } from '../core/shapes.js';

export function homeScreen(app: App): { el: HTMLElement; dispose?: () => void } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, scroll);

  scroll.append(
    masthead(),
    continueCard(app),
    sectionHeader('Every day'),
    dailyRow(app),
    sectionHeader('Modes'),
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
  const lastMode = (app.save.lastPlayed?.mode === 'weave' ? 'weave' : 'classic') as 'classic' | 'weave';
  const level = app.nextLevel(lastMode);
  const chapterLevels = app.chapterLevels(lastMode, level.chapter);
  const idx = chapterLevels.findIndex((l) => l.id === level.id) + 1;
  const name = level.name ?? `Chapter ${level.chapter}`;
  const started = app.save.stats.solved > 0;

  return h('button', {
    class: 'continue',
    style: `--accent:${MODE_ACCENT[lastMode]}`,
    onclick: () => app.go({ name: 'play', mode: lastMode, levelId: level.id }),
  },
    h('div', { class: 'tile lg', style: 'background:var(--panel)' }, miniature(level, { showPegs: true })),
    h('div', { class: 'grow' },
      h('h3', { class: 'display', text: started ? 'Keep going' : 'Start playing' }),
      h('p', { text: `${lastMode === 'weave' ? 'Weave' : 'Classic'} · ${name}` }),
      h('p', { class: 'num', text: `Level ${idx} of ${chapterLevels.length}` }),
    ),
    h('span', { class: 'go', text: started ? 'Play' : 'Play' }),
  );
}

// ---------------------------------------------------------------------------
// 3. Daily
// ---------------------------------------------------------------------------

function dailyRow(app: App): HTMLElement {
  const key = dateKey();
  const level = dailyLevel(key);
  const rec = app.save.daily.history[key];
  const solved = rec?.solved ?? false;

  const tile = h('div', { class: 'tile', style: 'background:var(--daily-soft)' },
    solved ? miniature(level, { ink: 'var(--daily)' }) : modeIcon('daily'));

  // No server means no honest "% of players who solved it today", and inventing
  // one would be presenting a fabricated statistic as fact. How hard today's
  // puzzle is can be said truthfully, from the same estimator used everywhere.
  const band = difficultyBand(level);

  return h('button', {
    class: 'gamerow strip',
    onclick: () => app.go({ name: 'play', mode: 'daily' }),
  },
    tile,
    h('div', { class: 'grow' },
      h('h4', { class: 'display', text: 'Daily Thread' }),
      h('p', { text: solved ? `Solved · ${band}` : band }),
    ),
    h('span', { class: 'meta' },
      app.save.daily.streak > 0
        ? h('span', { class: 'streakpill' }, '◆', h('span', { class: 'num', text: String(app.save.daily.streak) }))
        : h('span', { text: solved ? 'Done' : 'New' }),
      h('span', { class: 'chev', text: '›' }),
    ),
  );
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
const HOME_ORDER = ['classic', 'weave', 'blitz', 'onelife', 'zen', 'assess', 'workshop'];

function modeList(app: App): HTMLElement {
  const unlocked = app.modes;
  const list = h('div', { class: 'list' });
  const rules = [...MODE_UNLOCKS].sort(
    (a, b) => HOME_ORDER.indexOf(a.id) - HOME_ORDER.indexOf(b.id),
  );

  for (const rule of rules) {
    const id = rule.id;
    if (id === 'daily') continue; // it has its own row
    const open = unlocked.has(id);
    const progress = progressFor(app, id);

    list.appendChild(h('button', {
      class: `gamerow modecard${open ? '' : ' locked'}`,
      onclick: () => {
        if (!open) {
          toast(rule.condition);
          return;
        }
        app.go(routeFor(id));
      },
    },
      h('div', { class: 'tile' }, modeIcon(id)),
      h('div', { class: 'grow' },
        h('h4', { class: 'display', text: rule.label }),
        h('p', { class: open ? '' : 'lockline', text: open ? MODE_BLURB[id] ?? '' : rule.condition }),
      ),
      h('span', { class: 'meta' },
        open ? h('span', { class: 'num', text: progress.text }) : padlock(),
        h('span', { class: 'chev', text: '›' }),
      ),
    ));
  }
  return list;
}

function routeFor(id: string): Route {
  if (id === 'classic' || id === 'weave') return { name: 'chapters', mode: id };
  if (id === 'assess') return { name: 'assess' };
  if (id === 'workshop') return { name: 'workshop' };
  return { name: 'play', mode: id };
}

function progressFor(app: App, id: string): { fraction: number; text: string } {
  if (id === 'classic' || id === 'weave') {
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
    const open = themeUnlocked(app.save, t.id, ctx);
    const on = app.save.settings.theme === t.id;
    row.appendChild(h('button', {
      class: `swatch${open ? '' : ' locked'}${on ? ' on' : ''}`,
      style: 'padding:0;overflow:hidden',
      title: open ? t.name : t.unlock,
      'aria-label': open ? `Theme ${t.name}` : `Locked: ${t.unlock}`,
      onclick: () => {
        if (!open) {
          toast(t.unlock);
          return;
        }
        app.save.settings.theme = t.id;
        app.applySettings();
        app.persist();
        app.go({ name: 'home' });
      },
    }, themeSwatch(t.board, t.thread, t.peg)));
  }

  for (let i = 0; i < SKINS.length; i++) {
    const sk = SKINS[i];
    const open = skinUnlocked(app.save, sk.id, ctx);
    const on = app.save.settings.skin === sk.id;
    row.appendChild(h('button', {
      class: `swatch${open ? '' : ' locked'}${on ? ' on' : ''}`,
      style: 'padding:0;overflow:hidden;background:var(--panel)',
      title: open ? sk.name : sk.unlock,
      'aria-label': open ? `Thread ${sk.name}` : `Locked: ${sk.unlock}`,
      onclick: () => {
        if (!open) {
          toast(sk.unlock);
          return;
        }
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

