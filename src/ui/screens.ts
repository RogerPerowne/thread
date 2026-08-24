/** Chapter cards, the level path, gallery, stats and settings. */

import { h, svg, copy } from './dom.js';
import {
  topBar, pill, modal, toast, miniature, statGrid, streakCalendar,
  sparkline, radar, sectionHeader, themeSwatch, threadSwatch, gameCard,
} from './components.js';
import * as haptics from '../render/haptics.js';
import { type App, MODE_ACCENT, type Route } from './app.js';
import { CLASSIC_CHAPTERS, WEAVE_CHAPTERS } from '../core/design.js';
import { chapterColor } from './palette.js';
import { chevronRight, locate, download } from './icons.js';
import { chapterPath, type PathNode } from './path.js';
import { solvedCount, starCount, dailyArchive } from '../game/progress.js';
import { THEMES, SKINS, THREAD_COLORS } from '../render/theme.js';
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

  const list = h('div', { class: 'cardlist' });
  const specs = r.mode === 'classic' ? CLASSIC_CHAPTERS : WEAVE_CHAPTERS;
  let previousComplete = true;

  for (const ch of app.chapters(r.mode)) {
    const levels = app.chapterLevels(r.mode, ch);
    const ids = levels.map((l) => l.id);
    const done = solvedCount(app.save, ids);
    const open = previousComplete || done > 0;
    // Chapter completion needs only solves, so a casual player is never stuck.
    previousComplete = done >= ids.length;
    const idea = specs.find((sp) => sp.chapter === ch)?.idea ?? '';
    const color = chapterColor(r.mode, ch);

    list.appendChild(gameCard({
      id: `chapter-${ch}`,
      color,
      title: levels[0].name ?? `Chapter ${ch}`,
      // The idea shows even when the chapter is locked: it is a reason to keep
      // going, not a spoiler.
      blurb: idea,
      foot: open ? `Chapter ${ch}` : 'Locked',
      note: open ? `${done} of ${ids.length}` : `Finish Chapter ${ch - 1} first`,
      art: miniature(levels[0], { ink: 'var(--card-ink)', mono: true }),
      locked: !open,
      onOpen: () => {
        if (!open) {
          toast(`Finish Chapter ${ch - 1} to open this one.`);
          return;
        }
        app.go({ name: 'levels', mode: r.mode, chapter: ch });
      },
    }));
  }
  scroll.appendChild(list);
  return { el };
}

/**
 * A chapter, as a path you walk down rather than a grid you scan. The layout
 * is the isometric meander measured in reference/ and held to by
 * scripts/compare-reference.mjs; the paint is Thread's: the chapter's colour
 * edge to edge, black ink, a white tile for the level you are up to.
 */
export function levelsScreen(app: App, route: Route): { el: HTMLElement; dispose?: () => void } {
  const r = route as Extract<Route, { name: 'levels' }>;
  const levels = app.chapterLevels(r.mode, r.chapter);
  const color = chapterColor(r.mode, r.chapter);
  const specs = r.mode === 'classic' ? CLASSIC_CHAPTERS : WEAVE_CHAPTERS;
  const idea = specs.find((sp) => sp.chapter === r.chapter)?.idea ?? '';
  const ids = levels.map((l) => l.id);
  const done = solvedCount(app.save, ids);

  const scroll = h('div', { class: 'scroll pathscroll' });
  let firstUnsolved = true;
  const nodes: PathNode[] = levels.map((l, i) => {
    const rec = app.save.levels[l.id];
    const solved = (rec?.stars ?? 0) > 0;
    const isNext = !solved && firstUnsolved;
    if (!solved) firstUnsolved = false;
    return {
      label: `Level ${i + 1}`,
      sub: isNext ? 'Play' : undefined,
      stars: solved ? rec!.stars : 0,
      state: solved ? 'done' : isNext ? 'next' : 'locked',
      gem: l.gem,
      onOpen: () => app.go({ name: 'play', mode: r.mode, levelId: l.id }),
    };
  });

  const view = chapterPath(nodes, color);
  scroll.appendChild(view.el);

  /*
   * Take me back to where I am. It sits in the header, opposite the back
   * button, rather than floating over the path: a pill hovering above the
   * board covers a tile and a label at every scroll position, and the one
   * thing this screen is for is seeing the whole route.
   *
   * It earns its place on a chapter longer than a screen or so, and gets in
   * the way on a short one, so it appears on the length of the run rather
   * than on where the player happens to be.
   */
  const jump = view.height > 2400
    ? h('button', {
      class: 'iconbtn',
      title: 'Where I am',
      'aria-label': 'Scroll to the level you are up to',
      onclick: () => {
        haptics.tick();
        view.scrollToCurrent();
      },
    }, locate(22))
    : null;

  const el = h('div', {
    class: 'screen chapterscreen',
    style: `--card:${color};--accent:${MODE_ACCENT[r.mode]}`,
  },
    chapterHeader(app, r, levels[0]?.name ?? `Chapter ${r.chapter}`, idea, done, ids.length, jump),
    scroll,
  );

  /*
   * Land on the level you are up to, not on level one, and without an
   * animation the player did not ask for.
   *
   * Two frames, because measuring on the frame the screen is attached gives
   * zeroes. Then wait out anything that has locked the document: on a first
   * run the intro sheet is open over the top, and a scroll attempted under it
   * silently does nothing, leaving the player at level one when they dismiss
   * it. The wait costs one style read a frame and only ever happens once.
   */
  let settle = 0;
  let frames = 0;
  const land = () => {
    if (getComputedStyle(document.body).overflow === 'hidden' && frames++ < 1800) {
      settle = requestAnimationFrame(land);
      return;
    }
    view.scrollToCurrent('auto');
  };
  settle = requestAnimationFrame(() => { settle = requestAnimationFrame(land); });
  return { el, dispose: () => cancelAnimationFrame(settle) };
}

