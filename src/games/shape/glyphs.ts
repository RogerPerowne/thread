/**
 * The shapes.
 *
 * Five marks that stay apart from each other at fifteen pixels on a phone,
 * which is the size a cell on a seven-wide board actually gets. They are told
 * apart by OUTLINE, not by colour and not by fill: a circle, a square standing
 * square, a triangle, a diamond and a cross. Rotate any of them and it is
 * still itself, and none of them is a rotation of another — which rules out
 * the obvious sixth, a hexagon, because at this size a hexagon is a circle.
 *
 * Every one is drawn to the same visual weight rather than the same bounding
 * box: a square with the side of a circle's diameter reads much heavier than
 * the circle, so the square is drawn smaller and the triangle larger, and the
 * numbers below are the ones that make them look the same size.
 */

export const GLYPHS = ['circle', 'square', 'triangle', 'diamond', 'cross'] as const;
export type GlyphName = (typeof GLYPHS)[number];

/** The name of shape `n`, counting from one. For labels and hints. */
export function glyphName(n: number): string {
  return GLYPHS[n - 1] ?? `shape ${n}`;
}

/**
 * One shape, centred on the origin, at radius `r`.
 *
 * The weights: a square at 0.88 of the circle's radius covers the same ink; a
 * triangle needs 1.18 because so much of its box is empty; a diamond 1.14 for
 * the same reason; the cross is drawn as a stroked path so its arms reach the
 * full radius.
 */
export function glyphPath(n: number, r: number): string {
  const p = (x: number, y: number) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  switch (GLYPHS[n - 1]) {
    case 'circle':
      return `M ${p(-r, 0)} a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(r * 2).toFixed(2)} 0`
        + ` a ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-r * 2).toFixed(2)} 0 Z`;
    case 'square': {
      const s = r * 0.88;
      return `M ${p(-s, -s)} L ${p(s, -s)} L ${p(s, s)} L ${p(-s, s)} Z`;
    }
    case 'triangle': {
      const s = r * 1.18;
      /* Sitting on its base, and shifted down a touch so the ink is centred:
         a triangle's area is all at the bottom, so centring its bounding box
         leaves it looking high. */
      const d = s * 0.12;
      return `M ${p(0, -s + d)} L ${p(s * 0.92, s * 0.62 + d)} L ${p(-s * 0.92, s * 0.62 + d)} Z`;
    }
    case 'diamond': {
      const s = r * 1.14;
      return `M ${p(0, -s)} L ${p(s, 0)} L ${p(0, s)} L ${p(-s, 0)} Z`;
    }
    default: {
      /* The cross, as a filled plus so it holds up at small sizes where a
         stroked one would thin out with the rest of the drawing. */
      const a = r * 1.05;
      const b = r * 0.34;
      return `M ${p(-b, -a)} L ${p(b, -a)} L ${p(b, -b)} L ${p(a, -b)} L ${p(a, b)}`
        + ` L ${p(b, b)} L ${p(b, a)} L ${p(-b, a)} L ${p(-b, b)} L ${p(-a, b)}`
        + ` L ${p(-a, -b)} L ${p(-b, -b)} Z`;
    }
  }
}
