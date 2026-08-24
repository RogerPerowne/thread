/**
 * The play screen. Wraps the Engine and adds the chrome around it: the spool,
 * the match badge, undo, hints, and what happens after a win or a miss.
 *
 * The core loop must be frictionless — sub-300 ms restart, no interstitials,
 * and after a win the next level loads on its own so that continuing requires
 * no decision.
 */

import { h, clear } from './dom.js';
import { topBar, pill, modal, toast, miniature, stars, shareSheet } from './components.js';
import type { App, Route } from './app.js';
import { MODE_ACCENT } from './app.js';
import { Engine, type PlayResult } from '../game/engine.js';
import { type Level, parLength, mechanicsOf } from '../core/level.js';
import { starsFor, applyDailySolve, shouldOfferEasier, shareGrid, shareText } from '../game/progress.js';
import { dailyLevel, blitzLevel, zenLevel, oneLifeLevel, randomSeed, seedFromUrl } from '../game/generate.js';
import { decodeLevel, ShareCodeError } from '../game/sharecode.js';
import { dateKey } from '../core/rng.js';
import { GRID } from '../core/region.js';
import { updateHiddenAbility } from '../core/rating.js';
import { estimateDifficulty } from '../core/difficulty.js';
import { deriveTarget } from '../core/level.js';
import { ticker, easeOut } from '../render/tween.js';
import { audio } from '../render/audio.js';

/** How a mode supplies levels and reacts to a solve. */
type Session = {
  title: string;
  accent: string;
  next(): Level | null;
  label(level: Level): string;
  onSolved?(level: Level, r: PlayResult): void;
  onFailed?(level: Level, r: PlayResult): 'continue' | 'end';
  hud?(): HTMLElement | null;
  autoAdvance: boolean;
  suddenDeath?: boolean;
  timed?: boolean;
  allowHints: boolean;
};

