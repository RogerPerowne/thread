/**
 * Seven themes, each with its own palette and instrument, unlocked by
 * progression. Thread skins are separate — cosmetics tied to mastery rather
 * than to a currency, because currency feels like a chore.
 */

export type Theme = {
  id: string;
  name: string;
  /** Board background and peg colours. */
  board: string;
  peg: string;
  pegLive: string;
  /** Ghost of the target shape. */
  target: string;
  /** Default thread colour when a level does not name one. */
  thread: string;
  /** Oscillator used by the pluck. */
  instrument: OscillatorType;
  /** Harmonic weighting — what makes copper sound unlike glass. */
  timbre: number;
  unlock: string;
};

export const THEMES: Theme[] = [
  { id: 'paper',   name: 'Paper',    board: '#FFFFFF', peg: '#DCDCDC', pegLive: '#121212', target: '#121212', thread: '#7A4FBF', instrument: 'triangle', timbre: 0.30, unlock: '' },
  { id: 'slate',   name: 'Slate',    board: '#1B1D21', peg: '#3A3F47', pegLive: '#F2F2F2', target: '#F2F2F2', thread: '#5FB3D9', instrument: 'sine',     timbre: 0.18, unlock: 'Finish Chapter 3' },
  { id: 'copper',  name: 'Copper',   board: '#F6EFE7', peg: '#D8C3AC', pegLive: '#6B4423', target: '#6B4423', thread: '#B87333', instrument: 'sawtooth', timbre: 0.45, unlock: 'Finish Chapter 6' },
  { id: 'linen',   name: 'Linen',    board: '#FAF7F0', peg: '#DDD6C6', pegLive: '#2E3A2F', target: '#2E3A2F', thread: '#4F7A56', instrument: 'triangle', timbre: 0.24, unlock: 'Finish Chapter 9' },
  { id: 'neon',    name: 'Neon',     board: '#0E0B1A', peg: '#2A2445', pegLive: '#E6E1FF', target: '#E6E1FF', thread: '#FF2D95', instrument: 'square',   timbre: 0.55, unlock: 'Finish Weave' },
  { id: 'glass',   name: 'Glass',    board: '#EAF2F6', peg: '#C6D8E2', pegLive: '#123A4B', target: '#123A4B', thread: '#1F8A8A', instrument: 'sine',     timbre: 0.12, unlock: 'Finish Chapter 12' },
  { id: 'gold',    name: 'Gold',     board: '#14110A', peg: '#3B331C', pegLive: '#F5E7C0', target: '#F5E7C0', thread: '#C8A020', instrument: 'triangle', timbre: 0.38, unlock: 'Finish The Loom' },
];

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export type Skin = {
  id: string;
  name: string;
  /** Stroke width multiplier. */
  weight: number;
  /** null = solid; otherwise an SVG dash array in board units. */
  dash: string | null;
  cap: 'round' | 'square' | 'butt';
  /** A second stroke underneath, for wire and glass. */
  under: string | null;
  unlock: string;
};

/**
 * Threads are distinguished by dash pattern and cap shape as well as colour,
 * so a colourblind player can always tell them apart.
 */
export const SKINS: Skin[] = [
  { id: 'silk',   name: 'Silk',   weight: 1.0, dash: null,      cap: 'round',  under: null,      unlock: '' },
  { id: 'copper', name: 'Copper', weight: 1.2, dash: null,      cap: 'square', under: '#00000022', unlock: 'Solve 25 levels' },
  { id: 'neon',   name: 'Neon',   weight: 0.9, dash: null,      cap: 'round',  under: '#FFFFFF44', unlock: 'Perfect 10 levels' },
  { id: 'gold',   name: 'Gold',   weight: 1.3, dash: null,      cap: 'round',  under: '#00000033', unlock: 'Three-star a chapter' },
  { id: 'glass',  name: 'Glass',  weight: 1.6, dash: null,      cap: 'butt',   under: '#FFFFFF66', unlock: 'Finish Chapter 10' },
  { id: 'dash',   name: 'Stitch', weight: 1.0, dash: '2.4 1.6', cap: 'butt',   under: null,      unlock: 'Solve 100 levels' },
  { id: 'twine',  name: 'Twine',  weight: 1.4, dash: '5 1.2',   cap: 'square', under: '#00000022', unlock: 'A 14-day streak' },
];

export function skinById(id: string): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/**
 * Thread colours chosen to stay distinguishable under the common forms of
 * colour vision deficiency. Dash and cap do the rest of the work.
 */
export const THREAD_COLORS = ['#7A4FBF', '#D98324', '#1F8A8A', '#C0392B'];

/** Where two thread regions overlap the colour mixes — chapter 9. */
export function blendColors(colors: string[]): string {
  if (colors.length === 1) return colors[0];
  let r = 0, g = 0, b = 0;
  for (const c of colors) {
    r += parseInt(c.slice(1, 3), 16);
    g += parseInt(c.slice(3, 5), 16);
    b += parseInt(c.slice(5, 7), 16);
  }
  const n = colors.length;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
