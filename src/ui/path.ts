/**
 * The chapter path: levels as isometric tiles standing on a meandering ribbon.
 *
 * The geometry is not invented. Every constant here was measured off
 * reference/brilliant-source.png and is held to by
 * scripts/compare-reference.mjs, which scores a bare copy of that screen
 * against the original. What changes here is the paint, not the shape.
 *
 * Everything is authored in ground coordinates and drawn through a camera
 * (see camera.ts), so the view can move: tapping a tile flies the camera to
 * straight down over it, and its top face becomes an upright square. The
 * scene graph is built once; a camera move only rewrites attributes.
 */

import { svg, h } from './dom.js';
import { shade } from './palette.js';
import {
  type Cam, type Pt2, project, lift, groundOf, isoCam,
  ISO_PITCH, TILE_H, HALF_W, HALF_H,
} from './camera.js';

/*
 * A tile straddles the ribbon: its top face is half its height above the
 * surface and its base half below, so the ribbon runs into the middle of the
 * side face rather than meeting its top or bottom edge.
 */
const TOP_Z = TILE_H / 2;
const BOT_Z = -TILE_H / 2;

// -- measured geometry ------------------------------------------------------

export const VIEW_W = 771;
/** One turn of the meander, in the reference's own screen units. */
const PERIOD = 1035;
const CORNERS: [number, number][] = [
  [191, 5], [-42, 156], [283, 350], [530, 198],
  [835, 394], [289, 721], [639, 927], [330, 1117],
];
/** Where the four tiles of a turn sit. */
const TILE_SLOTS: [number, number][] = [[191, 0], [390, 274], [608, 517], [390, 766]];
const PER_TURN = TILE_SLOTS.length;
const PATH_W = 11.6;
/** The ribbon is a slab: this is how thick, in screen units at the iso view. */
const RIBBON_D = 9;
/** How far the column of light rises above the tile, in screen units at iso. */
const GLOW_PX = 116;
const HEAD = 196, TAIL = 216;

const PATH_WALKED = '#121212', PATH_WALKED_SIDE = '#000000';
const PATH_AHEAD = '#B3B3B3', PATH_AHEAD_SIDE = '#8C8C8C';

/** Ground-space versions of the above. Converted once, here. */
const G_PERIOD = PERIOD / HALF_H;                    // one turn, in ground v+u
const G_CORNERS = CORNERS.map(([x, y]) => groundOf(x, y));
const G_RIBBON_D = RIBBON_D / (HALF_W * Math.sin(ISO_PITCH));
const GLOW_H = GLOW_PX / (HALF_W * Math.sin(ISO_PITCH));

/** Advance a ground point by `n` turns down the meander. */
function downTurns(p: Pt2, n: number): Pt2 {
  return [p[0] + (n * G_PERIOD) / 2, p[1] + (n * G_PERIOD) / 2];
}

export type TileState = 'done' | 'next' | 'ahead';

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
  scrollToCurrent: (behavior?: ScrollBehavior) => void;
  currentY: number;
  height: number;
  /**
   * A flight from the resting view to straight down over tile `i`. The caller
   * drives it — `at(t)` draws the camera at progress t, `faceRect()` reports
   * where that tile's top face is on screen at whatever t was last drawn — so
   * one loop can run the whole entry sequence rather than three racing ones.
   */
  flight: (i: number) => { at: (t: number) => void; faceRect: () => DOMRect };
  faceRect: (i: number) => DOMRect;
  /** Put the view back where it rests. */
  reset: () => void;
}

// -- laying the run out -----------------------------------------------------

const TURN_PTS: Pt2[] = [...G_CORNERS, downTurns(G_CORNERS[0], 1)];

