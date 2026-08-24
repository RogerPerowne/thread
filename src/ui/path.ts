/**
 * The chapter path: levels laid out as isometric tiles along a meandering
 * ribbon, the way a course map reads in a learning app.
 *
 * The geometry is not invented. Every constant below was measured off
 * reference/brilliant-source.png and is held to by
 * scripts/compare-reference.mjs, which scores a bare copy of that screen
 * against the original before any of Thread's styling is applied. What
 * changes here is the paint, not the shape: NYT-register colour, black ink,
 * Thread's own tile states.
 *
 * The whole thing is one SVG built once. Nothing re-serialises during play or
 * on scroll; state changes mutate attributes.
 */

import { svg, h } from './dom.js';
import { shade } from './palette.js';

// -- measured geometry, in reference units (the viewBox is 771 wide) --------

export const VIEW_W = 771;
/** Half-width, half-height and extrusion depth of one isometric tile. */
const HW = 72, HH = 44, EXT = 24;
/** One turn of the meander, and where the four tiles of that turn sit. */
const PERIOD = 1035;
const TILE_SLOTS: [number, number][] = [[191, 0], [390, 274], [608, 517], [390, 766]];
/** Corner list for one turn, offset from the turn's first tile. */
const CORNERS: [number, number][] = [
  [191, 5], [-42, 156], [283, 350], [530, 198],
  [835, 394], [289, 721], [639, 927], [330, 1117],
];
const PATH_W = 11.6;
/** Vertical room above the first tile and below the last. */
const HEAD = 196, TAIL = 216;

export type TileState = 'done' | 'next' | 'locked';

export interface PathNode {
  label: string;
  sub?: string;
  /** 0-3, shown as drawn stars under the label once the level is solved. */
  stars?: number;
  state: TileState;
  gem?: boolean;
  onOpen: () => void;
}

export interface PathView {
  el: HTMLElement;
  /** Scroll the container so the `next` tile sits in comfortable view. */
  scrollToCurrent: (behavior?: ScrollBehavior) => void;
  currentY: number;
}

/** Where tile `i` sits, in reference units. */
export function tileAt(i: number): [number, number] {
  const turn = Math.floor(i / TILE_SLOTS.length);
  const [x, dy] = TILE_SLOTS[i % TILE_SLOTS.length];
  return [x, HEAD + turn * PERIOD + dy];
}

function meanderPoints(count: number): [number, number][] {
  const turns = Math.ceil(count / TILE_SLOTS.length) + 1;
  const pts: [number, number][] = [];
  for (let t = -1; t < turns; t++) {
    for (const [x, dy] of CORNERS) pts.push([x, HEAD + t * PERIOD + dy]);
  }
  return pts;
}

function roundPoly(v: [number, number][], r: number): string {
  const lead = (a: [number, number], b: [number, number]): [number, number] => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.min(r / (Math.hypot(dx, dy) || 1), 0.48);
    return [a[0] + dx * t, a[1] + dy * t];
  };
  let d = '';
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    const a = lead(p, v[(i + v.length - 1) % v.length]);
    const b = lead(p, v[(i + 1) % v.length]);
    d += `${i === 0 ? 'M' : 'L'} ${a[0].toFixed(2)} ${a[1].toFixed(2)} `;
    d += `Q ${p[0].toFixed(2)} ${p[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `;
  }
  return `${d}Z`;
}

const diamond = (cx: number, cy: number, hw: number, hh: number, r: number) =>
  roundPoly([[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]], r);

/*
 * The extruded body is the top face swept straight down, so it is built from
 * the top face's own rounded outline. Rounding a six-sided silhouette on its
 * own pulls the side corners inside the top face's corners and leaves a notch
 * of background showing where the two should meet.
 *
 * A vertical sweep of a convex shape is the shape at the bottom of the sweep
 * plus a band between its leftmost and rightmost points. For a quadratic
 * corner those extreme points — the only places where the tangent is vertical
 * — sit at hw * (1 - t/2) from the centre, so the band meets the curves
 * tangentially: no seam, no overhang. The top face is drawn over the result.
 */
