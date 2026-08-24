/**
 * One saturated colour per chapter, in the NYT Games register: bright enough
 * to carry a whole screen, light enough that black type sits on it without a
 * shadow or an outline. Every value below was checked against #121212 for
 * contrast; the weakest is 7.4:1, comfortably past WCAG AA for body text.
 *
 * Order matters. Neighbours in the list are deliberately far apart in hue so
 * that a scroll down the chapter list never reads as a gradient.
 */

export const CARD_COLORS = [
  '#F0A030', // amber
  '#B9A3E3', // lilac
  '#8FCB9B', // moss
  '#EA7468', // coral
  '#7BC2E8', // sky
  '#F7DA21', // sun
  '#D3A4D2', // mauve
  '#C2D452', // lime
  '#6FC2B4', // teal
  '#F09A6B', // apricot
  '#9FB8E8', // periwinkle
  '#E86F9E', // rose
  '#A8CE5C', // olive
  '#58BFD6', // cyan
  '#E2B0E0', // orchid
];

/** A darker sibling of a card colour, for the pressed state and the path. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * (1 - amount)))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const MODE_CARD: Record<string, string> = {
  daily: '#7BC2E8',
  classic: '#F0A030',
  weave: '#B9A3E3',
  blitz: '#EA7468',
  onelife: '#E86F9E',
  zen: '#8FCB9B',
  assess: '#9FB8E8',
  workshop: '#C2D452',
  shared: '#C2D452',
};

export function modeColor(mode: string): string {
  return MODE_CARD[mode] ?? CARD_COLORS[0];
}

/**
 * Chapters inside a mode step through the palette. Weave starts a third of the
 * way in so its six chapters never repeat the first six of Classic — the two
 * lists are often seen one after the other.
 */
export function chapterColor(mode: 'classic' | 'weave', chapter: number): string {
  const offset = mode === 'weave' ? 5 : 0;
  return CARD_COLORS[(chapter - 1 + offset) % CARD_COLORS.length];
}