export function playScreen(app: App, route: Route): { el: HTMLElement; dispose?: () => void } {
  const r = route as Extract<Route, { name: 'play' }>;
  const el = h('div', { class: 'playwrap' });

  let session: Session;
  try {
    session = makeSession(app, r);
  } catch (e) {
    const msg = e instanceof ShareCodeError ? e.message : 'That level could not be loaded';
    el.append(
      topBar('Thread', { onBack: () => app.go({ name: 'home' }) }),
      h('div', { class: 'scroll' }, h('p', { style: 'padding:22px', text: msg })),
    );
    return { el };
  }

  const hudEl = h('div', { class: 'hud' });
  const boardEl = h('div', { class: 'board' });
  const badge = h('div', { class: 'matchbadge', role: 'status', 'aria-live': 'polite' });
  boardEl.appendChild(badge);
  const controls = h('div', { class: 'controls' });

  el.style.setProperty('--accent', session.accent);
  el.append(
    topBar(session.title, {
      onBack: () => app.go({ name: 'home' }),
      onHelp: () => showHelp(current),
    }),
    hudEl, boardEl, controls,
  );

  const engine = new Engine(boardEl, {
    themeId: app.save.settings.theme,
    skinId: app.save.settings.skin,
    reducedMotion: app.reducedMotion,
    autoAdvance: session.autoAdvance,
    suddenDeath: session.suddenDeath,
  }, {
    onWin: (res) => handleWin(res),
    onMiss: (res) => handleMiss(res),
    onAdvance: () => advance(),
    onToast: (m) => toast(m),
    onStateChange: () => refreshHud(),
  });

  let current: Level;
  let failuresHere = 0;
  let sessionSolved = 0;
  let ended = false;

  // -- timer (Blitz) -------------------------------------------------------
  let timeLeft = 60_000;
  let timerRunning = false;
  const timerEl = h('b', { class: 'num', text: '60' });

  function tickTimer(): void {
    if (!timerRunning || ended) return;
    timeLeft -= 100;
    timerEl.textContent = Math.max(0, Math.ceil(timeLeft / 1000)).toString();
    if (timeLeft <= 0) {
      endRun('Time');
      return;
    }
    ticker.after(100, tickTimer);
    ticker.requestFrame();
  }

  // -- HUD -----------------------------------------------------------------

  const spool = h('i');
  const spoolBar = h('div', { class: 'spool', role: 'progressbar', 'aria-label': 'String remaining' }, spool);
  const label = h('span', { class: 'chapter' });
  const extraSlot = h('span', { class: 'chapter' });
  hudEl.append(label, spoolBar, extraSlot);

  /**
   * Mutate the HUD rather than rebuild it. This runs on every peg the player
   * adds, and the whole point of the renderer is that a frequent update must
   * never destroy and recreate nodes.
   */
  function refreshHud(): void {
    const s = engine.spool;
    if (s) {
      spool.style.width = `${Math.round(s.fraction * 100)}%`;
      spoolBar.style.display = '';
      spoolBar.setAttribute('aria-valuenow', String(Math.round(s.fraction * 100)));
    } else {
      spoolBar.style.display = 'none';
    }
    const extra = session.hud?.();
    if (extra) {
      if (extraSlot.firstChild !== extra) {
        clear(extraSlot);
        extraSlot.appendChild(extra);
      }
    } else if (extraSlot.firstChild) {
      clear(extraSlot);
    }
  }

  function refreshControls(): void {
    clear(controls);
    controls.append(
      pill('Undo', () => engine.undo(), 'ghost'),
      pill('Clear', () => engine.clear(), 'ghost'),
    );
    if (session.allowHints) controls.append(pill('Hint', () => engine.hint(), 'ghost'));
  }

  // -- level flow ----------------------------------------------------------

  function loadNext(): void {
    const level = session.next();
    if (!level) {
      endRun('Done');
      return;
    }
    current = level;
    failuresHere = 0;
    label.textContent = session.label(level);
    // Read-only hook for the end-to-end harness. It drives the game through
    // real pointer events; this only lets it see what is on the board.
    const hook = (window as unknown as { __thread?: Record<string, unknown> }).__thread;
    if (hook) hook.current = {
      id: level.id,
      pegs: level.pegs,
      threads: level.threads.map((t) => ({ sol: t.sol, over: t.over ?? [] })),
      rails: level.rails ?? [],
      weave: !!level.weave,
      solved: false,
    };
    engine.load(level, {
      themeId: app.save.settings.theme,
      skinId: app.save.settings.skin,
      reducedMotion: app.reducedMotion,
    });
    badge.classList.remove('show');
    refreshHud();
    refreshControls();
    if (session.timed && !timerRunning) {
      timerRunning = true;
      tickTimer();
    }
  }

  function advance(): void {
    if (ended) return;
    loadNext();
  }

  function handleWin(res: PlayResult): void {
    sessionSolved++;
    const hook = (window as unknown as { __thread?: Record<string, unknown> }).__thread;
    if (hook?.current) (hook.current as Record<string, unknown>).solved = true;
    recordSolve(app, res);
    session.onSolved?.(current, res);
    badge.textContent = res.attempt === 1 ? 'Perfect' : 'Solved';
    badge.classList.add('show');
    ticker.schedule(900, () => badge.classList.remove('show'));
    if (session.timed) timeLeft += 3000;
    if (!session.autoAdvance) {
      clear(controls);
      controls.append(pill('Next', () => loadNext(), 'primary'));
    }
  }

  function handleMiss(res: PlayResult): void {
    failuresHere++;
    const hook = (window as unknown as { __thread?: Record<string, unknown> }).__thread;
    if (hook?.current) (hook.current as Record<string, unknown>).lastMiss = res.similarity;
    // "94%" makes people try again immediately; "wrong" makes them quit.
    badge.textContent = `${Math.round(res.similarity * 100)}%`;
    badge.classList.add('show');
    ticker.schedule(1400, () => badge.classList.remove('show'));

    app.save.stats.totalAttempts++;
    const rec = app.save.levels[current.id];
    if (rec) rec.bestSimilarity = Math.max(rec.bestSimilarity, res.similarity);
    app.persist();

    if (session.onFailed?.(current, res) === 'end') {
      endRun('One life');
      return;
    }
    // End every session on a win: three failures and we quietly offer a way
    // through, so the player leaves feeling capable.
    if (shouldOfferEasier(failuresHere) && session.allowHints) {
      offerMercy();
    }
  }

  function offerMercy(): void {
    modal((close) => [
      h('h2', { class: 'display', text: 'Try another way?' }),
      h('p', { text: 'This one is fighting back. Watch it solved, or take a gentler level with the same idea.' }),
      h('div', { class: 'actions' },
        pill('Keep trying', close, 'ghost'),
        pill('Show me', () => { close(); engine.showSolution(); }, 'ghost'),
        pill('Gentler one', () => { close(); loadEasier(); }, 'primary'),
      ),
    ]);
  }

  function loadEasier(): void {
    const mechanics = mechanicsOf(current).join('+');
    const pool = app.levelsFor(current.mode === 'weave' ? 'weave' : 'classic');
    const here = estimateDifficulty(current, deriveTarget(current).raster).b;
    const easier = pool
      .filter((l) => l.id !== current.id && mechanicsOf(l).join('+') === mechanics)
      .map((l) => ({ l, b: estimateDifficulty(l, deriveTarget(l).raster).b }))
      .filter((x) => x.b < here)
      .sort((a, b) => b.b - a.b)[0];
    if (!easier) {
      toast('No gentler level with this idea — here is the solution');
      engine.showSolution();
      return;
    }
    current = easier.l;
    failuresHere = 0;
    label.textContent = session.label(current);
    engine.load(current);
    refreshHud();
  }

  function endRun(reason: string): void {
    if (ended) return;
    ended = true;
    timerRunning = false;
    modal((close) => [
      h('h2', { class: 'display', text: reason === 'Time' ? "Time's up" : reason === 'One life' ? 'Run over' : 'Finished' }),
      h('p', { text: `${sessionSolved} solved.` }),
      h('div', { class: 'actions' },
        pill('Home', () => { close(); app.go({ name: 'home' }); }, 'ghost'),
        pill('Again', () => { close(); app.go({ ...(route as object), seed: randomSeed() } as Route); }, 'primary'),
      ),
    ], { dismissable: false });
  }

  function recordSolve(a: App, res: PlayResult): void {
    const level = res.level;
    const st = starsFor(level, res.lengthUsed, res.hintsUsed);
    const prev = a.save.levels[level.id];
    a.save.levels[level.id] = {
      stars: Math.max(prev?.stars ?? 0, st),
      best: Math.min(prev?.best ?? Infinity, res.lengthUsed),
      attempts: (prev?.attempts ?? 0) + res.attempt,
      bestSimilarity: 1,
    };
    if (!prev) {
      a.save.stats.solved++;
      a.save.gallery.push(level.id);
    }
    if (st >= 3) a.save.stats.perfect++;
    if (res.firstTry) a.save.stats.firstTry++;
    a.save.stats.totalAttempts += res.attempt;
    a.save.lastPlayed = { mode: level.mode, levelId: level.id };
    // Casual play silently refines a hidden ability estimate. It is never
    // shown as a score; only the Assessment produces one of those.
    const d = estimateDifficulty(level, deriveTarget(level).raster);
    a.save.hiddenTheta = updateHiddenAbility(a.save.hiddenTheta, { id: level.id, b: d.b, a: d.a, family: 'play' }, res.firstTry);
    for (const m of mechanicsOf(level)) {
      if (!a.save.seenMechanics.includes(m)) a.save.seenMechanics.push(m);
    }
    a.persist();
  }

  loadNext();
  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);
  // A first frame after layout settles, so the hit radius matches the board.
  ticker.after(16, () => engine.resize());
  ticker.requestFrame();

  return {
    el,
    dispose: () => {
      window.removeEventListener('resize', onResize);
      ended = true;
      engine.destroy();
    },
  };

  // -- session construction ------------------------------------------------

  function makeSession(a: App, rt: Extract<Route, { name: 'play' }>): Session {
    const mode = rt.mode;
    if (mode === 'classic' || mode === 'weave') {
      const all = a.levelsFor(mode);
      let idx = rt.levelId ? all.findIndex((l) => l.id === rt.levelId) : -1;
      if (idx < 0) idx = all.findIndex((l) => !(a.save.levels[l.id]?.stars > 0));
      if (idx < 0) idx = 0;
      let cursor = idx - 1;
      return {
        title: mode === 'classic' ? 'Classic' : 'Weave',
        accent: MODE_ACCENT[mode],
        autoAdvance: true,
        allowHints: true,
        next: () => all[++cursor] ?? null,
        label: (l) => `${chapterName(a, mode, l.chapter)} · ${indexInChapter(a, mode, l)} of ${a.chapterLevels(mode, l.chapter).length}`,
      };
    }

    if (mode === 'daily') {
      const key = dateKey();
      let served = false;
      return {
        title: 'Daily Thread',
        accent: MODE_ACCENT.daily,
        autoAdvance: false,
        allowHints: true,
        next: () => (served ? null : ((served = true), dailyLevel(rt.seed ?? key))),
        label: () => (rt.seed ?? key),
        onSolved: (level, res) => {
          const k = rt.seed ?? key;
          const rec = a.save.daily.history[k] ?? { solved: false, tries: 0 };
          rec.tries = res.attempt;
          a.save.daily.history[k] = rec;
          const { streak, usedFreeze } = applyDailySolve(a.save, k);
          a.persist();
          if (usedFreeze) toast('Streak freeze used');
          const grid = shareGrid(res.raster, GRID);
          ticker.schedule(700, () => {
            modal((close) => [
              h('h2', { class: 'display', text: 'Solved' }),
              h('p', { text: `${res.attempt === 1 ? 'First try' : `${res.attempt} tries`} · ${streak} day streak` }),
              h('pre', { class: 'share', text: grid }),
              h('div', { class: 'actions' },
                pill('Close', close, 'ghost'),
                pill('Share', () => shareSheet('Share today', shareText(k, res.attempt, streak, grid)), 'primary'),
              ),
            ]);
          });
          void level;
        },
      };
    }

    if (mode === 'blitz') {
      const seed = rt.seed ?? randomSeed();
      let i = -1;
      return {
        title: 'Blitz',
        accent: MODE_ACCENT.blitz,
        autoAdvance: true,
        allowHints: false,
        timed: true,
        next: () => blitzLevel(seed, ++i),
        label: () => `Solved ${sessionSolved}`,
        hud: () => h('span', { class: 'chapter' }, timerEl, h('span', { text: 's' })),
        onSolved: () => {
          a.save.stats.blitzBest = Math.max(a.save.stats.blitzBest, sessionSolved);
          a.persist();
        },
      };
    }

    if (mode === 'onelife') {
      const seed = rt.seed ?? randomSeed();
      let i = -1;
      return {
        title: 'One Life',
        accent: MODE_ACCENT.onelife,
        autoAdvance: true,
        allowHints: false,
        suddenDeath: true,
        next: () => oneLifeLevel(seed, ++i),
        label: () => `Rung ${sessionSolved + 1}`,
        onFailed: () => 'end',
        onSolved: () => {
          a.save.stats.oneLifeBest = Math.max(a.save.stats.oneLifeBest, sessionSolved);
          a.persist();
        },
      };
    }

    if (mode === 'zen') {
      const seed = rt.seed ?? randomSeed();
      let i = -1;
      return {
        title: 'Zen',
        accent: MODE_ACCENT.zen,
        autoAdvance: true,
        allowHints: true,
        next: () => zenLevel(seed, ++i),
        label: () => 'Take your time',
        onSolved: () => {
          a.save.stats.zenSolved++;
          a.persist();
        },
      };
    }

    if (mode === 'shared') {
      const level = decodeLevel(rt.seed ?? '', 'shared', 'classic');
      let served = false;
      return {
        title: 'Shared level',
        accent: MODE_ACCENT.workshop,
        autoAdvance: false,
        allowHints: true,
        next: () => (served ? null : ((served = true), level)),
        label: () => 'From a friend',
      };
    }

    throw new Error(`Unknown mode ${mode}`);
  }
}