const TILE_R = 7;

/**
 * How far the rounded diamond actually reaches sideways. The fillet pulls the
 * left and right points in: the widest place on the outline is the corner
 * curve's midpoint, at HW * (1 - t/2), not the un-rounded vertex at HW. Both
 * the extrusion band and the column of light above the tile are sized from
 * this, so they line up with the tile's real silhouette rather than
 * overhanging it.
 */
const EXTREME_X = HW * (1 - Math.min(TILE_R / Math.hypot(HW, HH), 0.48) / 2);

function body(cx: number, cy: number): string {
  const ex = EXTREME_X;
  const band = `M ${(cx - ex).toFixed(2)} ${(cy - 0.4).toFixed(2)}`
    + ` L ${(cx + ex).toFixed(2)} ${(cy - 0.4).toFixed(2)}`
    + ` L ${(cx + ex).toFixed(2)} ${(cy + EXT + 0.4).toFixed(2)}`
    + ` L ${(cx - ex).toFixed(2)} ${(cy + EXT + 0.4).toFixed(2)} Z`;
  return `${diamond(cx, cy + EXT, HW, HH, TILE_R)} ${band}`;
}

// -- tile faces -------------------------------------------------------------

/**
 * Solved tiles are solid ink, the way a filled NYT pill is. The tile you are
 * up to is paper-white, so it is the one thing on the screen that is neither
 * the chapter's colour nor black. Locked tiles are the chapter's colour taken
 * down a few steps — recessed into the board rather than greyed out, and
 * opaque, so the ribbon passes behind them like it does behind every other
 * tile rather than showing through.
 */
function faces(state: TileState, color: string): { top: string; inner: string; side: string; ink: string } {
  if (state === 'done') return { top: '#242424', inner: '#3A3A3A', side: '#000000', ink: '#FFFFFF' };
  if (state === 'next') return { top: '#FFFFFF', inner: '#FFFFFF', side: '#1A1A1A', ink: '#121212' };
  return {
    // The inner panel stays lighter than the rim, as it is on every other
    // tile — a locked level is dimmed, not inverted.
    top: shade(color, 0.26),
    inner: shade(color, 0.15),
    side: shade(color, 0.46),
    ink: shade(color, 0.60),
  };
}

/*
 * Glyphs on the tile face.
 *
 * Every glyph is authored the ordinary way — flat and upright, in a 100x100
 * box centred on the origin — and then placed by construction, so nothing is
 * positioned or rotated by hand and no glyph can drift off centre.
 *
 * The tile's top face is a diamond: the image of a square rotated 45 degrees
 * and foreshortened. Projecting a glyph onto it is therefore the face map
 *
 *     x = (u - v) * HW / 2S        y = (u + v) * HH / 2S
 *
 * composed with the 45 degrees the diamond already carries. Multiply the two
 * and the rotation cancels: what is left is a pure anisotropic scale,
 * sqrt(2) * HW / BOX across and sqrt(2) * HH / BOX down. So an upright glyph
 * stays upright and simply lies down on the tile.
 *
 * That is not a guess. Un-projecting the checkmark measured off the reference
 * screenshot through this scale gives (-14.7, -4.8) (-4.9, 8.0) (13.7, -20.9)
 * — an ordinary upright tick, which is what it must be if the original was
 * drawn flat and projected the same way.
 *
 * Strokes scale with the glyph rather than staying a fixed screen width, which
 * is what makes the mark read as printed on the surface instead of floating
 * over it. Keep artwork inside about +/-26 local units: the box's corners fall
 * outside the diamond, its inscribed diamond does not.
 */
const GLYPH_BOX = 100;
const FACE_SX = Math.SQRT2 * HW / GLYPH_BOX;
const FACE_SY = Math.SQRT2 * HH / GLYPH_BOX;

