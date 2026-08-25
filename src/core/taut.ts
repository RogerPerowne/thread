/**
 * The shape the string actually takes: taut around the posts.
 *
 * A string on a board of posts behaves like string on nails. It does not pass
 * through a post's centre and it does not cut the corner — it runs straight
 * until it meets the post, wraps the rim, and leaves along the next straight.
 * So the drawn path is a chain of common tangents between circles, joined by
 * arcs that hug each post.
 *
 * Which side of a post the string wraps is not a choice: a taut string always
 * takes the OUTSIDE of the turn. Given the path, every wrap direction and
 * every tangent follows from it, so what is drawn is fully determined by the
 * posts you chose — there is no hidden state and nothing for a player to have
 * to set.
 *
 * The centreline wraps at `WRAP_R = POST_R + STRING_W`, which puts the
 * string's inner edge exactly on the rim: it touches the post and does not
 * overlap it.
 */

import { type Pt, POST_R, STRING_W } from './board.js';

/** Radius of the centreline's arc around a post it wraps. */
export const WRAP_R = POST_R + STRING_W;

/**
 * How far the taut centreline can stray from the straight line through post
 * centres. It leaves that line to go around a post, and the furthest it gets
 * is the wrap radius — which is what the clearances in board.ts have to allow
 * for, or two strings drawn taut could touch while the rule called them clear.
 */
export const MAX_STRAY = WRAP_R;

type Vec = { x: number; y: number };

const sub = (a: Pt, b: Pt): Vec => ({ x: a[0] - b[0], y: a[1] - b[1] });
const len = (v: Vec) => Math.hypot(v.x, v.y);

/**
 * Which way the string wraps post `mid`, coming from `prev` and leaving to
 * `next`: +1 for anticlockwise, -1 for clockwise.
 *
 * A left turn puts the outside of the corner on the right, so the string wraps
 * clockwise, and the other way about.
 */
export function wrapSign(prev: Pt, mid: Pt, next: Pt): 1 | -1 {
  const a = sub(mid, prev);
  const b = sub(next, mid);
  const cross = a.x * b.y - a.y * b.x;
  return cross > 0 ? -1 : 1;
}

/** The wrap direction at every post on the path, ends included. */
export function wrapSigns(posts: readonly Pt[], path: readonly number[]): (1 | -1)[] {
  const n = path.length;
  const out: (1 | -1)[] = new Array(n).fill(1);
  for (let i = 1; i < n - 1; i++) {
    out[i] = wrapSign(posts[path[i - 1]], posts[path[i]], posts[path[i + 1]]);
  }
  // An end has no corner to be outside of, so it takes its neighbour's side.
  // That makes the first and last runs plain external tangents, and the string
  // finishes wrapped around its end post rather than stopping in mid air.
  if (n >= 2) {
    out[0] = out[1] ?? 1;
    out[n - 1] = out[n - 2] ?? 1;
  }
  return out;
}

export type Tangent = { from: Pt; to: Pt };

/**
 * The straight the string takes between two posts it wraps, given which way
 * it wraps each.
 *
 * Same directions give the external tangent — the two circles' common line on
 * one side. Opposite directions give the internal one, which crosses between
 * them; that needs the posts to be more than two wrap radii apart, and on any
 * real board they are.
 */
export function tangent(a: Pt, b: Pt, sa: number, sb: number, r = WRAP_R): Tangent {
  const d = sub(b, a);
  const dist = len(d);
  if (dist === 0) return { from: a, to: b };
  const ux = d.x / dist;
  const uy = d.y / dist;

  if (sa === sb) {
    // Both the same way round: offset the line by r, on the wrap side.
    const nx = uy * sa;
    const ny = -ux * sa;
    return {
      from: [a[0] + nx * r, a[1] + ny * r],
      to: [b[0] + nx * r, b[1] + ny * r],
    };
  }

  // Opposite ways: the string crosses over between the posts. The tangent
  // makes an angle with the centre line whose sine is 2r/dist.
  const sin = Math.min(1, (2 * r) / dist);
  const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
  // Rotate the perpendicular towards b by that angle.
  const px = uy * sa;
  const py = -ux * sa;
  const nx = px * cos + ux * sin;
  const ny = py * cos + uy * sin;
  return {
    from: [a[0] + nx * r, a[1] + ny * r],
    to: [b[0] - nx * r, b[1] - ny * r],
  };
}

