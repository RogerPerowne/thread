/**
 * The component vocabulary: top bar, pill buttons, the big colour card, a
 * toast, and a drawn star. Restraint is the point — if it moves and it is not
 * communicating state, it is cut.
 */

import { h, svg } from './dom.js';
import * as haptics from '../render/haptics.js';
import { ticker } from '../render/tween.js';
import { gear, question, starRow } from './icons.js';

export function topBar(
  title: string,
  opts: { onBack?: () => void; onHelp?: () => void; onSettings?: () => void; right?: HTMLElement[] } = {},
): HTMLElement {
  return h('header', { class: 'topbar' },
    opts.onBack
      ? h('button', { class: 'iconbtn', onclick: opts.onBack, 'aria-label': 'Back' }, backArrow())
      : h('span'),
    h('h1', { class: 'display', text: title }),
    h('div', { class: 'right' },
      ...(opts.right ?? []),
      opts.onHelp ? h('button', { class: 'iconbtn', onclick: opts.onHelp, 'aria-label': 'How to play' }, question()) : null,
      opts.onSettings ? h('button', { class: 'iconbtn', onclick: opts.onSettings, 'aria-label': 'Settings' }, gear()) : null,
    ),
  );
}

function backArrow(): SVGElement {
  return svg('svg', { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', 'aria-hidden': 'true' },
    svg('path', {
      d: 'M15 5 L8 12 L15 19', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }),
  );
}

/** A small-caps section heading, optionally with an action on the right. */
export function sectionHeader(label: string, action?: { text: string; onClick: () => void }): HTMLElement {
  return h('div', { class: 'section' },
    h('span', { class: 'label', text: label }),
    action ? h('button', { class: 'linky', onclick: action.onClick, text: action.text }) : null,
  );
}

export function pill(
  label: string,
  onclick: () => void,
  kind: 'primary' | 'accent' | 'ghost' | '' = '',
): HTMLButtonElement {
  return h('button', {
    class: `pill ${kind}`.trim(),
    onclick: () => {
      haptics.tick();
      onclick();
    },
  }, label);
}

export function clearToast(): void {
  toastEl?.classList.remove('in');
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
  ticker.schedule(ms, () => {
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
export function stars(n: number): HTMLElement {
  return h('span', { class: 'stars', 'aria-label': `${n} of 3 stars` }, ...starRow(n));
}

// ---------------------------------------------------------------------------
// Stats blocks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The big colour card — the unit the home and chapter lists are built from
// ---------------------------------------------------------------------------

export interface CardSpec {
  /** A stable hook for tests and deep links; becomes data-card. */
  id?: string;
  color: string;
  title: string;
  blurb: string;
  /** Bottom-left: the thing you'd read first when scanning. */
  foot?: string;
  /** Bottom-right: quieter, a by-line or a count. */
  note?: string;
  art?: SVGElement | HTMLElement;
  onOpen: () => void;
}

/**
 * A full-bleed card in one saturated colour with black type on it, after the
 * NYT Games home screen. The colour does the work of an icon: you learn a
 * chapter by its colour long before you read its name.
 *
 * Every card opens: nothing in Thread is locked, so there is no badge, no
 * dimmed state and no card that answers a press with a refusal.
 */
export function gameCard(spec: CardSpec): HTMLElement {
  const card = h('button', {
    class: 'gamecard',
    'data-card': spec.id ?? '',
    style: `--card:${spec.color}`,
    onclick: () => {
      haptics.tick();
      spec.onOpen();
    },
  },
    h('div', { class: 'cardhead' },
      h('div', { class: 'cardtext' },
        h('h3', { class: 'display', text: spec.title }),
        h('p', { text: spec.blurb }),
      ),
      spec.art ? h('span', { class: 'cardart', 'aria-hidden': 'true' }, spec.art) : null,
    ),
    (spec.foot || spec.note)
      ? h('div', { class: 'cardfoot' },
        h('span', { class: 'foot', text: spec.foot ?? '' }),
        h('span', { class: 'note', text: spec.note ?? '' }),
      )
      : null,
  );
  return card;
}

