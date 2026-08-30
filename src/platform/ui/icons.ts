/**
 * The icon set.
 *
 * Drawn here rather than fetched: a dozen glyphs is not worth a font or a
 * request, and drawing them means they inherit the type colour and the stroke
 * weight of everything around them. One grid (24), one weight (1.9), round
 * caps, no fills except where a shape is genuinely solid. They are meant to
 * look like they were cut from the same sheet as the boards.
 */

import { svg } from '../dom.js';

function glyph(...paths: SVGElement[]): SVGSVGElement {
  const el = svg('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.9,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, ...paths);
  return el;
}

const p = (d: string) => svg('path', { d });

export const icon = {
  back: () => glyph(p('M15 5 8 12l7 7')),
  close: () => glyph(p('M6 6l12 12M18 6L6 18')),
  undo: () => glyph(p('M9 8H5V4'), p('M5 8a8 8 0 1 1 1.5 8')),
  redo: () => glyph(p('M15 8h4V4'), p('M19 8a8 8 0 1 0-1.5 8')),
  restart: () => glyph(p('M5 6v5h5'), p('M5.6 11a7 7 0 1 1 .6 5')),
  hint: () => glyph(p('M9.5 18h5'), p('M10 21h4'), p('M12 3a6 6 0 0 1 3.6 10.8c-.7.5-1.1 1.3-1.1 2.2h-5c0-.9-.4-1.7-1.1-2.2A6 6 0 0 1 12 3Z')),
  rules: () => glyph(p('M6 4h9l3 3v13H6z'), p('M15 4v3h3'), p('M9 12h6M9 16h4')),
  pause: () => glyph(p('M9.5 5v14M14.5 5v14')),
  play: () => glyph(svg('path', { d: 'M8 5.5 19 12 8 18.5Z', fill: 'currentColor' })),
  tick: () => glyph(p('M5 12.5 10 17.5 19 6.5')),
  share: () => glyph(p('M12 3v12'), p('M8 7l4-4 4 4'), p('M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5')),
  next: () => glyph(p('M9 5l7 7-7 7')),
  flame: () => glyph(p('M12 3c3 3.5 4.5 5.8 4.5 8.2a4.5 4.5 0 0 1-9 0C7.5 9.4 9 7.6 10 6c.4 1.4 1 2.2 2 2.6-.3-2-.3-3.8 0-5.6Z')),
  stack: () => glyph(p('M12 4 4 8l8 4 8-4z'), p('M4 13l8 4 8-4')),
  /* An eye, for the control that shows the answer. Two strokes and no fill,
     so it carries the same weight as the arrows beside it. */
  reveal: () => glyph(
    p('M3 12c2.9-4.4 5.9-6.6 9-6.6s6.1 2.2 9 6.6c-2.9 4.4-5.9 6.6-9 6.6S5.9 16.4 3 12Z'),
    p('M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z'),
  ),
};

export type IconName = keyof typeof icon;