function chapterHeader(
  app: App,
  r: Extract<Route, { name: 'levels' }>,
  title: string,
  idea: string,
  done: number,
  total: number,
  right: HTMLElement | null,
): HTMLElement {
  return h('header', { class: 'chapterhead' },
    h('button', {
      class: 'iconbtn',
      'aria-label': 'Back',
      onclick: () => app.go({ name: 'chapters', mode: r.mode }),
    }, svg('svg', { viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', 'aria-hidden': 'true' },
      svg('path', {
        d: 'M15 4 L7 12 L15 20', stroke: 'currentColor', 'stroke-width': 2.6,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }))),
    h('div', { class: 'headtext' },
      h('div', { class: 'eyebrow', text: `${r.mode === 'classic' ? 'Classic' : 'Weave'} \u00b7 Chapter ${r.chapter}` }),
      h('h1', { class: 'display', text: title }),
      idea ? h('p', { class: 'idea', text: idea }) : null,
    ),
    right ?? h('span'),
    h('div', { class: 'headbar', role: 'img', 'aria-label': `${done} of ${total} solved` },
      h('span', { style: `width:${Math.round((done / Math.max(total, 1)) * 100)}%` }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Gallery — every solved shape joins a growing poster
// ---------------------------------------------------------------------------

export function galleryScreen(app: App): { el: HTMLElement } {
  const scroll = h('div', { class: 'scroll' });
  const el = h('div', { class: 'screen' },
    topBar('Gallery', {
      right: [h('button', {
        class: 'iconbtn', title: 'Export as an image', 'aria-label': 'Export as an image',
        onclick: () => exportPoster(app),
      }, download())],
    }),
    scroll,
  );

  const all = [...app.classic, ...app.weave];
  const solved = new Set(app.save.gallery);

  if (solved.size === 0) {
    // A wall of 262 blank tiles is a poor way to meet a player. Say what the
    // Gallery is for, and hand them the way in.
    scroll.appendChild(h('div', { style: 'padding:28px var(--gutter) 8px;text-align:center' },
      h('div', { class: 'tile lg', style: 'margin:0 auto 16px;background:var(--classic-soft)' },
        miniature(app.classic[0], { showPegs: true })),
      h('h2', { class: 'display', style: 'font-size:24px;margin:0 0 8px', text: 'Your poster starts here' }),
      h('p', { style: 'color:var(--mute);font-size:15px;line-height:1.5;margin:0 auto;max-width:34ch' },
        'Every shape you solve is added to a poster that fills in as you play. '
        + 'When it has something on it you can save the whole thing as an image.'),
      h('div', { style: 'margin-top:18px' },
        pill('Play a level', () => app.go({ name: 'play', mode: 'classic' }), 'primary')),
    ));
  } else {
    scroll.appendChild(h('div', { class: 'section' },
      h('span', { class: 'label num', text: `${solved.size} of ${all.length} shapes` }),
      h('button', { class: 'linky', text: 'Save as image', onclick: () => exportPoster(app) }),
    ));
  }

  const poster = h('div', { class: 'poster' });
  for (const level of all) {
    const got = solved.has(level.id);
    const cell = h('div', { class: `cell${got ? '' : ' empty'}` });
    if (got) cell.appendChild(miniature(level));
    else {
      cell.appendChild(svg('svg', { viewBox: '0 0 100 100' },
        svg('circle', { cx: 50, cy: 50, r: 3, fill: 'currentColor', 'fill-opacity': 0.14 })));
    }
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
      h('div', { style: 'margin:4px 0 2px' },
        h('div', { class: 'bignum display', text: `${last.score} ± ${last.margin}` }),
        h('div', { class: 'label', style: 'margin-top:6px', text: `around the ${last.percentile}th percentile` }),
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
  archive.appendChild(h('div', { class: 'label', style: 'padding:18px 0 6px', text: 'Last seven days' }));
  const todayKey = new Date().toISOString().slice(0, 10);
  for (const key of dailyArchive(todayKey)) {
    const rec = app.save.daily.history[key];
    archive.appendChild(h('button', {
      class: 'row',
      style: 'padding-left:0;padding-right:0',
      onclick: () => app.go({ name: 'play', mode: 'daily', seed: key }),
    },
      h('div', { class: 'grow' },
        h('div', { class: 'title', text: friendlyDay(key, todayKey) }),
        h('div', { class: 'sub num', text: key }),
      ),
      rec?.solved
        ? h('span', { class: 'sub num', text: rec.tries === 1 ? 'first try' : `${rec.tries} tries` })
        : h('span', { class: 'sub', text: 'Play' }),
      h('span', { class: 'chev' }, chevronRight()),
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
  const ctx = app.unlockCtx;

  const toggle = (
    label: string,
    get: () => boolean,
    set: (v: boolean) => void,
    note?: string,
  ): HTMLElement => {
    const sw = h('button', {
      class: 'switch',
      role: 'switch',
      'aria-checked': String(get()),
      'aria-label': label,
    });
    sw.addEventListener('click', () => {
      set(!get());
      sw.setAttribute('aria-checked', String(get()));
      app.applySettings();
      app.persist();
      haptics.tick();
    });
    return h('div', { class: 'switchrow' },
      h('div', { style: 'min-width:0' },
        h('div', { style: 'font-weight:600;font-size:15.5px', text: label }),
        note ? h('div', { class: 'sub', text: note }) : null),
      sw);
  };

  const themeName = () => THEMES.find((t) => t.id === app.save.settings.theme)?.name ?? '';
  const skinName = () => SKINS.find((sk) => sk.id === app.save.settings.skin)?.name ?? '';

  const themes = h('div', { class: 'collection', style: 'padding-left:var(--gutter)' },
    ...THEMES.map((t) => {
      const open = themeUnlocked(app.save, t.id, ctx);
      return h('button', {
        class: `swatch${open ? '' : ' locked'}${app.save.settings.theme === t.id ? ' on' : ''}`,
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
          app.go({ name: 'settings' });
        },
      }, themeSwatch(t.board, t.thread, t.peg));
    }),
  );

  const skins = h('div', { class: 'collection', style: 'padding-left:var(--gutter)' },
    ...SKINS.map((sk, i) => {
      const open = skinUnlocked(app.save, sk.id, ctx);
      return h('button', {
        class: `swatch${open ? '' : ' locked'}${app.save.settings.skin === sk.id ? ' on' : ''}`,
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
          app.go({ name: 'settings' });
        },
      }, threadSwatch(THREAD_COLORS[i % THREAD_COLORS.length], sk.dash, sk.weight, sk.cap));
    }),
  );

  const body = h('div', { style: 'padding:0 var(--gutter) 8px' });
  body.append(
    toggle('Sound', () => !app.save.settings.muted, (v) => { app.save.settings.muted = !v; },
      'A pluck for each segment; the pitch rises as the segment shortens'),
    toggle('Vibration', () => app.save.settings.haptics, (v) => { app.save.settings.haptics = v; },
      'A short tick when a peg joins the loop'),
    toggle('Reduce motion', () => app.save.settings.motion === 'reduced',
      (v) => { app.save.settings.motion = v ? 'reduced' : 'auto'; },
      'Transitions land instantly and no particles are drawn'),
    toggle('Higher contrast', () => app.save.settings.highContrast,
      (v) => { app.save.settings.highContrast = v; },
      'Stronger lines and darker secondary text'),
  );

  const data = h('div', { style: 'display:flex;gap:10px;padding:16px var(--gutter) 4px' },
    pill('Copy save', async () => {
      const ok = await copy(JSON.stringify(app.save));
      toast(ok ? 'Save copied to the clipboard' : 'Could not copy');
    }, 'ghost'),
    pill('Reset', () => {
      modal((close) => [
        h('h2', { class: 'display', text: 'Reset everything?' }),
        h('p', { text: 'Your levels, streak, gallery and scores will be erased. This cannot be undone.' }),
        h('div', { class: 'actions' },
          pill('Keep it', close, 'primary'),
          pill('Erase it all', () => {
            resetSave();
            close();
            location.reload();
          }, 'ghost'),
        ),
      ]);
    }, 'ghost'),
  );

  scroll.append(
    sectionHeader(`Theme · ${themeName()}`),
    themes,
    sectionHeader(`Thread · ${skinName()}`),
    skins,
    sectionHeader('Play'),
    body,
    sectionHeader('Data'),
    data,
    h('p', { class: 'note', style: 'padding-top:14px' },
      'Thread keeps everything on this device. No account, no ads, no tracking, and no '
      + 'notifications — a real daily reminder needs a push service, and there is no server '
      + 'here to run one, so there is no switch that pretends otherwise.'),
  );
  return { el };
}

/** "Today", "Yesterday", then the weekday. */
function friendlyDay(key: string, todayKey: string): string {
  const days = Math.round(
    (Date.parse(todayKey + 'T00:00:00') - Date.parse(key + 'T00:00:00')) / 86400000,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(key + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
}

export { type Level };