function projectOn(pts: Pt2[], p: Pt2): Pt2 {
  let best = pts[0], bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const q: Pt2 = [ax + dx * t, ay + dy * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/*
 * Tiles stand ON the ribbon rather than near it. The measured slots came off a
 * photograph and sit a few units off the line, so each is projected onto the
 * meander to find where the ribbon's surface actually passes. The tile then
 * sits half its own height above that point, which is what makes the ribbon
 * run into the middle of its side face.
 */
const SLOT_ANCHORS: Pt2[] = TILE_SLOTS.map((s) => projectOn(TURN_PTS, groundOf(s[0], s[1])));

function slotAt(k: number): Pt2 {
  return downTurns(SLOT_ANCHORS[k % PER_TURN], Math.floor(k / PER_TURN));
}

/** You climb: level one is the bottom slot and the chapter runs up the screen. */
function groundOfTile(i: number, count: number): Pt2 {
  return slotAt(count - 1 - i);
}

/**
 * Cut a polyline at the point on it nearest `at`, and hand back the two halves
 * with the cut point in both, so they meet exactly.
 *
 * This is what tells walked from ahead. The obvious alternative — clip the
 * ribbon at the current tile's HEIGHT — is wrong, and visibly so: the meander
 * doubles back on itself as it descends, so a horizontal line through the tile
 * you are up to also crosses stretches of path you walked ten levels ago and
 * stretches you have not reached. Position along the run is the only thing
 * that says which is which.
 */
function splitPolyline(pts: Pt2[], at: Pt2): { before: Pt2[]; after: Pt2[] } {
  let bestI = 0;
  let bestT = 0;
  let bestD = Infinity;
  let bestQ: Pt2 = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / len2));
    const q: Pt2 = [ax + dx * t, ay + dy * t];
    const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
    if (d < bestD) { bestD = d; bestI = i; bestT = t; bestQ = q; }
  }
  void bestT;
  return {
    before: [...pts.slice(0, bestI + 1), bestQ],
    after: [bestQ, ...pts.slice(bestI + 1)],
  };
}

function meanderGround(count: number): Pt2[] {
  const turns = Math.ceil(count / PER_TURN) + 1;
  const pts: Pt2[] = [];
  for (let t = -1; t < turns; t++) for (const c of G_CORNERS) pts.push(downTurns(c, t));
  return pts;
}

// -- shapes -----------------------------------------------------------------

