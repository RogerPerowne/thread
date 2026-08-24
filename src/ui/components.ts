/**
 * The component vocabulary, built once and reused everywhere: top bar, pill
 * buttons, bottom-sheet modal, toast, stat blocks, streak calendar, share
 * sheet. Restraint is the point — if it moves and it isn't communicating
 * state, it is cut.
 */

import { h, svg, clear, copy, type Child } from './dom.js';
import type { Level } from '../core/level.js';
import { deriveTarget } from '../core/level.js';
import { ticker, easeOut } from '../render/tween.js';

export function topBar(
  title: string,
  opts: { onBack?: () => void; onHelp?: () => void; onSettings?: () => void; right?: HTMLElement[] } = {},
): HTMLElement {
  return h('header', { class: 'topbar' },
    opts.onBack
      ? h('button', { class: 'iconbtn', onclick: opts.onBack, 'aria-label': 'Back' }, '‹')
      : h('span'),
    h('h1', { class: 'display', text: title }),
    h('div', { class: 'right' },
      ...(opts.right ?? []),
      opts.onHelp ? h('button', { class: 'iconbtn', onclick: opts.onHelp, 'aria-label': 'How to play' }, '?') : null,
      opts.onSettings ? h('button', { class: 'iconbtn', onclick: opts.onSettings, 'aria-label': 'Settings' }, '⚙') : null,
    ),
  );
}

export function pill(label: string, onclick: () => void, kind: 'primary' | 'ghost' | '' = ''): HTMLButtonElement {
  return h('button', { class: `pill ${kind}`.trim(), onclick }, label);
}

// ---------------------------------------------------------------------------
// Modal — bottom sheet on mobile, centred card on wide screens
// ---------------------------------------------------------------------------

let openScrim: HTMLElement | null = null;

export function modal(content: (close: () => void) => Child[], opts: { dismissable?: boolean } = {}): () => void {
  const scrim = h('div', { class: 'scrim', role: 'dialog', 'aria-modal': 'true' });
  const sheet = h('div', { class: 'sheet' });
  scrim.appendChild(sheet);

  const close = () => {
    scrim.classList.remove('in');
    // The exit is a tween like everything else, so nothing here uses setTimeout.
    ticker.after(230, () => scrim.remove());
    ticker.requestFrame();
    if (openScrim === scrim) openScrim = null;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissable !== false) close();
  };

  for (const c of content(close)) {
    if (c === null || c === undefined || c === false) continue;
    sheet.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  if (opts.dismissable !== false) {
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) close();
    });
  }
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  openScrim = scrim;
  requestAnimationFrame(() => scrim.classList.add('in'));
  const focusable = sheet.querySelector<HTMLElement>('button, [tabindex]');
  focusable?.focus();
  return close;
}

