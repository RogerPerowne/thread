/**
 * Mode icons, drawn as flat geometric marks on a soft tile — the same idea as
 * the NYT Games app, where each game is a coloured square with one simple
 * shape inside it. Every mark here is a piece of Thread's own vocabulary: a
 * loop, a star, a keyhole, a weave.
 */

import { svg } from './dom.js';

type Draw = (ink: string) => SVGElement[];

const N = 'http://www.w3.org/2000/svg';
const path = (d: string, ink: string, fill = 'none', w = 5.5): SVGElement => {
  const el = document.createElementNS(N, 'path');
  el.setAttribute('d', d);
  el.setAttribute('stroke', ink);
  el.setAttribute('stroke-width', String(w));
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('fill', fill);
  return el;
};
const dot = (x: number, y: number, ink: string, r = 3.6): SVGElement => {
  const el = document.createElementNS(N, 'circle');
  el.setAttribute('cx', String(x));
  el.setAttribute('cy', String(y));
  el.setAttribute('r', String(r));
  el.setAttribute('fill', ink);
  return el;
};

/** Points of a regular polygon on a 100-box. */
function ring(n: number, r: number, rot = -Math.PI / 2): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)] as [number, number];
  });
}

const poly = (pts: Array<[number, number]>, ink: string, fill = 'none', w = 5.5) =>
  path(pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z', ink, fill, w);

const MARKS: Record<string, Draw> = {
  // A closed loop over five pegs.
  classic: (ink) => {
    const p = ring(5, 27);
    return [poly(p, ink), ...p.map(([x, y]) => dot(x, y, ink))];
  },
  // Two threads meeting.
  weave: (ink) => [
    path('M18 34 H82', ink),
    path('M18 66 H82', ink),
    path('M34 18 V82', ink),
    path('M66 18 V82', ink),
  ],
  // Today's shape, still under wraps.
  daily: (ink) => {
    const p = ring(6, 27);
    return [poly(p, ink, 'none'), dot(50, 50, ink, 5)];
  },
  // A star: the same pegs, a different order.
  blitz: (ink) => {
    const r = ring(5, 29);
    const order = [0, 2, 4, 1, 3].map((i) => r[i]);
    return [poly(order, ink, 'none', 5)];
  },
  // A single thread, one life.
  onelife: (ink) => {
    const p = ring(3, 29);
    return [poly(p, ink), ...p.map(([x, y]) => dot(x, y, ink))];
  },
  // A calm, open curve.
  zen: (ink) => [
    path('M20 62 C20 34 42 22 50 38 C58 54 80 42 80 62', ink),
    dot(20, 62, ink), dot(80, 62, ink),
  ],
  // A measured mark.
  assess: (ink) => [
    path('M22 74 V50', ink), path('M50 74 V34', ink), path('M78 74 V44', ink),
    path('M16 82 H84', ink, 'none', 4.5),
  ],
  // A keyhole: the shape with a hole in it.
  workshop: (ink) => [poly(ring(4, 30), ink), poly(ring(4, 13), ink, 'none', 4.5)],
};

const SOFT: Record<string, string> = {
  classic: 'var(--classic-soft)', weave: 'var(--weave-soft)', daily: 'var(--daily-soft)',
  blitz: 'var(--blitz-soft)', onelife: 'var(--onelife-soft)', zen: 'var(--zen-soft)',
  assess: 'var(--assess-soft)', workshop: 'var(--workshop-soft)',
};
const INK: Record<string, string> = {
  classic: 'var(--classic)', weave: 'var(--weave)', daily: 'var(--daily)',
  blitz: 'var(--blitz)', onelife: 'var(--onelife)', zen: 'var(--zen)',
  assess: 'var(--assess)', workshop: 'var(--workshop)',
};

/** The coloured tile for a mode. */
export function modeIcon(mode: string): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  root.appendChild(svg('rect', { x: 0, y: 0, width: 100, height: 100, fill: SOFT[mode] ?? 'var(--panel)' }));
  const draw = MARKS[mode] ?? MARKS.classic;
  for (const node of draw(INK[mode] ?? 'var(--ink)')) root.appendChild(node);
  return root;
}

/**
 * The same mark with no tile behind it, in one ink. This is what sits on a
 * full-colour card, where a second background would fight the card itself.
 */
export function modeMark(mode: string, ink = 'currentColor'): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const draw = MARKS[mode] ?? MARKS.classic;
  for (const node of draw(ink)) root.appendChild(node);
  return root;
}

export function modeSoft(mode: string): string {
  return SOFT[mode] ?? 'var(--panel)';
}

export function modeInk(mode: string): string {
  return INK[mode] ?? 'var(--ink)';
}

// ---------------------------------------------------------------------------
// Tab bar glyphs — thin line marks, drawn to the same weight as each other.
// ---------------------------------------------------------------------------

