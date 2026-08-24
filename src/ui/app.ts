/**
 * The app shell: save file, level registry, routing and the bottom tab bar.
 * Screens are plain functions that return an element; the shell swaps them.
 */

import { h, clear } from './dom.js';
import { toast } from './components.js';
import { load, save as persist, type Save } from '../game/storage.js';
import { unlockedModes, type UnlockCtx } from '../game/progress.js';
import { type Level, validateLevel } from '../core/level.js';
import { themeById, skinById } from '../render/theme.js';
import { audio } from '../render/audio.js';
import { ticker } from '../render/tween.js';
import classicRaw from '../../levels/classic.json';
import weaveRaw from '../../levels/weave.json';
import assessRaw from '../../levels/assess.json';

export type Route =
  | { name: 'home' }
  | { name: 'gallery' }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'chapters'; mode: 'classic' | 'weave' }
  | { name: 'levels'; mode: 'classic' | 'weave'; chapter: number }
  | { name: 'play'; mode: string; levelId?: string; index?: number; seed?: string }
  | { name: 'assess' }
  | { name: 'workshop' };

export const MODE_ACCENT: Record<string, string> = {
  classic: 'var(--accent-classic)',
  weave: 'var(--accent-weave)',
  daily: 'var(--accent-daily)',
  blitz: 'var(--accent-blitz)',
  assess: 'var(--accent-assess)',
  zen: 'var(--accent-zen)',
  onelife: 'var(--accent-onelife)',
  workshop: 'var(--accent-workshop)',
};

export const MODE_BLURB: Record<string, string> = {
  classic: 'Fifteen chapters. One new idea in each.',
  weave: 'Two, three, then four coloured threads.',
  daily: 'One puzzle a day. Everyone gets the same one.',
  blitz: 'Sixty seconds. Every solve buys three more.',
  onelife: 'One wrong loop ends the run.',
  zen: 'No timer, no spool. Play to think.',
  assess: 'Twelve adaptive puzzles. Your Thread Score.',
  workshop: 'Build a level. Share it as a code.',
};

export class App {
  save: Save;
  readonly classic: Level[];
  readonly weave: Level[];
  readonly assess: Level[];
  private screenEl: HTMLElement;
  private tabs: HTMLElement;
  route: Route = { name: 'home' };
  private cleanup: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.save = load();
    this.classic = (classicRaw as unknown[]).map((l) => validateLevel(l));
    this.weave = (weaveRaw as unknown[]).map((l) => validateLevel(l));
    this.assess = (assessRaw as unknown[]).map((l) => validateLevel(l));

    this.screenEl = h('div', { class: 'screen' });
    this.tabs = this.buildTabs();
    root.append(this.screenEl, this.tabs);