/**
 * An SVG path for the string through these posts, drawn taut.
 *
 * Straights are `L`, wraps are `A` arcs of the wrap radius. The sweep flag is
 * the wrap direction, and in SVG's y-down space an anticlockwise turn is
 * sweep 0.
 */
export function tautPath(posts: readonly Pt[], path: readonly number[]): string {
  if (path.length === 0) return '';
  const p = (i: number) => posts[path[i]];
  if (path.length === 1) {
    // A string with one post is tied round it and nowhere else: draw the full
    // circle, so starting a strand shows on the board.
    const [x, y] = p(0);
    return `M${(x + WRAP_R).toFixed(2)} ${y.toFixed(2)}`
      + `A${WRAP_R} ${WRAP_R} 0 1 1 ${(x - WRAP_R).toFixed(2)} ${y.toFixed(2)}`
      + `A${WRAP_R} ${WRAP_R} 0 1 1 ${(x + WRAP_R).toFixed(2)} ${y.toFixed(2)}`;
  }

  const signs = wrapSigns(posts, path);
  const legs: Tangent[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    legs.push(tangent(p(i), p(i + 1), signs[i], signs[i + 1]));
  }

  const out: string[] = [];
  const at = (q: Pt) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
  out.push(`M${at(legs[0].from)}`);
  for (let i = 0; i < legs.length; i++) {
    out.push(`L${at(legs[i].to)}`);
    if (i + 1 < legs.length) {
      // Wrap the post between this leg and the next. Anticlockwise in a y-down
      // space is sweep 0.
      const sweep = signs[i + 1] === 1 ? 1 : 0;
      out.push(`A${WRAP_R} ${WRAP_R} 0 0 ${sweep} ${at(legs[i + 1].from)}`);
    }
  }
  return out.join('');
}

/**
 * Sample points along the taut centreline. Used by the tests that check the
 * rule is never more permissive than the drawing.
 */
export function tautSamples(
  posts: readonly Pt[], path: readonly number[], perLeg = 12,
): Pt[] {
  if (path.length < 2) return path.length ? [posts[path[0]]] : [];
  const p = (i: number) => posts[path[i]];
  const signs = wrapSigns(posts, path);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const leg = tangent(p(i), p(i + 1), signs[i], signs[i + 1]);
    for (let s = 0; s <= perLeg; s++) {
      const k = s / perLeg;
      out.push([
        leg.from[0] + (leg.to[0] - leg.from[0]) * k,
        leg.from[1] + (leg.to[1] - leg.from[1]) * k,
      ]);
    }
    if (i + 1 < path.length - 1) {
      // The arc round the next post, sampled the same way.
      const c = p(i + 1);
      const next = tangent(p(i + 1), p(i + 2), signs[i + 1], signs[i + 2]);
      const a0 = Math.atan2(leg.to[1] - c[1], leg.to[0] - c[0]);
      let a1 = Math.atan2(next.from[1] - c[1], next.from[0] - c[0]);
      const dir = signs[i + 1] === 1 ? 1 : -1;
      while (dir * (a1 - a0) < 0) a1 += dir * 2 * Math.PI;
      for (let s = 0; s <= perLeg; s++) {
        const a = a0 + ((a1 - a0) * s) / perLeg;
        out.push([c[0] + WRAP_R * Math.cos(a), c[1] + WRAP_R * Math.sin(a)]);
      }
    }
  }
  return out;
}

void STRING_W;