export function closeTopModal(): void {
  openScrim?.querySelector('.sheet');
  openScrim?.remove();
  openScrim = null;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastEl: HTMLElement | null = null;
let toastHideAt = 0;

export function toast(msg: string, ms = 2000): void {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('in');
  toastHideAt = performance.now() + ms;
  ticker.after(ms, () => {
    if (toastEl && performance.now() >= toastHideAt - 16) toastEl.classList.remove('in');
  });
  ticker.requestFrame();
}

// ---------------------------------------------------------------------------
// Board miniature — a static picture of a level's target
// ---------------------------------------------------------------------------

/**
 * A small still of a level. This builds markup once, on a screen that is not
 * the play loop, which is why it is allowed to construct nodes.
 */
export function miniature(level: Level, opts: { ink?: string; paper?: string; showPegs?: boolean } = {}): SVGElement {
  const d = deriveTarget(level);
  const ink = opts.ink ?? 'currentColor';
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  if (opts.paper) root.appendChild(svg('rect', { x: 0, y: 0, width: 100, height: 100, fill: opts.paper }));
  d.loops.forEach((loop, t) => {
    if (loop.length < 3) return;
    const path = loop.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
    root.appendChild(svg('path', {
      d: path,
      'fill-rule': 'evenodd',
      fill: level.threads[t]?.color ?? ink,
      'fill-opacity': 0.24,
      stroke: level.threads[t]?.color ?? ink,
      'stroke-width': 2.2,
      'stroke-linejoin': 'round',
    }));
  });
  if (opts.showPegs) {
    for (const [x, y] of level.pegs) {
      root.appendChild(svg('circle', { cx: x, cy: y, r: 1.6, fill: ink, 'fill-opacity': 0.35 }));
    }
  }
  return root;
}

/** A progress ring, used on the mode cards. */
export function ring(fraction: number, color: string): SVGElement {
  const r = 11;
  const c = 2 * Math.PI * r;
  return svg('svg', { class: 'ring', viewBox: '0 0 26 26' },
    svg('circle', { cx: 13, cy: 13, r, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.18, 'stroke-width': 3 }),
    svg('circle', {
      cx: 13, cy: 13, r, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * Math.min(1, Math.max(0, fraction))).toFixed(2)} ${c.toFixed(2)}`,
      transform: 'rotate(-90 13 13)',
    }),
  );
}

export function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}

// ---------------------------------------------------------------------------
// Stats blocks
// ---------------------------------------------------------------------------

export function statGrid(items: Array<[string | number, string]>): HTMLElement {
  return h('div', { class: 'statgrid' },
    ...items.map(([value, label]) =>
      h('div', { class: 'stat' }, h('b', { class: 'num', text: String(value) }), h('span', { text: label }))),
  );
}

/** A month grid, solved days filled with ink. */
export function streakCalendar(solvedKeys: Set<string>, today: Date = new Date()): HTMLElement {
  const grid = h('div', { class: 'calendar' });
  for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) grid.appendChild(h('div', { class: 'dow', text: d }));
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  // Monday-first, like the rest of the suite.
  const lead = (first.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) grid.appendChild(h('div', { style: 'background:none' }));
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = ['', solvedKeys.has(key) ? 'on' : '', d === today.getDate() ? 'today' : ''].filter(Boolean).join(' ');
    grid.appendChild(h('div', { class: cls, title: key }));
  }
  return grid;
}

export function sparkline(values: number[], color: string): SVGElement {
  const root = svg('svg', { class: 'sparkline', viewBox: '0 0 100 32', preserveAspectRatio: 'none' });
  if (values.length < 2) return root;
  const lo = Math.min(...values) - 2;
  const hi = Math.max(...values) + 2;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 30 - ((v - lo) / Math.max(hi - lo, 1)) * 28;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  root.appendChild(svg('polyline', {
    points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
  }));
  return root;
}

/** Planning / Precision / Speed / Spatial / Learning. */
export function radar(values: Array<[string, number]>, color: string): SVGElement {
  const n = values.length;
  const cx = 60;
  const cy = 58;
  const R = 40;
  const root = svg('svg', { class: 'radar', viewBox: '0 0 120 116' });
  for (const level of [0.33, 0.66, 1]) {
    const pts = values.map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return `${(cx + Math.cos(a) * R * level).toFixed(1)},${(cy + Math.sin(a) * R * level).toFixed(1)}`;
    });
    root.appendChild(svg('polygon', { points: pts.join(' '), fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.18, 'stroke-width': 1 }));
  }
  const pts = values.map(([, v], i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const k = Math.max(0.08, Math.min(1, (v + 1.5) / 3));
    return `${(cx + Math.cos(a) * R * k).toFixed(1)},${(cy + Math.sin(a) * R * k).toFixed(1)}`;
  });
  root.appendChild(svg('polygon', { points: pts.join(' '), fill: color, 'fill-opacity': 0.22, stroke: color, 'stroke-width': 2 }));
  values.forEach(([label], i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = cx + Math.cos(a) * (R + 12);
    const y = cy + Math.sin(a) * (R + 12);
    root.appendChild(svg('text', {
      x: x.toFixed(1), y: (y + 3).toFixed(1), 'text-anchor': 'middle',
      'font-size': 7.5, fill: 'currentColor', 'fill-opacity': 0.7, 'font-family': 'var(--ui)',
    }, label));
  });
  return root;
}

// ---------------------------------------------------------------------------
// Share sheet
// ---------------------------------------------------------------------------

export function shareSheet(title: string, text: string): void {
  modal((close) => [
    h('h2', { class: 'display', text: title }),
    h('pre', { class: 'share', text }),
    h('div', { class: 'actions' },
      pill('Close', close, 'ghost'),
      pill('Copy', async () => {
        const ok = await copy(text);
        toast(ok ? 'Copied' : 'Could not copy');
        if (ok) close();
      }, 'primary'),
    ),
  ]);
}

/**
 * Onboarding: one wordless animated example, one sentence, one pill.
 * Never a wall of text.
 */
export function onboarding(level: Level, sentence: string, onDone: () => void): void {
  const holder = h('div', { class: 'mini', style: 'width:100%;height:180px;margin-bottom:14px' });
  const mini = miniature(level, { showPegs: true });
  holder.appendChild(mini);

  // The example draws itself: the string wraps the shape once, then rests.
  const path = mini.querySelector('path');
  if (path) {
    const len = 320;
    path.setAttribute('stroke-dasharray', String(len));
    path.setAttribute('stroke-dashoffset', String(len));
    path.setAttribute('fill-opacity', '0');
    ticker.add({
      from: len, to: 0, dur: 1100, ease: easeOut,
      onUpdate: (v) => path.setAttribute('stroke-dashoffset', String(v)),
      onDone: () => ticker.add({ from: 0, to: 0.24, dur: 260, onUpdate: (v) => path.setAttribute('fill-opacity', String(v)) }),
    });
    ticker.requestFrame();
  }

  modal((close) => [
    holder,
    h('p', { text: sentence }),
    h('div', { class: 'actions' }, pill('Got it', () => { close(); onDone(); }, 'primary')),
  ], { dismissable: false });
}

export { clear };