    this.applySettings();
    window.addEventListener('hashchange', () => this.readHash());
  }

  // -- settings ------------------------------------------------------------

  applySettings(): void {
    const s = this.save.settings;
    document.documentElement.setAttribute('data-theme', s.theme);
    document.body.setAttribute('data-contrast', s.highContrast ? 'high' : 'normal');
    const prefersReduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reduced = s.motion === 'reduced' || (s.motion === 'auto' && prefersReduced);
    document.body.setAttribute('data-motion', reduced ? 'reduced' : 'full');
    ticker.reducedMotion = reduced;
    audio.muted = s.muted;
    audio.setTheme(themeById(s.theme));
  }

  get reducedMotion(): boolean {
    return ticker.reducedMotion;
  }

  get theme() {
    return themeById(this.save.settings.theme);
  }

  get skin() {
    return skinById(this.save.settings.skin);
  }

  persist(): void {
    persist(this.save);
  }

  // -- level registry ------------------------------------------------------

  levelsFor(mode: 'classic' | 'weave'): Level[] {
    return mode === 'classic' ? this.classic : this.weave;
  }

  chapterLevels(mode: 'classic' | 'weave', chapter: number): Level[] {
    return this.levelsFor(mode).filter((l) => l.chapter === chapter);
  }

  chapters(mode: 'classic' | 'weave'): number[] {
    return [...new Set(this.levelsFor(mode).map((l) => l.chapter))].sort((a, b) => a - b);
  }

  levelById(id: string): Level | null {
    return [...this.classic, ...this.weave, ...this.assess].find((l) => l.id === id) ?? null;
  }

  get unlockCtx(): UnlockCtx {
    return {
      classicIds: this.classic.map((l) => l.id),
      weaveIds: this.weave.map((l) => l.id),
      chapterIds: (ch: number) => this.chapterLevels('classic', ch).map((l) => l.id),
    };
  }

  get modes(): Set<string> {
    return unlockedModes(this.save, this.unlockCtx);
  }

  /** The next unsolved level in a mode — what Continue resumes. */
  nextLevel(mode: 'classic' | 'weave'): Level {
    const all = this.levelsFor(mode);
    return all.find((l) => !(this.save.levels[l.id]?.stars > 0)) ?? all[all.length - 1];
  }

  // -- routing -------------------------------------------------------------

  private buildTabs(): HTMLElement {
    const mk = (name: Route['name'], glyph: string, label: string) =>
      h('button', {
        class: 'tab',
        onclick: () => this.go({ name } as Route),
        'data-tab': name,
      }, h('span', { class: 'glyph', text: glyph }), h('span', { text: label }));
    return h('nav', { class: 'tabbar' },
      mk('home', '◈', 'Home'),
      mk('gallery', '▦', 'Gallery'),
      mk('stats', '◔', 'Stats'),
      mk('settings', '⚙', 'Settings'),
    );
  }

  go(route: Route, opts: { replace?: boolean } = {}): void {
    // Every screen change cancels animation first, so nothing from the old
    // screen can write into the new one.
    ticker.cancelAll();
    this.cleanup?.();
    this.cleanup = null;
    this.route = route;
    clear(this.screenEl);
    const showTabs = ['home', 'gallery', 'stats', 'settings'].includes(route.name);
    this.tabs.style.display = showTabs ? '' : 'none';
    for (const t of Array.from(this.tabs.querySelectorAll<HTMLElement>('.tab'))) {
      if (t.dataset.tab === route.name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    const { el, dispose } = this.render(route);
    this.cleanup = dispose ?? null;
    this.screenEl.appendChild(el);
    this.screenEl.scrollTop = 0;
    if (!opts.replace) this.writeHash(route);
  }

  private renderers = new Map<string, (app: App, route: Route) => { el: HTMLElement; dispose?: () => void }>();

  registerScreen(name: string, fn: (app: App, route: Route) => { el: HTMLElement; dispose?: () => void }): void {
    this.renderers.set(name, fn);
  }

  private render(route: Route): { el: HTMLElement; dispose?: () => void } {
    const fn = this.renderers.get(route.name);
    if (!fn) return { el: h('div', { class: 'scroll' }, h('p', { style: 'padding:20px', text: 'Nothing here yet.' })) };
    return fn(this, route);
  }

  private writeHash(route: Route): void {
    const parts: string[] = [route.name];
    if ('mode' in route && route.mode) parts.push(route.mode);
    if ('chapter' in route && route.chapter) parts.push(String(route.chapter));
    if ('levelId' in route && route.levelId) parts.push(route.levelId);
    const hash = `#/${parts.join('/')}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  readHash(): void {
    const hash = location.hash;
    const shared = /[#&]level=([A-Za-z0-9_-]+)/.exec(hash);
    if (shared) {
      this.go({ name: 'play', mode: 'shared', seed: shared[1] });
      return;
    }
    const m = /^#\/([a-z]+)(?:\/([a-z]+))?(?:\/([^/]+))?(?:\/([^/]+))?/.exec(hash);
    if (!m) return;
    const [, name, a, b] = m;
    switch (name) {
      case 'home': case 'gallery': case 'stats': case 'settings': case 'assess': case 'workshop':
        this.go({ name } as Route, { replace: true });
        break;
      case 'chapters':
        if (a === 'classic' || a === 'weave') this.go({ name: 'chapters', mode: a }, { replace: true });
        break;
      case 'levels':
        if ((a === 'classic' || a === 'weave') && b) {
          this.go({ name: 'levels', mode: a, chapter: Number(b) }, { replace: true });
        }
        break;
      case 'play':
        if (a) this.go({ name: 'play', mode: a, levelId: b }, { replace: true });
        break;
      default:
        break;
    }
  }

  toast(msg: string): void {
    toast(msg);
  }
}