const TABS: Record<string, string[]> = {
  home: ['M4 11 L12 4 L20 11', 'M6.5 9.5 V19 H17.5 V9.5'],
  gallery: ['M4 4 H10.5 V10.5 H4 Z', 'M13.5 4 H20 V10.5 H13.5 Z', 'M4 13.5 H10.5 V20 H4 Z', 'M13.5 13.5 H20 V20 H13.5 Z'],
  stats: ['M5 20 V12', 'M12 20 V5', 'M19 20 V9'],
  settings: ['M12 15.2 A3.2 3.2 0 1 0 12 8.8 A3.2 3.2 0 1 0 12 15.2 Z', 'M12 2.6 L13.4 5.2 M12 21.4 L10.6 18.8 M2.6 12 L5.2 10.6 M21.4 12 L18.8 13.4 M5.3 5.3 L7.6 6.8 M18.7 18.7 L16.4 17.2 M5.3 18.7 L7.6 17.2 M18.7 5.3 L16.4 6.8'],
};

/** A small drawn padlock — an emoji renders differently on every platform. */
export function padlock(size = 15): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: 'none' });
  root.appendChild(svg('rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2.2, fill: 'currentColor' }));
  root.appendChild(svg('path', {
    d: 'M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round',
  }));
  return root;
}

// ---------------------------------------------------------------------------
// UI marks. Every one of these is drawn rather than typed: a character like
// the gear, the arrow or the star is a font glyph, so it changes shape between
// platforms, ignores the stroke weight around it, and is at the mercy of
// whatever fallback font the device reaches for. Drawing them keeps one line
// weight across the whole interface.
// ---------------------------------------------------------------------------

function markSvg(size: number, ...kids: SVGElement[]): SVGSVGElement {
  const root = svg('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': 'true',
  });
  for (const k of kids) root.appendChild(k);
  return root;
}

const line = (d: string, w = 2) => svg('path', {
  d, stroke: 'currentColor', 'stroke-width': w,
  'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none',
});

export function chevronRight(size = 18): SVGSVGElement {
  return markSvg(size, line('M9.5 5 L16 12 L9.5 19', 2.2));
}

export function arrowDown(size = 18): SVGSVGElement {
  return markSvg(size, line('M12 4.5 V18.5', 2.2), line('M6 13 L12 19 L18 13', 2.2));
}

export function gear(size = 20): SVGSVGElement {
  return markSvg(size,
    line('M12 15.2 A3.2 3.2 0 1 0 12 8.8 A3.2 3.2 0 1 0 12 15.2 Z', 1.9),
    line('M12 2.6 L12 5.2 M12 21.4 L12 18.8 M2.6 12 L5.2 12 M21.4 12 L18.8 12'
      + ' M5.3 5.3 L7.1 7.1 M18.7 18.7 L16.9 16.9 M5.3 18.7 L7.1 16.9 M18.7 5.3 L16.9 7.1', 1.9),
  );
}

export function question(size = 20): SVGSVGElement {
  return markSvg(size,
    line('M8.6 9 A3.4 3.4 0 1 1 12 13 V14.8', 2.2),
    svg('circle', { cx: 12, cy: 18.4, r: 1.25, fill: 'currentColor' }),
  );
}

/** Save the poster to a file. */
export function download(size = 20): SVGSVGElement {
  return markSvg(size, line('M12 3.5 V15', 2.1), line('M7 10.5 L12 15.5 L17 10.5', 2.1),
    line('M4.5 19.5 H19.5', 2.1));
}

/** Open a shared level by its code. */
export function codeMark(size = 20): SVGSVGElement {
  return markSvg(size, line('M9.5 7.5 L5 12 L9.5 16.5', 2.1),
    line('M14.5 7.5 L19 12 L14.5 16.5', 2.1));
}

/** Take me back to where I am — a locator, so it does not have to know
 *  whether the thing it is finding is above or below. */
export function locate(size = 18): SVGSVGElement {
  return markSvg(size,
    svg('circle', { cx: 12, cy: 12, r: 5.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2 }),
    svg('circle', { cx: 12, cy: 12, r: 1.7, fill: 'currentColor' }),
    line('M12 2.6 V5.4 M12 18.6 V21.4 M2.6 12 H5.4 M18.6 12 H21.4', 2.2),
  );
}

/** A star, filled or hollow, for a level's three-star rating. */
export function star(filled: boolean, size = 13): SVGSVGElement {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 10.5 : 4.4;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`);
  }
  const d = `M${pts.join(' L')} Z`;
  return markSvg(size, svg('path', {
    d,
    fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor',
    'stroke-width': filled ? 1 : 1.8,
    'stroke-linejoin': 'round',
  }));
}

/** Three stars in a row: `got` of them filled. */
export function starRow(got: number, size = 13): SVGSVGElement[] {
  return [0, 1, 2].map((i) => star(i < got, size));
}

export function tabIcon(name: string): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none' });
  for (const d of TABS[name] ?? TABS.home) {
    root.appendChild(svg('path', {
      d, stroke: 'currentColor', 'stroke-width': 1.9,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));
  }
  return root;
}