function chapterName(app: App, mode: 'classic' | 'weave', chapter: number): string {
  const l = app.levelsFor(mode).find((x) => x.chapter === chapter);
  return l?.name ?? `Chapter ${chapter}`;
}

function indexInChapter(app: App, mode: 'classic' | 'weave', level: Level): number {
  return app.chapterLevels(mode, level.chapter).findIndex((l) => l.id === level.id) + 1;
}

/** One wordless animated example, one sentence, one pill. */
function showHelp(level: Level): void {
  const mech = mechanicsOf(level);
  const sentence = HELP[mech[mech.length - 1]] ?? HELP.loop;
  modal((close) => [
    h('div', { class: 'mini', style: 'width:100%;height:170px;margin-bottom:14px' }, miniature(level, { showPegs: true })),
    h('p', { text: sentence }),
    h('div', { class: 'actions' }, pill('Got it', close, 'primary')),
  ]);
}

const HELP: Record<string, string> = {
  loop: 'Drag from peg to peg and let go to tie the loop. Match the outline.',
  budget: 'You only have so much string. The bar above shows what is left.',
  cross: 'Crossing the string turns inside into outside. That is how you make a star.',
  keyhole: 'Come back to a peg you have already used to cut a hole in the middle.',
  post: 'The string cannot pass through a post. Go around.',
  gold: 'Gold pegs must end up on the loop, even when the shape does not need them.',
  thorn: 'Thorns pop the string. Keep your line clear of them.',
  multi: 'Two threads. Lay one, then the other.',
  weave: 'At each crossing, choose which thread passes over. The outline shows the weave.',
  blend: 'Where two threads overlap, the colour mixes. Aim for the blend.',
  portal: 'Enter one ringed peg and the string comes out of its twin. The hop is free.',
  rail: 'Some pegs slide along a rail. Move them first, then thread.',
  fog: 'The shape is hidden. Close a loop and it shows you a little more.',
  mirror: 'The board mirrors whatever you thread. You are shaping both halves at once.',
  rotate: 'The outline is shown turned. Find the shape, whichever way up it is.',
};

export { seedFromUrl, parLength, stars, audio, easeOut };
