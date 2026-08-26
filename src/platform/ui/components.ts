/**
 * The shared furniture, as functions.
 *
 * Nothing here knows what a puzzle is. That is the test: if a component needs
 * to be told which game it is inside, it belongs in the game, not here.
 */

import { h, type Child } from '../dom.js';
import { icon, type IconName } from './icons.js';
import * as haptics from '../haptics.js';

export function iconButton(
  name: IconName, label: string, onClick: () => void, opts: { disabled?: boolean } = {},
): HTMLButtonElement {
  const b = h('button', {
    class: 'icon chrome',
    type: 'button',
    'aria-label': label,
    title: label,
    onclick: () => { haptics.tick(); onClick(); },
  }, icon[name]());
  b.disabled = Boolean(opts.disabled);
  return b;
}

export function button(
  text: string, onClick: () => void,
  opts: { kind?: 'plain' | 'solid' | 'accent'; wide?: boolean; glyph?: IconName; label?: string } = {},
): HTMLButtonElement {
  const cls = ['btn', 'chrome'];
  if (opts.kind && opts.kind !== 'plain') cls.push(opts.kind);
  if (opts.wide) cls.push('wide');
  return h('button', {
    class: cls.join(' '),
    type: 'button',
    'aria-label': opts.label ?? text,
    onclick: () => { haptics.tick(); onClick(); },
  }, opts.glyph ? icon[opts.glyph]() : null, h('span', { text }));
}

/**
 * A bottom sheet.
 *
 * Sheets rather than centred dialogs because a phone is held at the bottom.
 * It closes on the scrim, on Escape, and on its own button, and it puts focus
 * inside itself and gives it back on the way out — a modal that strands the
 * keyboard is not a modal, it is a trap.
 */
const openSheets = new Set<() => void>();

/**
 * Shut every sheet.
 *
 * Called when the app changes place. A sheet lives on the body rather than
 * inside a screen — it has to, to sit above everything — which means it does
 * not go away when its screen does. Left behind, its scrim covers the next
 * board and silently eats every touch: the puzzle looks fine and simply does
 * not respond.
 */
export function closeSheets(): void {
  for (const shut of [...openSheets]) shut();
  openSheets.clear();
}

export function sheet(title: string, body: Child[], opts: { onClose?: () => void } = {}): () => void {
  const before = document.activeElement as HTMLElement | null;
  const panel = h('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': title,
  },
    h('div', { class: 'grabber' }),
    h('h2', { class: 'display', text: title }),
    ...body,
  );
  const scrim = h('div', { class: 'scrim' }, panel);

  const shut = () => {
    openSheets.delete(shut);
    document.removeEventListener('keydown', onKey);
    scrim.remove();
    before?.focus?.();
    opts.onClose?.();
  };
  openSheets.add(shut);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); shut(); }
  };

  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) shut(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  (panel.querySelector('button') as HTMLElement | null)?.focus();
  return shut;
}

/** A short-lived line at the bottom of the screen. Never the only feedback. */
export function toast(text: string, ms = 2200): void {
  const el = h('div', { class: 'toast chrome', role: 'status', text });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

/** The progress meter. Real progress only — never a bar that fakes a wait. */
export function meter(): { el: HTMLElement; set(fraction: number): void } {
  const fill = h('i');
  const el = h('div', {
    class: 'meter',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, fill);
  return {
    el,
    set(fraction) {
      const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      fill.style.width = `${pct}%`;
      el.setAttribute('aria-valuenow', String(pct));
    },
  };
}

export { icon };
