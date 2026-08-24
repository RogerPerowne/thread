/** Chapter list, level grid, gallery, stats and settings. */

import { h, svg, copy } from './dom.js';
import {
  topBar, pill, modal, toast, miniature, stars, statGrid, streakCalendar,
  sparkline, radar,
} from './components.js';
import { type App, MODE_ACCENT, type Route } from './app.js';
import { solvedCount, perfectCount, starCount, dailyArchive } from '../game/progress.js';
import { THEMES, SKINS } from '../render/theme.js';
import { themeUnlocked, skinUnlocked } from '../game/progress.js';
import { deriveTarget, type Level } from '../core/level.js';
import { resetSave } from '../game/storage.js';
import { DISCLAIMER } from '../core/rating.js';

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export function chaptersScreen(app: App, route: Route): { el: HTMLElement } {
  const r = route as Extract<Route, { name: 'chapters' }>;
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen', style: `--accent:${MODE_ACCENT[r.mode]}` },
    topBar(r.mode === 'classic' ? 'Classic' : 'Weave', { onBack: () => app.go({ name: 'home' }) }),
    scroll,
  );

  const list = h('div', { class: 'list' });
  let previousComplete = true;
  for (const ch of app.chapters(r.mode)) {
    const levels = app.chapterLevels(r.mode, ch);
    const ids = levels.map((l) => l.id);
    const done = solvedCount(app.save, ids);
    const open = previousComplete || done > 0;
    // Chapter completion needs only solves, so a casual player is never stuck.
    previousComplete = done >= ids.length;

    list.appendChild(h('button', {
      class: `row${open ? '' : ' locked'}`,
      disabled: !open,
      onclick: () => open && app.go({ name: 'levels', mode: r.mode, chapter: ch }),
    },
      h('div', { class: 'mini', style: 'width:40px;height:40px' }, miniature(levels[0])),
      h('div', { class: 'grow' },
        h('div', { text: `${ch}. ${levels[0].name ?? `Chapter ${ch}`}` }),
        h('div', { class: 'sub num', text: open ? `${done} / ${ids.length} solved · ${starCount(app.save, ids)} stars` : 'Finish the chapter before' }),
      ),
      h('span', { class: 'chev', text: open ? '›' : '🔒' }),
    ));
  }
  scroll.appendChild(list);
  return { el };
}

export function levelsScreen(app: App, route: Route): { el: HTMLElement } {
  const r = route as Extract<Route, { name: 'levels' }>;
  const levels = app.chapterLevels(r.mode, r.chapter);
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen', style: `--accent:${MODE_ACCENT[r.mode]}` },
    topBar(levels[0]?.name ?? `Chapter ${r.chapter}`, { onBack: () => app.go({ name: 'chapters', mode: r.mode }) }),
    scroll,
  );

  const grid = h('div', { class: 'levelgrid' });
  let firstUnsolved = true;
  levels.forEach((l, i) => {
    const rec = app.save.levels[l.id];
    const done = (rec?.stars ?? 0) > 0;
    const playable = done || firstUnsolved;
    if (!done) firstUnsolved = false;
    grid.appendChild(h('button', {
      class: `levelbtn${done ? ' done' : ''}${l.gem ? ' gem' : ''}`,
      disabled: !playable,
      title: l.gem ? 'A gem' : '',
      onclick: () => app.go({ name: 'play', mode: r.mode, levelId: l.id }),
    },
      h('span', { class: 'n', text: String(i + 1) }),
      h('span', { class: 'stars', text: done ? stars(rec!.stars) : '' }),
    ));
  });
  scroll.appendChild(grid);
  scroll.appendChild(h('p', { class: 'label', style: 'padding:0 16px', text: `${perfectCount(app.save, levels.map((l) => l.id))} of ${levels.length} perfected` }));
  return { el };
}

// ---------------------------------------------------------------------------
// Gallery — every solved shape joins a growing poster
// ---------------------------------------------------------------------------

export function galleryScreen(app: App): { el: HTMLElement } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' },
    topBar('Gallery', {
      right: [h('button', { class: 'iconbtn', title: 'Export as an image', onclick: () => exportPoster(app) }, '⤓')],
    }),
    scroll,
  );

  const all = [...app.classic, ...app.weave];
  const solved = new Set(app.save.gallery);
  scroll.appendChild(h('p', { class: 'label', style: 'padding:14px 16px 0', text: `${solved.size} of ${all.length} shapes` }));

  const poster = h('div', { class: 'poster' });
  for (const level of all) {
    const got = solved.has(level.id);
    const cell = h('div', { class: `cell${got ? '' : ' empty'}` });
    if (got) cell.appendChild(miniature(level));
    else cell.appendChild(svg('svg', { viewBox: '0 0 100 100' },
      svg('circle', { cx: 50, cy: 50, r: 3, fill: 'currentColor', 'fill-opacity': 0.15 })));
    cell.title = got ? (level.name ?? level.id) : 'Not solved yet';
    poster.appendChild(cell);
  }
  scroll.appendChild(poster);
  return { el };
}