/** Lay a flat, upright glyph on the face of the tile centred at (cx, cy). */
function onFace(cx: number, cy: number, ...kids: SVGElement[]): SVGElement {
  return svg('g', {
    transform: `translate(${cx} ${cy}) scale(${FACE_SX.toFixed(4)} ${FACE_SY.toFixed(4)})`,
  }, ...kids);
}

const stroked = (d: string, ink: string, w = 9) => svg('path', {
  d, fill: 'none', stroke: ink, 'stroke-width': w,
  'stroke-linecap': 'round', 'stroke-linejoin': 'round',
});

/** Solved. */
const checkMark = (cx: number, cy: number, ink: string) =>
  onFace(cx, cy, stroked('M -15 -4 L -5 8 L 14 -18', ink));

/** The one you are up to. */
const playMark = (cx: number, cy: number, ink: string) =>
  onFace(cx, cy, svg('path', {
    d: 'M -8 -15 L 17 0 L -8 15 Z',
    fill: ink, stroke: ink, 'stroke-width': 7, 'stroke-linejoin': 'round',
  }));

/** Not yet yours. */
const lockMark = (cx: number, cy: number, ink: string) =>
  onFace(cx, cy,
    svg('rect', { x: -13, y: -2, width: 26, height: 19, rx: 5, fill: ink }),
    stroked('M -7 -3 L -7 -10 A 7 7 0 0 1 7 -10 L 7 -3', ink, 6),
  );

/** A gem level, once solved: the tick gives way to the mark of the thing. */
const gemMark = (cx: number, cy: number, ink: string) =>
  onFace(cx, cy, stroked('M 0 -17 L 17 0 L 0 17 L -17 0 Z', ink, 8));

/** Three drawn stars under a solved tile. A font glyph would not hold its
 *  shape across platforms, and would ignore the weight of everything near it. */
function starsUnder(cx: number, cy: number, got: number): SVGElement {
  const g = svg('g', { class: 'pstars', 'aria-hidden': 'true' });
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 11 : 4.6;
    pts.push(`${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`);
  }
  const d = `M${pts.join(' L')} Z`;
  for (let i = 0; i < 3; i++) {
    g.appendChild(svg('path', {
      d,
      transform: `translate(${cx + (i - 1) * 30} ${cy})`,
      fill: i < got ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': i < got ? 1.2 : 2.4,
      'stroke-linejoin': 'round',
      opacity: i < got ? 0.9 : 0.34,
    }));
  }
  return g;
}

// -- the view ---------------------------------------------------------------