function roundPoly(v: Pt2[], r: number): string {
  const lead = (a: Pt2, b: Pt2): Pt2 => {
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

/** The tile's square, projected at height `z`. */
function faceQuad(cam: Cam, g: Pt2, z: number): Pt2[] {
  const half = 0.5;
  return ([[-half, -half], [half, -half], [half, half], [-half, half]] as Pt2[])
    .map(([du, dv]) => project(cam, g[0] + du, g[1] + dv, z));
}

/** Corner radius in screen units, scaled with the camera. */
const cornerR = (cam: Cam) => 7 * (cam.scale / HALF_W);

/**
 * The extruded body: the top face swept straight down to the ground.
 *
 * A vertical sweep of a convex shape is the shape at the bottom plus a band
 * between its extreme points in the sweep direction. Rounding a six-sided
 * silhouette on its own instead pulls the side corners inside the top face's
 * and leaves a notch of background where the two should meet.
 */
/**
 * How far the rounded square reaches sideways on screen. The fillet pulls the
 * corners in: the widest place on the outline is the corner curve's midpoint,
 * not the un-rounded vertex. Everything that has to line up with the tile's
 * silhouette — the extrusion band, the column of light — is measured from
 * here rather than from a number typed in by eye.
 */
function extentOf(quad: Pt2[], r: number): { cx: number; ex: number } {
  const xs = quad.map((p) => p[0]);
  const edge = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const t = Math.min(r / (edge || 1), 0.48);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return { cx: (lo + hi) / 2, ex: ((hi - lo) / 2) * (1 - t / 2) };
}

/**
 * The silhouette of the tile's square swept vertically between two heights.
 *
 * A vertical sweep of a convex shape is the shape at each end plus a band
 * between its extreme points, which meet the corner curves tangentially.
 * Rounding a six-sided outline on its own instead pulls the side corners
 * inside the end faces' and leaves a notch of background where they meet.
 */
function sweptPath(cam: Cam, g: Pt2, zLow: number, zHigh: number, cap: boolean): string {
  const r = cornerR(cam);
  const hi = faceQuad(cam, g, zHigh);
  const lo = faceQuad(cam, g, zLow);
  const yHi = hi.reduce((s, p) => s + p[1], 0) / 4;
  const yLo = lo.reduce((s, p) => s + p[1], 0) / 4;
  if (yLo - yHi < 0.5) return roundPoly(lo, r);
  const { cx, ex } = extentOf(hi, r);
  const band = `M ${(cx - ex).toFixed(2)} ${(yHi - 0.4).toFixed(2)}`
    + ` L ${(cx + ex).toFixed(2)} ${(yHi - 0.4).toFixed(2)}`
    + ` L ${(cx + ex).toFixed(2)} ${(yLo + 0.4).toFixed(2)}`
    + ` L ${(cx - ex).toFixed(2)} ${(yLo + 0.4).toFixed(2)} Z`;
  return `${roundPoly(lo, r)} ${band}${cap ? ` ${roundPoly(hi, r)}` : ''}`;
}

/** The tile's solid body. The top face is drawn over it, so it needs no cap. */
const bodyPath = (cam: Cam, g: Pt2) => sweptPath(cam, g, BOT_Z, TOP_Z, false);

// -- glyphs -----------------------------------------------------------------

/*
 * Glyphs are authored flat and upright in a 100x100 box and laid on the tile's
 * face by construction. The face map composed with the 45 degrees the diamond
 * already carries reduces to a pure foreshorten, so an upright mark stays
 * upright and simply lies down on the tile. Un-projecting the tick measured
 * off the reference through that scale gives an ordinary upright tick, which
 * is the proof the original was built the same way.
 */
const GLYPH_BOX = 100;

function faceTransform(cam: Cam, g: Pt2): string {
  const [cx, cy] = project(cam, g[0], g[1], TOP_Z);
  const sx = (Math.SQRT2 * cam.scale) / GLYPH_BOX;
  const sy = (Math.SQRT2 * cam.scale * Math.cos(cam.pitch)) / GLYPH_BOX;
  return `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${(-cam.yaw * 180) / Math.PI}) `
    + `scale(${sx.toFixed(4)} ${sy.toFixed(4)})`;
}

const stroked = (d: string, ink: string, w = 9) => svg('path', {
  d, fill: 'none', stroke: ink, 'stroke-width': w,
  'stroke-linecap': 'round', 'stroke-linejoin': 'round',
});

function glyphFor(state: TileState, gem: boolean, ink: string): SVGElement {
  /*
   * A tile you have not reached yet carries the same play mark as the one you
   * are up to, only recessed. Nothing here is locked, so a padlock would be a
   * lie about a tile that opens the moment you press it.
   */
  if (state === 'ahead' || state === 'next') {
    return svg('path', {
      d: 'M -8 -15 L 17 0 L -8 15 Z',
      fill: ink, stroke: ink, 'stroke-width': 7, 'stroke-linejoin': 'round',
    });
  }
  if (gem) return stroked('M 0 -17 L 17 0 L 0 17 L -17 0 Z', ink, 8);
  return stroked('M -15 -4 L -5 8 L 14 -18', ink);
}

/**
 * Solved tiles are solid ink, the way a filled NYT pill is. The tile you are
 * up to is paper-white, the one thing on screen that is neither the chapter's
 * colour nor black. Tiles further up the path are that colour taken down a few
 * steps — recessed rather than greyed, and opaque, so the ribbon passes behind
 * them. They are recessed because you have not got there yet, not because they
 * are shut: every one of them opens.
 */
function faces(state: TileState, color: string) {
  if (state === 'done') return { top: '#242424', inner: '#3A3A3A', side: '#000000', ink: '#FFFFFF' };
  if (state === 'next') return { top: '#FFFFFF', inner: '#FFFFFF', side: '#1A1A1A', ink: '#121212' };
  return {
    top: shade(color, 0.26),
    inner: shade(color, 0.15),
    side: shade(color, 0.46),
    ink: shade(color, 0.60),
  };
}

function starPath(): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 11 : 4.6;
    pts.push(`${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

// -- the view ---------------------------------------------------------------

interface TileParts {
  g: Pt2;
  side: SVGElement;
  top: SVGElement;
  inner: SVGElement;
  glyph: SVGElement;
  text: SVGElement;
  halo?: SVGElement;
}

export function chapterPath(nodes: PathNode[], color: string): PathView {
  const count = nodes.length;
  const bottom = groundOfTile(0, count);
  const top = groundOfTile(count - 1, count);

  // The run's screen height at the resting camera, which sets the viewBox.
  const base = isoCam(0, 0);
  const yOf = (g: Pt2) => project(base, g[0], g[1], 0)[1];
  const y0 = yOf(top) - HEAD;
  const height = yOf(bottom) + TAIL - y0;
  const resting = isoCam(0, -y0);

  const root = svg('svg', {
    class: 'pathsvg',
    viewBox: `0 0 ${VIEW_W} ${height.toFixed(1)}`,
    // The whole chapter has to fit its box: nothing in this game scrolls.
    preserveAspectRatio: 'xMidYMid meet',
    width: '100%',
    role: 'list',
    'aria-label': 'Levels',
  });

  const defs = svg('defs');
  root.appendChild(defs);

  /*
   * The light around the tile you are up to is a column standing on the board,
   * not a rectangle drawn on the screen: the tile's own footprint swept upward
   * from its base. So it is exactly as wide as the tile, wraps its sides as
   * well as rising above it, and stays right when the camera moves — as the
   * view rises to straight down the column foreshortens away to nothing,
   * because that is what a column does when you look down it.
   *
   * The gradient runs across the shape's own box rather than fixed screen
   * coordinates, so it fades from the top of the column whatever its height.
   */
  const halo = svg('linearGradient', { id: 'pathhalo', x1: 0, y1: 0, x2: 0, y2: 1 });
  halo.appendChild(svg('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }));
  halo.appendChild(svg('stop', { offset: '0.62', 'stop-color': '#fff', 'stop-opacity': '0.30' }));
  halo.appendChild(svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0.40' }));
  defs.appendChild(halo);

  /*
   * The column is a shape; light is not. Without this it reads as a pale bar
   * standing on the tile: a hard top edge, hard sides, and nothing at all
   * around the tile's base.
   *
   * Blurring the column is what turns it into light. The core still measures
   * exactly the tile's filleted width — the shape is unchanged — but the edges
   * fall off in every direction, so the light spills sideways and down as well
   * as up. The tile is drawn over the top of it, so what is left showing round
   * the tile is a rim of glow on all sides, which is what a lit tile looks
   * like. One blurred element per screen: only the tile you are up to has one.
   */
  const soften = svg('filter', {
    id: 'pathglow', x: '-90%', y: '-40%', width: '280%', height: '190%',
    filterUnits: 'objectBoundingBox',
  });
  soften.appendChild(svg('feGaussianBlur', { stdDeviation: 13, edgeMode: 'none' }));
  defs.appendChild(soften);
  const fade = (id: string, up: boolean) => {
    const g = svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(svg('stop', { offset: '0', 'stop-color': up ? '#000' : '#fff' }));
    g.appendChild(svg('stop', { offset: '1', 'stop-color': up ? '#fff' : '#000' }));
    return g;
  };
  defs.appendChild(fade('pathfadetop', true));
  defs.appendChild(fade('pathfadebot', false));
  const mask = svg('mask', { id: 'pathends' });
  const maskTop = svg('rect', { x: -80, width: VIEW_W + 200, fill: 'url(#pathfadetop)' });
  const maskMid = svg('rect', { x: -80, width: VIEW_W + 200, fill: '#fff' });
  const maskBot = svg('rect', { x: -80, width: VIEW_W + 200, fill: 'url(#pathfadebot)' });
  mask.append(maskTop, maskMid, maskBot);
  defs.appendChild(mask);

  /*
   * The ribbon: a slab, not a line. Grey ahead, ink behind, cut at the level
   * you are up to. The side is a genuine sweep — the run stroked at every step
   * down to its depth — because one copy shifted to the bottom leaves a notch
   * of background at every corner, where the two round joins bulge apart.
   */
  const ground = meanderGround(count);
  /** The tile you are up to, which is where walked stops and ahead begins. */
  const currentIndex = nodes.findIndex((n) => n.state === 'next');
  /*
   * Where the run stops being walked. The meander is ordered down the screen
   * and level one is at the bottom, so everything from the tile you are up to
   * onwards is behind you.
   */
  const cutAt = currentIndex === -1
    ? groundOfTile(count - 1, count)
    : groundOfTile(currentIndex, count);
  const halves = splitPolyline(ground, cutAt);

  const SWEEP_STEP = 1.5;
  const ribbon = svg('g', { mask: 'url(#pathends)' });
  const layers: { el: SVGElement; z: number; pts: Pt2[] }[] = [];
  const addRun = (stroke: string, z: number, pts: Pt2[]) => {
    const el = svg('polyline', {
      fill: 'none', stroke, 'stroke-width': PATH_W,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    });
    layers.push({ el, z, pts });
    ribbon.appendChild(el);
    return el;
  };
  // The ribbon lies on the same ground as the tiles: its underside is level
  // with their bases, so the two share a floor instead of the path hovering.
  const sweep = (stroke: string, pts: Pt2[]) => {
    const step = (SWEEP_STEP / RIBBON_D) * G_RIBBON_D;
    for (let z = 0; z < G_RIBBON_D; z += step) addRun(stroke, BOT_Z + z, pts);
  };
  sweep(PATH_AHEAD_SIDE, halves.before);
  addRun(PATH_AHEAD, BOT_Z + G_RIBBON_D, halves.before);
  sweep(PATH_WALKED_SIDE, halves.after);
  addRun(PATH_WALKED, BOT_Z + G_RIBBON_D, halves.after);
  root.appendChild(ribbon);

  const tiles: TileParts[] = [];
  let currentY = 0;

  nodes.forEach((node, i) => {
    const g = groundOfTile(i, count);
    const f = faces(node.state, color);

    const grp = svg('g', {
      class: `ptile ${node.state}`,
      role: 'listitem',
      tabindex: 0,
      'aria-label': node.sub ? `${node.label}, ${node.sub}` : node.label,
    });

    const parts: TileParts = {
      g,
      side: svg('path', { class: 'side', fill: f.side }),
      top: svg('path', { class: 'top', fill: f.top }),
      inner: svg('path', { class: 'inner', fill: f.inner, opacity: node.state === 'next' ? 0 : 1 }),
      glyph: svg('g', { fill: 'none' }),
      text: svg('g', { class: 'ptext' }),
    };
    parts.glyph.appendChild(glyphFor(node.state, !!node.gem, f.ink));

    if (node.state === 'next') {
      parts.halo = svg('path', {
        class: 'halo', fill: 'url(#pathhalo)', filter: 'url(#pathglow)',
      });
      grp.appendChild(parts.halo);
    }
    grp.append(parts.side, parts.top, parts.inner, parts.glyph);

    const t1 = svg('text', { class: 'plabel', 'text-anchor': 'middle' });
    t1.textContent = node.label;
    parts.text.appendChild(t1);
    if (node.sub) {
      const t2 = svg('text', { class: 'psub', 'text-anchor': 'middle' });
      t2.textContent = node.sub;
      parts.text.appendChild(t2);
    } else if (node.stars) {
      const sg = svg('g', { class: 'pstars', 'aria-hidden': 'true' });
      const d = starPath();
      for (let k = 0; k < 3; k++) {
        sg.appendChild(svg('path', {
          d,
          transform: `translate(${(k - 1) * 30} 0)`,
          fill: k < node.stars ? 'currentColor' : 'none',
          stroke: 'currentColor',
          'stroke-width': k < node.stars ? 1.2 : 2.4,
          'stroke-linejoin': 'round',
          opacity: k < node.stars ? 0.9 : 0.34,
        }));
      }
      parts.text.appendChild(sg);
    }
    grp.appendChild(parts.text);

    {
      grp.addEventListener('click', node.onOpen);
      grp.addEventListener('keydown', (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') {
          e.preventDefault();
          node.onOpen();
        }
      });
    }
    root.appendChild(grp);
    tiles.push(parts);
  });

  // -- drawing ---------------------------------------------------------------

  /**
   * Redraw at this camera.
   *
   * `only` is the flight's doing. While the camera is moving, the ribbon and
   * every tile but one are held at zero opacity by CSS — and rebuilding a
   * few hundred projected points and nine tiles' worth of swept geometry for
   * things nobody can see is what made the flight run at a few frames a
   * second on a phone. Passing the tile being flown to skips all of it.
   */
  function draw(cam: Cam, only = -1): void {
    if (only < 0) for (const { el, z, pts } of layers) {
      const dz = z * lift(cam);
      let out = '';
      for (const g of pts) {
        const q = project(cam, g[0], g[1], 0);
        out += `${q[0].toFixed(1)},${(q[1] - dz).toFixed(1)} `;
      }
      el.setAttribute('points', out);
    }

    if (only < 0) {
      const yTop = project(cam, top[0], top[1], 0)[1];
      const yBot = project(cam, bottom[0], bottom[1], 0)[1];
      const span = Math.max(1, yBot - yTop);
      maskTop.setAttribute('y', String(yTop - span * 4));
      maskTop.setAttribute('height', String(span * 4 - 40));
      maskMid.setAttribute('y', String(yTop - 40));
      maskMid.setAttribute('height', String(span + 80));
      maskBot.setAttribute('y', String(yBot + 40));
      maskBot.setAttribute('height', String(span * 4));
    }

    const r = cornerR(cam);
    const inset = 0.675;
    for (let ti = 0; ti < tiles.length; ti++) {
      if (only >= 0 && ti !== only) continue;
      const t = tiles[ti];
      t.side.setAttribute('d', bodyPath(cam, t.g));
      t.top.setAttribute('d', roundPoly(faceQuad(cam, t.g, TOP_Z), r));
      const innerQuad = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt2[])
        .map(([du, dv]) => project(cam, t.g[0] + (du * inset) / 2, t.g[1] + (dv * inset) / 2, TOP_Z));
      t.inner.setAttribute('d', roundPoly(innerQuad, r * 0.86));
      t.glyph.setAttribute('transform', faceTransform(cam, t.g));

      if (only >= 0) continue;   // the label and the light are hidden in flight

      const [cx, cy] = project(cam, t.g[0], t.g[1], 0);
      t.text.setAttribute('transform', `translate(${cx.toFixed(1)} ${(cy + 92).toFixed(1)})`);
      // A <g> has no y of its own, so the stars are moved by transform and
      // only the <text> lines take a baseline.
      Array.from(t.text.children).forEach((k, idx) => {
        if (k.tagName === 'text') k.setAttribute('y', String(idx * 43));
        else k.setAttribute('transform', `translate(0 ${idx * 43 - 8})`);
      });

      // The column of light: the tile's footprint swept from its base up past
      // its top, so the glow wraps the tile rather than floating above it.
      if (t.halo) t.halo.setAttribute('d', sweptPath(cam, t.g, BOT_Z, TOP_Z + GLOW_H, true));
    }
  }

  draw(resting);
  currentY = currentIndex === -1
    ? 0
    : project(resting, groundOfTile(currentIndex, count)[0], groundOfTile(currentIndex, count)[1], 0)[1];

  const el = h('div', { class: 'pathwrap' }, root);

  const scrollToCurrent = (behavior: ScrollBehavior = 'smooth') => {
    if (!currentY) return;
    const box = root.getBoundingClientRect();
    if (box.width === 0) return;
    const scale = box.width / VIEW_W;
    const here = box.top + currentY * scale;
    const delta = here - window.innerHeight * 0.34;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller) {
      const cs = getComputedStyle(scroller);
      if (/auto|scroll/.test(cs.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollBy({ top: delta, behavior });
    else window.scrollBy({ top: delta, behavior });
  };

  /** Where tile `i`'s top face is on screen at camera `cam`. */
  const rectAt = (cam: Cam, i: number): DOMRect => {
    const box = root.getBoundingClientRect();
    const k = box.width / VIEW_W;
    const q = faceQuad(cam, groundOfTile(i, count), TOP_Z);
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    return new DOMRect(
      box.left + Math.min(...xs) * k,
      box.top + Math.min(...ys) * k,
      (Math.max(...xs) - Math.min(...xs)) * k,
      (Math.max(...ys) - Math.min(...ys)) * k,
    );
  };

  return {
    el,
    scrollToCurrent,
    currentY,
    height,
    faceRect: (i) => rectAt(resting, i),
    reset: () => draw(resting),
    flight: (i) => {
      const g = groundOfTile(i, count);
      /*
       * The tile is pinned to the screen on every frame, not just at the two
       * ends. Interpolating the camera's offset between a resting view and an
       * overhead one is not the same as interpolating where the tile appears:
       * the offsets are large and of opposite sign at the two ends, and the
       * blend between them threw the tile clean off the screen halfway
       * through. So each frame builds the camera from the angles alone and
       * then solves for the offset that puts the tile where it should be.
       */
      const box = root.getBoundingClientRect();
      const k = box.width / VIEW_W || 1;
      const from = project(resting, g[0], g[1], TOP_Z);
      const to: Pt2 = [VIEW_W / 2, (window.innerHeight / 2 - box.top) / k];
      const endScale = (VIEW_W * FACE_FRACTION) / Math.SQRT2;
      let last = resting;
      return {
        at: (t) => {
          const cam: Cam = {
            pitch: ISO_PITCH * (1 - t),
            yaw: (-Math.PI / 4) * t,
            scale: HALF_W + (endScale - HALF_W) * t,
            ox: 0,
            oy: 0,
          };
          const p = project(cam, g[0], g[1], TOP_Z);
          cam.ox = from[0] + (to[0] - from[0]) * t - p[0];
          cam.oy = from[1] + (to[1] - from[1]) * t - p[1];
          last = cam;
          draw(cam, i);
        },
        faceRect: () => rectAt(last, i),
      };
    },
  };
}

/**
 * How much of the board's width the tile's face fills once the camera is
 * directly above it. That square is what becomes the card, so it is sized to
 * land close to the play board it is about to turn into.
 */
const FACE_FRACTION = 0.86;