/** Rasterise the poster to a PNG the player can keep. */
function exportPoster(app: App): void {
  const solved = [...app.classic, ...app.weave].filter((l) => app.save.gallery.includes(l.id));
  if (solved.length === 0) {
    toast('Solve a level first');
    return;
  }
  const cols = Math.ceil(Math.sqrt(solved.length));
  const rows = Math.ceil(solved.length / cols);
  const cell = 160;
  const pad = 24;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell + pad * 2;
  canvas.height = rows * cell + pad * 2 + 56;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    toast('Could not build the image');
    return;
  }
  const theme = app.theme;
  ctx.fillStyle = theme.board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  solved.forEach((level, i) => {
    const cx = pad + (i % cols) * cell;
    const cy = pad + Math.floor(i / cols) * cell;
    const d = deriveTarget(level);
    d.loops.forEach((loop, t) => {
      if (loop.length < 3) return;
      ctx.beginPath();
      loop.forEach((p, k) => {
        const x = cx + (p[0] / 100) * cell;
        const y = cy + (p[1] / 100) * cell;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = level.threads[t]?.color ?? theme.thread;
      ctx.globalAlpha = 0.28;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = level.threads[t]?.color ?? theme.thread;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
  });

  ctx.fillStyle = theme.pegLive;
  ctx.font = '700 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('THREAD', canvas.width / 2, canvas.height - 22);

  canvas.toBlob((blob) => {
    if (!blob) {
      toast('Could not build the image');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'thread-gallery.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Poster saved');
  }, 'image/png');
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function statsScreen(app: App): { el: HTMLElement } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, topBar('Stats'), scroll);
  const s = app.save.stats;
  const allIds = [...app.classic, ...app.weave].map((l) => l.id);

  const body = h('div', { style: 'padding:16px' });
  body.append(
    h('div', { class: 'label', text: 'Overall' }),
    statGrid([
      [s.solved, 'Solved'],
      [s.perfect, 'Perfect'],
      [s.totalAttempts ? `${Math.round((s.firstTry / Math.max(s.solved, 1)) * 100)}%` : '—', 'First try'],
      [starCount(app.save, allIds), 'Stars'],
    ]),
    h('div', { class: 'label', text: 'Daily' }),
    statGrid([
      [app.save.daily.streak, 'Streak'],
      [app.save.daily.best, 'Best'],
      [app.save.daily.freezes, 'Freezes'],
      [Object.keys(app.save.daily.history).length, 'Played'],
    ]),
    streakCalendar(new Set(Object.entries(app.save.daily.history).filter(([, v]) => v.solved).map(([k]) => k))),
    h('div', { class: 'label', text: 'Modes' }),
    statGrid([
      [s.blitzBest, 'Blitz best'],
      [s.oneLifeBest, 'One Life'],
      [s.zenSolved, 'Zen'],
      [app.save.workshop.length, 'Built'],
    ]),
  );

  // Thread Score, if the player has ever taken an assessment.
  const history = app.save.assess.history;
  if (history.length) {
    const last = history[history.length - 1];
    body.append(
      h('div', { class: 'label', text: 'Thread Score' }),
      h('div', { class: 'stat', style: 'text-align:left;margin:4px 0 2px' },
        h('b', { class: 'num', style: 'font-size:38px', text: `${last.score} ± ${last.margin}` }),
        h('span', { text: `around the ${last.percentile}th percentile` }),
      ),
      h('p', { class: 'sub', style: 'font-size:12px;color:var(--mute);margin:8px 0 0', text: DISCLAIMER }),
      sparkline(history.map((x) => x.score), MODE_ACCENT.assess),
      radar([
        ['Planning', last.profile.planning],
        ['Precision', last.profile.precision],
        ['Speed', last.profile.speed],
        ['Spatial', last.profile.spatial],
        ['Learning', last.profile.learning],
      ], MODE_ACCENT.assess),
    );
  }

  // Seven-day archive: catching up costs nothing and keeps people playing.
  const archive = h('div', { class: 'list' });
  archive.appendChild(h('div', { class: 'label', style: 'padding-top:10px', text: 'Last seven days' }));
  for (const key of dailyArchive(new Date().toISOString().slice(0, 10))) {
    const rec = app.save.daily.history[key];
    archive.appendChild(h('button', {
      class: 'row',
      onclick: () => app.go({ name: 'play', mode: 'daily', seed: key }),
    },
      h('div', { class: 'grow' }, h('div', { class: 'num', text: key })),
      h('span', { class: 'sub', text: rec?.solved ? `solved in ${rec.tries}` : 'play' }),
    ));
  }
  body.appendChild(archive);
  scroll.appendChild(body);
  return { el };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function settingsScreen(app: App): { el: HTMLElement } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' }, topBar('Settings'), scroll);
  const body = h('div', { style: 'padding:8px 16px 16px' });
  const ctx = app.unlockCtx;

  const toggle = (label: string, get: () => boolean, set: (v: boolean) => void, note?: string) => {
    const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(get()), 'aria-label': label });
    sw.addEventListener('click', () => {
      set(!get());
      sw.setAttribute('aria-checked', String(get()));
      app.applySettings();
      app.persist();
    });
    return h('div', { class: 'switchrow' },
      h('div', {}, h('div', { text: label }), note ? h('div', { class: 'sub', text: note }) : null),
      sw);
  };

  body.append(
    h('div', { class: 'label', text: 'Theme' }),
    h('div', { class: 'collection', style: 'padding-left:0' },
      ...THEMES.map((t) => {
        const open = themeUnlocked(app.save, t.id, ctx);
        return h('button', {
          class: `swatch${open ? '' : ' locked'}`,
          style: `background:${t.board};border-color:${t.thread}${app.save.settings.theme === t.id ? ';outline:2px solid var(--ink);outline-offset:2px' : ''}`,
          title: open ? t.name : t.unlock,
          onclick: () => {
            if (!open) {
              toast(t.unlock);
              return;
            }
            app.save.settings.theme = t.id;
            app.applySettings();
            app.persist();
            app.go({ name: 'settings' });
          },
        });
      }),
    ),
    h('div', { class: 'label', text: 'Thread' }),
    h('div', { class: 'collection', style: 'padding-left:0' },
      ...SKINS.map((sk) => {
        const open = skinUnlocked(app.save, sk.id, ctx);
        return h('button', {
          class: `swatch${open ? '' : ' locked'}`,
          style: `background:var(--panel)${app.save.settings.skin === sk.id ? ';outline:2px solid var(--ink);outline-offset:2px' : ''}`,
          title: open ? sk.name : sk.unlock,
          text: sk.name.slice(0, 1),
          onclick: () => {
            if (!open) {
              toast(sk.unlock);
              return;
            }
            app.save.settings.skin = sk.id;
            app.persist();
            app.go({ name: 'settings' });
          },
        });
      }),
    ),
    h('div', { class: 'label', style: 'margin-top:14px', text: 'Play' }),
    toggle('Sound', () => !app.save.settings.muted, (v) => { app.save.settings.muted = !v; }),
    toggle('Reduce motion', () => app.save.settings.motion === 'reduced',
      (v) => { app.save.settings.motion = v ? 'reduced' : 'auto'; },
      'Transitions land instantly and particles are switched off'),
    toggle('Higher contrast', () => app.save.settings.highContrast, (v) => { app.save.settings.highContrast = v; }),
    toggle('Daily reminder', () => app.save.settings.dailyReminder, (v) => {
      app.save.settings.dailyReminder = v;
      if (v) toast('Your browser will ask permission once');
    }, 'One a day. Nothing else, ever.'),
    h('div', { class: 'label', style: 'margin-top:14px', text: 'Data' }),
    h('div', { class: 'actions', style: 'display:flex;gap:10px;padding:12px 0' },
      pill('Export save', async () => {
        const ok = await copy(JSON.stringify(app.save));
        toast(ok ? 'Save copied to the clipboard' : 'Could not copy');
      }, 'ghost'),
      pill('Reset', () => {
        modal((close) => [
          h('h2', { class: 'display', text: 'Reset everything?' }),
          h('p', { text: 'Your levels, streak, gallery and scores will be erased. This cannot be undone.' }),
          h('div', { class: 'actions' },
            pill('Keep it', close, 'ghost'),
            pill('Reset', () => {
              resetSave();
              close();
              location.reload();
            }, 'primary'),
          ),
        ]);
      }, 'ghost'),
    ),
    h('p', { class: 'sub', style: 'color:var(--mute);font-size:12px;line-height:1.5' },
      'Thread keeps everything on this device. No account, no ads, no tracking.'),
  );
  scroll.appendChild(body);
  return { el };
}

export { type Level };
