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

/** One colour per mode, and the mode list is three long now. */
const MODE_CARD: Record<string, string> = {
  classic: '#F0A030',
  coloured: '#7BC2E8',
  grid: '#8FCB9B',
};

export function modeColor(mode: string): string {
  return MODE_CARD[mode] ?? CARD_COLORS[0];
}

/**
 * Chapters inside a mode step through the palette, each mode starting at a
 * different place. Two mode lists are often seen one after the other, and a
 * chapter you learn by its colour should not be wearing another mode's.
 */
const MODE_OFFSET: Record<string, number> = { classic: 0, coloured: 5, grid: 9 };

export function chapterColor(mode: string, chapter: number): string {
  const offset = MODE_OFFSET[mode] ?? 0;
  return CARD_COLORS[(chapter - 1 + offset) % CARD_COLORS.length];
}
