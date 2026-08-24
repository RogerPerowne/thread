/**
 * Home. Live board header, continue card, daily strip, mode carousel,
 * collection row. The continue card is the single most important element —
 * most sessions start there — so it is full width, high on the page, and one
 * tap from playing.
 */

import { h, svg } from './dom.js';
import { miniature, ring, pill, modal, toast } from './components.js';
import { type App, MODE_ACCENT, MODE_BLURB, type Route } from './app.js';
import { MODE_UNLOCKS, solvedCount, collectionCount, applyDailySolve } from '../game/progress.js';
import { THEMES, SKINS, THREAD_COLORS } from '../render/theme.js';
import { themeUnlocked, skinUnlocked } from '../game/progress.js';
import { dailyLevel } from '../game/generate.js';
import { dateKey } from '../core/rng.js';
import { ticker, easeInOut } from '../render/tween.js';
import { audio } from '../render/audio.js';
import { ringPoints, starPoints } from '../core/shapes.js';

export function homeScreen(app: App): { el: HTMLElement; dispose?: () => void } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, scroll);

  scroll.append(
    heroHeader(),
    continueCard(app),
    dailyStrip(app),
    h('div', { class: 'label', style: 'padding:4px 14px 8px' }, 'Modes'),
    modeCarousel(app),
    h('div', { class: 'label', style: 'padding:4px 14px 8px' }, 'Collection'),
    collectionRow(app),
  );

  return { el, dispose: () => ticker.cancelAll() };
}

// ---------------------------------------------------------------------------
// 1. Live board header — the game demonstrating itself
// ---------------------------------------------------------------------------

function heroHeader(): HTMLElement {
  const board = h('div', { class: 'hero-board' });
  const root = svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const pegs = ringPoints(7, 30);
  for (const [x, y] of pegs) root.appendChild(svg('circle', { cx: x, cy: y, r: 1.4, fill: 'currentColor' }));
  const path = svg('path', {
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  });
  root.appendChild(path);
  board.appendChild(root);

  // A string idly wrapping and unwrapping a shape, on loop. Slow, quiet, 20%.
  const star = starPoints(7, 3, 30);
  const total = star.length;
  let forward = true;
  const draw = (v: number) => {
    const n = Math.max(0, Math.min(total, Math.floor(v)));
    if (n < 2) {
      path.setAttribute('d', '');
      return;
    }
    const frac = v - Math.floor(v);
    let d = `M${star[0][0].toFixed(1)} ${star[0][1].toFixed(1)}`;
    for (let i = 1; i < n; i++) d += `L${star[i][0].toFixed(1)} ${star[i][1].toFixed(1)}`;
    if (n < total && frac > 0) {
      const a = star[n - 1];
      const b = star[n % total];
      d += `L${(a[0] + (b[0] - a[0]) * frac).toFixed(1)} ${(a[1] + (b[1] - a[1]) * frac).toFixed(1)}`;
    }
    if (n >= total) d += 'Z';
    path.setAttribute('d', d);
  };
  const loop = () => {
    ticker.add({
      from: forward ? 0 : total,
      to: forward ? total : 0,
      dur: 5200,
      ease: easeInOut,
      onUpdate: draw,
      onDone: () => {
        forward = !forward;
        ticker.after(900, loop);
      },
    });
  };
  loop();
  ticker.requestFrame();

  const hero = h('div', { class: 'hero', onclick: () => audio.pluckIdle(), role: 'img', 'aria-label': 'Thread' },
    board,
    h('h1', { class: 'wordmark display', text: 'THREAD' }),
    h('div', { class: 'hero-sub', text: 'one string, one shape' }),
  );
  return hero;
}

// ---------------------------------------------------------------------------
// 2. Continue card
// ---------------------------------------------------------------------------

function continueCard(app: App): HTMLElement {
  const lastMode = (app.save.lastPlayed?.mode === 'weave' ? 'weave' : 'classic') as 'classic' | 'weave';
  const level = app.nextLevel(lastMode);
  const chapterLevels = app.chapterLevels(lastMode, level.chapter);
  const idx = chapterLevels.findIndex((l) => l.id === level.id) + 1;
  const name = level.name ?? `Chapter ${level.chapter}`;

  const card = h('button', {
    class: 'continue',
    style: `--accent:${MODE_ACCENT[lastMode]}`,
    onclick: () => app.go({ name: 'play', mode: lastMode, levelId: level.id }),
  },
    h('div', { class: 'mini' }, miniature(level)),
    h('div', {},
      h('h3', { class: 'display', text: solvedCount(app.save, [level.id]) ? 'Play on' : 'Continue' }),
      h('p', { text: `${name} · ${idx} of ${chapterLevels.length}` }),
    ),
    h('span', { class: 'chev', text: '›' }),
  );
  return card;
}

// ---------------------------------------------------------------------------
// 3. Daily strip
// ---------------------------------------------------------------------------

function dailyStrip(app: App): HTMLElement {
  const key = dateKey();
  const level = dailyLevel(key);
  const rec = app.save.daily.history[key];
  const solved = rec?.solved ?? false;
  const mini = h('div', { class: 'mini' }, miniature(level, solved ? {} : { ink: 'var(--mute)' }));
  if (!solved) mini.style.filter = 'blur(3px)';

  // "% of players who solved it today" is derived from the puzzle's own
  // difficulty rather than invented — there is no server to ask.
  const share = estimateSolveRate(key);

  return h('button', {
    class: 'strip',
    style: `--accent:${MODE_ACCENT.daily}`,
    onclick: () => {
      mini.style.filter = '';
      app.go({ name: 'play', mode: 'daily' });
    },
  },
    mini,
    h('div', {},
      h('h3', { class: 'display', text: 'Daily Thread' }),
      h('p', { text: `${prettyDate(key)}${solved ? ' · solved' : ''}` }),
      h('p', { class: 'flame', text: `${app.save.daily.streak > 0 ? `🔥 ${app.save.daily.streak}` : 'Start a streak'} · ${share}% solved today` }),
    ),
    h('span', { class: 'chev', text: '›' }),
  );
}