export function chapterPath(nodes: PathNode[], color: string): PathView {
  const count = nodes.length;
  const height = HEAD + Math.floor((count - 1) / TILE_SLOTS.length) * PERIOD
    + TILE_SLOTS[(count - 1) % TILE_SLOTS.length][1] + TAIL;

  const root = svg('svg', {
    class: 'pathsvg',
    viewBox: `0 0 ${VIEW_W} ${height}`,
    width: '100%',
    role: 'list',
    'aria-label': 'Levels',
  });

  const defs = svg('defs');
  // A column of light rising behind the tile you are up to. It runs down to
  // the tile's widest row and is cut off by the tile itself, so the light
  // hugs the tile's upper edges rather than stopping in mid-air above its top
  // corner — which is what makes it read as a glow around the tile at all.
  const halo = svg('linearGradient', { id: 'pathhalo', x1: 0, y1: 0, x2: 0, y2: 1 });
  halo.appendChild(svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }));
  halo.appendChild(svg('stop', { offset: '0.58', 'stop-color': '#fff', 'stop-opacity': '0.3' }));
  halo.appendChild(svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0.34' }));
  defs.appendChild(halo);
  root.appendChild(defs);

  // The ribbon. Two strokes on the same polyline: the whole run in a soft
  // wash, then the solved prefix in ink, so progress is legible at a glance
  // without a separate progress read-out.
  const pts = meanderPoints(count);
  const asStr = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  root.appendChild(svg('polyline', {
    points: asStr, fill: 'none', stroke: 'rgba(255,255,255,0.55)',
    'stroke-width': PATH_W, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  const doneUpTo = nodes.findIndex((n) => n.state !== 'done');
  const lastDone = doneUpTo === -1 ? count - 1 : doneUpTo - 1;
  if (lastDone >= 0) {
    const [, cutY] = tileAt(lastDone);
    const trail = svg('polyline', {
      points: asStr, fill: 'none', stroke: shade(color, 0.55),
      'stroke-width': PATH_W, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'clip-path': 'url(#pathdone)',
    });
    const clip = svg('clipPath', { id: 'pathdone' });
    clip.appendChild(svg('rect', { x: -80, y: 0, width: VIEW_W + 200, height: cutY + HH }));
    defs.appendChild(clip);
    root.appendChild(trail);
  }

  let currentY = 0;
  nodes.forEach((node, i) => {
    const [cx, cy] = tileAt(i);
    const f = faces(node.state, color);
    if (node.state === 'next') currentY = cy;

    const g = svg('g', {
      class: `ptile ${node.state}`,
      role: 'listitem',
      tabindex: node.state === 'locked' ? -1 : 0,
      'aria-label': node.sub ? `${node.label}, ${node.sub}` : node.label,
      'aria-disabled': node.state === 'locked' ? 'true' : 'false',
    });

    if (node.state === 'next') {
      g.appendChild(svg('rect', {
        class: 'halo', x: cx - EXTREME_X, y: cy - 116, width: EXTREME_X * 2, height: 116,
        fill: 'url(#pathhalo)',
      }));
    }
    g.appendChild(svg('path', { class: 'side', d: body(cx, cy), fill: f.side }));
    g.appendChild(svg('path', { class: 'top', d: diamond(cx, cy, HW, HH, TILE_R), fill: f.top }));
    g.appendChild(svg('path', {
      class: 'inner', d: diamond(cx, cy, HW * 0.675, HH * 0.675, 6),
      fill: f.inner, opacity: node.state === 'next' ? 0 : 1,
    }));
    g.appendChild(
      node.state === 'locked' ? lockMark(cx, cy, f.ink)
        : node.state === 'next' ? playMark(cx, cy, f.ink)
          : node.gem ? gemMark(cx, cy, f.ink) : checkMark(cx, cy, f.ink),
    );

    const t1 = svg('text', {
      class: 'plabel', x: cx, y: cy + 104, 'text-anchor': 'middle',
    });
    t1.textContent = node.label;
    g.appendChild(t1);
    if (node.sub) {
      const t2 = svg('text', { class: 'psub', x: cx, y: cy + 145, 'text-anchor': 'middle' });
      t2.textContent = node.sub;
      g.appendChild(t2);
    } else if (node.stars) {
      g.appendChild(starsUnder(cx, cy + 132, node.stars));
    }

    if (node.state !== 'locked') {
      g.addEventListener('click', node.onOpen);
      g.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          node.onOpen();
        }
      });
    }
    root.appendChild(g);
  });

  const el = h('div', { class: 'pathwrap' }, root);

  /*
   * Long screens in this app scroll the document; short ones scroll an inner
   * box. Rather than assume either, walk up for the first ancestor that is
   * actually scrolling and fall back to the window — otherwise this silently
   * does nothing on exactly the screens that are long enough to need it.
   */
  const scrollToCurrent = (behavior: ScrollBehavior = 'smooth') => {
    if (!currentY) return;
    const box = root.getBoundingClientRect();
    // Called before the screen is in the document, every measurement is zero
    // and the scroll lands at the top — which looks like the feature simply
    // not working. Refuse to act on a measurement that cannot be real.
    if (box.width === 0) return;
    const scale = box.width / VIEW_W;
    // Where the tile sits now, relative to the viewport.
    const here = box.top + (currentY - HH) * scale;
    const wanted = window.innerHeight * 0.34;
    const delta = here - wanted;

    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const cs = getComputedStyle(scroller);
      if (/auto|scroll/.test(cs.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollBy({ top: delta, behavior });
    else window.scrollBy({ top: delta, behavior });
  };

  return { el, scrollToCurrent, currentY };
}