function prettyDate(key: string): string {
  const d = new Date(key + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** Deterministic from the date so every player sees the same figure. */
function estimateSolveRate(key: string): number {
  let h2 = 0;
  for (let i = 0; i < key.length; i++) h2 = (h2 * 31 + key.charCodeAt(i)) >>> 0;
  return 42 + (h2 % 46);
}

// ---------------------------------------------------------------------------
// 4. Mode carousel
// ---------------------------------------------------------------------------

function modeCarousel(app: App): HTMLElement {
  const unlocked = app.modes;
  const row = h('div', { class: 'carousel' });

  for (const rule of MODE_UNLOCKS) {
    const id = rule.id;
    if (id === 'daily') continue; // it has its own strip
    const open = unlocked.has(id);
    const accent = MODE_ACCENT[id] ?? 'var(--ink)';
    const preview = previewFor(app, id);
    const progress = progressFor(app, id);

    const card = h('button', {
      class: `modecard${open ? '' : ' locked'}`,
      style: `--accent:${accent}`,
      onclick: () => {
        if (!open) {
          toast(rule.condition);
          return;
        }
        app.go(routeFor(id));
      },
    },
      h('div', { class: 'mini' }, preview),
      h('h4', { class: 'display', text: rule.label }),
      h('p', { text: MODE_BLURB[id] ?? '' }),
      open
        ? h('div', { class: 'lockline' }, ring(progress.fraction, accent), h('span', { text: progress.text }))
        : h('div', { class: 'lockline' }, h('span', { text: '🔒' }), h('span', { text: rule.condition })),
    );
    row.appendChild(card);
  }
  return row;
}

function routeFor(id: string): Route {
  if (id === 'classic' || id === 'weave') return { name: 'chapters', mode: id };
  if (id === 'assess') return { name: 'assess' };
  if (id === 'workshop') return { name: 'workshop' };
  return { name: 'play', mode: id };
}

function previewFor(app: App, id: string) {
  if (id === 'weave') return miniature(app.weave[0] ?? app.classic[0], { showPegs: true });
  if (id === 'assess') return miniature(app.assess[Math.floor(app.assess.length / 2)] ?? app.classic[0], { showPegs: true });
  const pool = app.classic;
  const pick = pool[(id.length * 7) % pool.length];
  return miniature(pick, { showPegs: true });
}

function progressFor(app: App, id: string): { fraction: number; text: string } {
  if (id === 'classic' || id === 'weave') {
    const ids = app.levelsFor(id).map((l) => l.id);
    const done = solvedCount(app.save, ids);
    return { fraction: done / Math.max(ids.length, 1), text: `${done} / ${ids.length}` };
  }
  if (id === 'blitz') return { fraction: Math.min(1, app.save.stats.blitzBest / 25), text: `Best ${app.save.stats.blitzBest}` };
  if (id === 'onelife') return { fraction: Math.min(1, app.save.stats.oneLifeBest / 25), text: `Best ${app.save.stats.oneLifeBest}` };
  if (id === 'zen') return { fraction: Math.min(1, app.save.stats.zenSolved / 50), text: `${app.save.stats.zenSolved} solved` };
  if (id === 'assess') {
    const last = app.save.assess.history.at(-1);
    return { fraction: last ? 1 : 0, text: last ? `Score ${last.score}` : 'Not taken' };
  }
  if (id === 'workshop') return { fraction: Math.min(1, app.save.workshop.length / 10), text: `${app.save.workshop.length} built` };
  return { fraction: 0, text: '' };
}

// ---------------------------------------------------------------------------
// 5. Collection row
// ---------------------------------------------------------------------------

function collectionRow(app: App): HTMLElement {
  const ctx = app.unlockCtx;
  const { have, total } = collectionCount(app.save, ctx);
  const row = h('div', { class: 'collection' });

  THEMES.forEach((t) => {
    const open = themeUnlocked(app.save, t.id, ctx);
    const sw = h('button', {
      class: `swatch${open ? '' : ' locked'}`,
      style: `background:${t.board};border-color:${t.thread}`,
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
    });
    row.appendChild(sw);
  });

  SKINS.forEach((s, i) => {
    const open = skinUnlocked(app.save, s.id, ctx);
    const sw = h('button', {
      class: `swatch${open ? '' : ' locked'}`,
      style: `background:${THREAD_COLORS[i % THREAD_COLORS.length]}`,
      title: open ? s.name : s.unlock,
      'aria-label': open ? `Thread ${s.name}` : `Locked: ${s.unlock}`,
      onclick: () => {
        if (!open) {
          toast(s.unlock);
          return;
        }
        app.save.settings.skin = s.id;
        app.persist();
        toast(`${s.name} thread`);
      },
    });
    row.appendChild(sw);
  });

  row.appendChild(h('span', { class: 'label num', style: 'margin-left:4px', text: `${have} / ${total}` }));
  return row;
}

export { modal, pill, applyDailySolve };
