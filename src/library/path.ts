/**
 * The ladder, as a path.
 *
 * Every game's archive is this screen: its puzzles as isometric tiles standing
 * on a ribbon that climbs the screen, chapter by chapter. A grid of a hundred
 * and ninety numbered chips is a spreadsheet of a game; a path is a journey,
 * and it answers the only two questions a player actually has — where am I,
 * and how much is left — before they have read a word.
 *
 * The geometry is not invented. Every constant in the "measured" block was
 * taken off the original reference and is what makes the ribbon meander the
 * way it does. Everything is authored in ground coordinates and projected
 * through the camera (see platform/ui/camera.ts), so the drawing is one
 * projection of one scene rather than a pile of diamond arithmetic.
 *
 * Three things here are constructions rather than adjustments, and they are
 * the reason the screen behaves:
 *
 *   - The ribbon never ends. It is drawn well past both ends of the ladder and
 *     the SCROLL stops early, so at the limit the clip line sits exactly on
 *     the edge of the screen. The path is cut by the edge of the phone rather
 *     than by anything of ours, which is the only way a path can appear to
 *     carry on past the last tile without leaving somewhere empty to scroll to.
 *   - A chapter's band is a row of the ladder like any other. It takes a slot
 *     on the meander, so the space it needs exists in the layout rather than
 *     being made by pushing tiles about.
 *   - The rail's marks sit at each band's fraction of the drawing's height,
 *     which is a ratio of view units and therefore the same number at every
 *     screen width. Nothing about the rail needs measuring after layout.
 */

import { h, svg } from '../platform/dom.js';
import { iconButton } from '../platform/ui/components.js';
import * as store from '../platform/store.js';
import * as haptics from '../platform/haptics.js';
import {
  type Pt2, project, groundOf, isoCam, flatCam, ISO_PITCH, TILE_H, HALF_W, HALF_H,
} from '../platform/ui/camera.js';
import type { AnyGame } from '../platform/registry.js';
import type { Puzzle } from '../platform/types.js';

// -- measured geometry ------------------------------------------------------

/** The drawing's width in its own units. Everything else is a ratio of it. */
const VIEW_W = 771;
/** One turn of the meander, in those units. */
const PERIOD = 1035;
const CORNERS: [number, number][] = [
  [191, 5], [-42, 156], [283, 350], [530, 198],
  [835, 394], [289, 721], [639, 927], [330, 1117],
];
/** Where the four rows of a turn sit. */
const ROW_SLOTS: [number, number][] = [[191, 0], [390, 274], [608, 517], [390, 766]];
const PER_TURN = ROW_SLOTS.length;
/** How far the column of light rises above the tile you are up to. */
const GLOW_PX = 78;

/*
 * The run past each end of the ladder, and how much of it you can reach.
 *
 * The ribbon does not stop and does not fade: it is drawn RUN units past the
 * top and bottom rows and simply carries on. What stops is the SCROLL. Only
 * SHOW of that run is inside the scrollable box; the last CLIP units at each
 * end are outside it and clipped away.
 *
 * That is what makes the end of the path invisible. At the limit of the scroll
 * the clip line sits exactly on the edge of the screen, so the ribbon is cut
 * by the edge of the phone rather than by anything of ours — it reads as
 * running on past the screen, because as far as anyone can see, it does.
 */
const RUN = 460;
const SHOW = 220;
const CLIP = RUN - SHOW;

/*
 * The tap target round a tile, in view units.
 *
 * 320 pixels is the narrowest phone still in use and 44 the smallest target a
 * thumb can be asked for, so a target has to be at least 44 / (276 / 771) =
 * 123 units tall once the rail's column is taken off. Rounded up to 130, and
 * kept under the 259 units between one slot and the next so two targets can
 * never overlap.
 */
const HIT_W = 200;
const HIT_H = 130;

/*
 * The road, and the tiles standing on it.
 *
 * Two goes at this were wrong in the same way and it is worth saying how,
 * because the fix is a rule and not a number.
 *
 * The road and the tiles are one slab, floor to surface, and a tile is the
 * place where that slab is wide. That much was already true. What was wrong
 * was the PAINTING ORDER, and it is the whole of why the two looked like
 * separate objects.
 *
 * A tile's skirt — the dark side face that hangs off it — was painted after
 * the road, straight across the place the road ran into the tile. The one
 * thing you had to see to believe they were joined was the one thing covered
 * up, and matching their heights could never fix it, because the skirt was in
 * front of the road either way.
 *
 * So a tile is drawn in two passes and the road goes between them: skirts,
 * then the road, then the faces. Under the road a tile is only ever the same
 * solid seen from the side, so the road covering it is right; over the road
 * the tile's own face is what you should see, so it covers instead. Nothing
 * is clipped and nothing is nudged — the order IS the occlusion.
 */
const BOT_Z = -TILE_H / 2;
/** The tile's top face. */
const TOP_Z = BOT_Z + TILE_H;
/*
 * The road's surface, and it is deliberately lower than the tile's.
 *
 * Level with it, the two are one flat sheet and a tile is only a wider part of
 * the road. A little below, the tile stands proud: the road arrives, stops
 * against the tile's edge with its vertical end face, and the tile's own side
 * shows above it as a step. That step is the thing that says "this is a marker
 * ON the path" rather than "this is a patch OF the path".
 *
 * Written as a fraction of the tile's height rather than as a number of units,
 * so a tile and its ledge keep their proportions if the drawing is ever built
 * at another size.
 */
const ROAD_RISE = 0.78;
const ROAD_TOP = BOT_Z + TILE_H * ROAD_RISE;

/*
 * How wide the road is, in ground units, where a tile is one unit square.
 *
 * Thin, and it stays thin. A wide road swallows the meander — the passes are
 * only 259 units apart and a ground unit is 144 across, so much past a
 * ground unit the road's own turns start to touch and it reads as a folded
 * sheet rather than a path. This is the width the drawing was measured at.
 *
 * A thin road only works because the order above is right. Painted over, a
 * thin road is the one that suffers most: the tile's skirt is wider than the
 * whole road, so it hid the join completely.
 */
const ROAD_W = 0.19;

/** Ground-space versions of the above. Converted once, here. */
const G_PERIOD = PERIOD / HALF_H;
const G_CORNERS = CORNERS.map(([x, y]) => groundOf(x, y));
/** A length in the reference's screen pixels, as a height above the ground. */
const zOfPx = (px: number) => px / (HALF_W * Math.sin(ISO_PITCH));
const GLOW_H = zOfPx(GLOW_PX);

/** Advance a ground point by `n` turns down the meander. */
function downTurns(p: Pt2, n: number): Pt2 {
  return [p[0] + (n * G_PERIOD) / 2, p[1] + (n * G_PERIOD) / 2];
}

const TURN_PTS: Pt2[] = [...G_CORNERS, downTurns(G_CORNERS[0], 1)];

function projectOn(pts: Pt2[], p: Pt2): Pt2 {
  let best = pts[0];
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const q: Pt2 = [ax + dx * t, ay + dy * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/**
 * A polyline pushed sideways by `d`, in GROUND space.
 *
 * This is what makes the road a road rather than a wire. A stroked line is
 * given its width on the SCREEN, perpendicular to how the line happens to be
 * drawn — which for anything lying on the ground under this camera is not a
 * constant width at all: the same road would come out fat where it runs across
 * the view and thin where it runs into it. Offsetting the centreline on the
 * ground and projecting the result gives a road of one real width, seen
 * correctly foreshortened wherever it goes.
 *
 * Corners are mitred: each offset vertex is where the two offset segments
 * would meet. The mitre is clamped because a hairpin sends it to infinity, and
 * this meander has none anywhere near that tight.
 */
function offsetPolyline(pts: Pt2[], d: number): Pt2[] {
  const n = pts.length;
  const normals: Pt2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }
  const out: Pt2[] = [];
  for (let i = 0; i < n; i++) {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(normals.length - 1, i)];
    const mx = a[0] + b[0];
    const my = a[1] + b[1];
    const len2 = mx * mx + my * my;
    if (len2 < 1e-9) { out.push([pts[i][0] + a[0] * d, pts[i][1] + a[1] * d]); continue; }
    // The mitre length is 1 / cos(half the turn), which is 2 / |a + b| here.
    const scale = Math.min(2 / len2, 3);
    out.push([pts[i][0] + mx * d * scale, pts[i][1] + my * d * scale]);
  }
  return out;
}

/** The road's outline: up one side of the centreline and back down the other. */
function roadOutline(centre: Pt2[]): Pt2[] {
  const left = offsetPolyline(centre, ROAD_W / 2);
  const right = offsetPolyline(centre, -ROAD_W / 2);
  return [...left, ...right.reverse()];
}

/*
 * Tiles stand ON the ribbon rather than near it. The measured slots came off a
 * drawing and sit a few units off the line, so each is projected onto the
 * meander to find where the ribbon's surface actually passes.
 */
const SLOT_ANCHORS: Pt2[] = ROW_SLOTS.map((s) => projectOn(TURN_PTS, groundOf(s[0], s[1])));

function slotAt(k: number): Pt2 {
  return downTurns(SLOT_ANCHORS[k % PER_TURN], Math.floor(k / PER_TURN));
}

function meanderGround(rows: number): Pt2[] {
  const turns = Math.ceil(rows / PER_TURN) + 1;
  const pts: Pt2[] = [];
  for (let t = -1; t < turns; t++) for (const c of G_CORNERS) pts.push(downTurns(c, t));
  return pts;
}

/**
 * Cut a polyline at the point on it nearest `at`, and hand back the two halves
 * with the cut point in both, so they meet exactly.
 *
 * This is what tells walked from ahead. The obvious alternative — clip the
 * ribbon at the current tile's HEIGHT — is wrong, and visibly so: the meander
 * doubles back on itself as it climbs, so a horizontal line through the tile
 * you are up to also crosses stretches you walked ten levels ago and stretches
 * you have not reached. Position along the run is the only thing that knows.
 */
function splitPolyline(pts: Pt2[], at: Pt2): { before: Pt2[]; after: Pt2[] } {
  let bestI = 0;
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
    if (d < bestD) { bestD = d; bestI = i; bestQ = q; }
  }
  return {
    before: [...pts.slice(0, bestI + 1), bestQ],
    after: [bestQ, ...pts.slice(bestI + 1)],
  };
}

// -- shapes -----------------------------------------------------------------

function roundPoly(v: Pt2[], r: number): string {
  const lead = (a: Pt2, b: Pt2): Pt2 => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
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

const CORNER_R = 7;

/** The camera the whole screen is drawn through. Nothing here moves it. */
/*
 * Seen from where. `flatCam()` renders exactly this scene with no height in it
 * — see camera.ts — so switching the one word below is the whole of the 2D
 * version: the same meander, the same tiles, the same places, from above. It
 * is a construction rather than a second drawing, which is the only way two
 * versions of a picture stay the same picture.
 */
const AS_2D = false;
const FLAT = AS_2D ? flatCam(0, 0) : isoCam(0, 0);

/** The tile's square, projected at height `z`. */
function faceQuad(g: Pt2, z: number, half = 0.5): Pt2[] {
  return ([[-half, -half], [half, -half], [half, half], [-half, half]] as Pt2[])
    .map(([du, dv]) => project(FLAT, g[0] + du, g[1] + dv, z));
}

/**
 * How far a rounded square reaches sideways. The fillet pulls the corners in,
 * so the widest place on the outline is the corner curve's midpoint and not
 * the un-rounded vertex. Anything that has to line up with the tile's
 * silhouette is measured from here rather than typed in by eye.
 */
function extentOf(quad: Pt2[], r: number): { cx: number; ex: number } {
  const xs = quad.map((p) => p[0]);
  const edge = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const t = Math.min(r / (edge || 1), 0.48);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
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
function sweptPath(g: Pt2, zLow: number, zHigh: number, cap: boolean): string {
  const hi = faceQuad(g, zHigh);
  const lo = faceQuad(g, zLow);
  const yHi = hi.reduce((s, p) => s + p[1], 0) / 4;
  const yLo = lo.reduce((s, p) => s + p[1], 0) / 4;
  if (yLo - yHi < 0.5) return roundPoly(lo, CORNER_R);
  const { cx, ex } = extentOf(hi, CORNER_R);
  const band = `M ${(cx - ex).toFixed(2)} ${(yHi - 0.4).toFixed(2)}`
    + ` L ${(cx + ex).toFixed(2)} ${(yHi - 0.4).toFixed(2)}`
    + ` L ${(cx + ex).toFixed(2)} ${(yLo + 0.4).toFixed(2)}`
    + ` L ${(cx - ex).toFixed(2)} ${(yLo + 0.4).toFixed(2)} Z`;
  return `${roundPoly(lo, CORNER_R)} ${band}${cap ? ` ${roundPoly(hi, CORNER_R)}` : ''}`;
}

/*
 * The numeral is authored flat and upright and laid on the tile's face by
 * construction: the face map composed with the 45 degrees the diamond already
 * carries reduces to a pure foreshorten, so an upright mark stays upright and
 * simply lies down on the tile.
 */
function faceTransform(g: Pt2): string {
  const [cx, cy] = project(FLAT, g[0], g[1], TOP_Z);
  const sy = Math.cos(ISO_PITCH);
  return `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(1 ${sy.toFixed(4)})`;
}

// -- the screen -------------------------------------------------------------

/**
 * A row of the ladder is a CHAPTER now, not a puzzle.
 *
 * Five hundred tiles on a meander is not a journey, it is a scroll bar with
 * pictures on it — nobody can find level 314 on it and nobody wants to. So the
 * path carries the seventeen chapters, which is a length you can actually walk
 * with a thumb, and each one opens a grid of its thirty levels. The band rules
 * that used to caption the path are gone with the same argument: a chapter
 * that is a tile does not also need a heading announcing it.
 */
type Row = {
  chapter: number;
  name: string;
  puzzles: readonly Puzzle<unknown>[];
  done: number;
  state: 'done' | 'now' | 'ahead';
};

export type PathHooks = { onBack(): void; openChapter(at: number): void };

export function pathScreen(game: AnyGame, hooks: PathHooks): { el: HTMLElement; dispose(): void } {
  const gid = game.meta.id;
  const chapters = game.chapters();
  const all = game.puzzles();
  const stats = store.statsOf(gid);

  /*
   * Where you are up to: the first puzzle you have not finished. One tile on
   * the whole ladder is lit, and it is always the one that press would open if
   * the player pressed nothing else.
   */
  const nowId = all.find((p) => !store.isDone(gid, p.id))?.id ?? null;

  /*
   * The ladder, bottom first. A chapter's band comes before its puzzles, so it
   * sits under the first tile of the chapter it names and above the last tile
   * of the one below — which is where a chapter heading belongs when the path
   * is climbed rather than read down.
   */
  const rows: Row[] = chapters.map((ch, c) => {
    const done = ch.puzzles.filter((p) => store.isDone(gid, p.id)).length;
    const holdsNow = nowId !== null && ch.puzzles.some((p) => p.id === nowId);
    return {
      chapter: c,
      name: ch.name,
      puzzles: ch.puzzles,
      done,
      state: done === ch.puzzles.length ? 'done' : holdsNow ? 'now' : 'ahead',
    };
  });
  const R = rows.length;

  /** Row `j` counted from the bottom, on the meander. */
  const groundOfRow = (j: number): Pt2 => slotAt(R - 1 - j);

  const yOf = (g: Pt2) => project(FLAT, g[0], g[1], 0)[1];
  const yTop = yOf(groundOfRow(R - 1));
  const yBot = yOf(groundOfRow(0));
  const y0 = yTop - RUN;
  /** The whole drawing, including the run past both ends. */
  const H = yBot + RUN - y0;
  /** The part of it you can scroll to: the drawing less the clip at each end. */
  const BED = H - 2 * CLIP;
  /** A row's y within the bed — which is the space the scroll measures in. */
  const rowY = (j: number) => yOf(groundOfRow(j)) - y0 - CLIP;

  const root = svg('svg', {
    class: 'pathsvg',
    viewBox: `0 0 ${VIEW_W} ${H.toFixed(1)}`,
    preserveAspectRatio: 'xMidYMin meet',
    width: '100%',
    role: 'list',
    'aria-label': `${game.meta.name} puzzles`,
  });
  /* Everything is authored around the resting camera and then shifted once,
     so the drawing's own top-left is the viewBox's. */
  const scene = svg('g', { transform: `translate(0 ${(-y0).toFixed(1)})` });

  const defs = svg('defs');
  root.appendChild(defs);

  /*
   * The light around the tile you are up to is a column standing on the board,
   * not a rectangle drawn on the screen: the tile's own footprint swept
   * upward. So it is exactly as wide as the tile and wraps its sides as well
   * as rising above it. Blurring the column is what turns a shape into light —
   * the core still measures the tile's filleted width, but the edges fall off
   * in every direction, so it spills round the base as well as over the top.
   */
  const halo = svg('linearGradient', { id: 'pathhalo', x1: 0, y1: 0, x2: 0, y2: 1 });
  halo.appendChild(svg('stop', { class: 'halo-far', offset: '0' }));
  halo.appendChild(svg('stop', { class: 'halo-near', offset: '1' }));
  defs.appendChild(halo);

  const soften = svg('filter', {
    id: 'pathglow', x: '-90%', y: '-40%', width: '280%', height: '190%',
    filterUnits: 'objectBoundingBox',
  });
  soften.appendChild(svg('feGaussianBlur', { stdDeviation: 9, edgeMode: 'none' }));
  defs.appendChild(soften);

  root.appendChild(scene);

  /*
   * Three layers, and the road is the middle one.
   *
   * A tile's skirt goes under the road and its face goes over it. Both halves
   * carry the tile's state classes and are inserted in the same frame, so the
   * one animation they share — the breathing of the tile you are up to — runs
   * off the same document timeline on both and they cannot drift apart.
   */
  const skirts = svg('g', { class: 'ptiles-under', 'aria-hidden': 'true' });
  const faces = svg('g', { class: 'ptiles-over' });

  // --- the ribbon ----------------------------------------------------------
  /*
   * A slab, not a line: walked behind you, pale ahead. The side is a genuine
   * sweep — the run stroked at every step down to its depth — because one copy
   * shifted down leaves a notch of background at every corner, where the two
   * round joins bulge apart.
   */
  const ground = meanderGround(R);
  const nowRow = rows.findIndex((r) => r.state === 'now');
  const cutAt = groundOfRow(nowRow === -1 ? R - 1 : nowRow);
  const halves = splitPolyline(ground, cutAt);

  /*
   * The road stops AT a tile rather than running under it.
   *
   * Drawn straight through, the road's slab and the tile's are two solids
   * sharing the same space, and where they overlap the picture is whatever was
   * painted last — a road that fades into a tile's edge with no end to it.
   * Cutting it at the tile's own boundary gives the slab a square end, and a
   * square end on an extruded slab is a vertical face: the road arrives, stops
   * against the tile with a visible edge, and starts again on the other side.
   *
   * How far to cut is the tile's square, not a number. A unit square centred on
   * the tile is crossed by a line through its middle at 0.5 / max(|ux|, |uy|)
   * along that line, so the cut lands exactly on the edge the tile draws,
   * whatever angle the meander happens to be running at.
   */
  /** Half a tile, in ground units. The tile's face is drawn from the same 0.5. */
  const TILE_HALF = 0.5;

  /**
   * Where a segment enters and leaves a tile's square, exactly.
   *
   * Slab clipping: the square is the intersection of two bands, one per axis,
   * and a segment's overlap with it is the overlap of its two intervals. There
   * is no step size and no tolerance, so the road ends ON the tile's edge
   * rather than within something of it — the first version sampled the line
   * every 0.08 of a unit and dropped whatever landed inside, which stopped the
   * road up to 0.08 short and looked exactly like what it was.
   */
  function crossing(a: Pt2, b: Pt2, c: Pt2): [number, number] | null {
    let lo = 0;
    let hi = 1;
    for (const axis of [0, 1] as const) {
      const run = b[axis] - a[axis];
      const near = c[axis] - TILE_HALF - a[axis];
      const far = c[axis] + TILE_HALF - a[axis];
      if (Math.abs(run) < 1e-12) {
        // Parallel to this band: either wholly inside it or wholly outside.
        if (near > 0 || far < 0) return null;
        continue;
      }
      const t0 = Math.min(near / run, far / run);
      const t1 = Math.max(near / run, far / run);
      lo = Math.max(lo, t0);
      hi = Math.min(hi, t1);
      if (lo > hi) return null;
    }
    return [lo, hi];
  }

  /** The road, less the parts inside a tile. */
  function cutAtTiles(pts: Pt2[], centres: Pt2[]): Pt2[][] {
    const out: Pt2[][] = [];
    let run: Pt2[] = [];
    const at = (a: Pt2, b: Pt2, t: number): Pt2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const push = (p: Pt2) => {
      const last = run[run.length - 1];
      if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-9) run.push(p);
    };
    const finish = () => { if (run.length > 1) out.push(run); run = []; };

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const spans: [number, number][] = [];
      for (const c of centres) {
        const span = crossing(a, b, c);
        if (span && span[1] > 0 && span[0] < 1) {
          spans.push([Math.max(0, span[0]), Math.min(1, span[1])]);
        }
      }
      spans.sort((x, y) => x[0] - y[0]);
      /* Two tiles can overlap one segment, so the blocked parts are merged
         before the free parts are read off between them. */
      const blocked: [number, number][] = [];
      for (const span of spans) {
        const last = blocked[blocked.length - 1];
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else blocked.push(span);
      }

      let t = 0;
      for (const [s0, s1] of blocked) {
        if (s0 > t) { push(at(a, b, t)); push(at(a, b, s0)); }
        finish();
        t = Math.max(t, s1);
      }
      if (t < 1) { push(at(a, b, t)); push(b); }
    }
    finish();
    return out;
  }

  const ribbon = svg('g', { class: 'ribbon' });
  /** A ground polygon, projected at height `z`, as a path. */
  const slabAt = (poly: Pt2[], z: number): string => {
    let d = '';
    for (let i = 0; i < poly.length; i++) {
      const q = project(FLAT, poly[i][0], poly[i][1], z);
      d += `${i === 0 ? 'M' : 'L'} ${q[0].toFixed(1)} ${q[1].toFixed(1)} `;
    }
    return `${d}Z`;
  };
  /*
   * The road's body, as the silhouette of a solid rather than an outline of
   * one: the same polygon filled at every height from the floor to the
   * surface. The union of those is exactly what an extruded slab looks like,
   * corners and all, and it needs no case analysis about which side of the
   * road happens to be facing the camera on this stretch of the meander.
   */
  const ROAD_STEP = zOfPx(1);
  const laySlab = (cls: string, centre: Pt2[]) => {
    const poly = roadOutline(centre);
    for (let z = BOT_Z; z < ROAD_TOP; z += ROAD_STEP) {
      ribbon.appendChild(svg('path', { class: `${cls} side`, d: slabAt(poly, z) }));
    }
    ribbon.appendChild(svg('path', { class: cls, d: slabAt(poly, ROAD_TOP) }));
  };
  scene.appendChild(skirts);
  const centres: Pt2[] = [];
  for (let j = 0; j < R; j++) centres.push(groundOfRow(j));
  for (const piece of cutAtTiles(halves.before, centres)) laySlab('ahead', piece);
  for (const piece of cutAtTiles(halves.after, centres)) laySlab('walked', piece);
  scene.appendChild(ribbon);
  scene.appendChild(faces);

  /*
   * Where each chapter sits, in the bed's own units.
   *
   * The rail's marks and the scroll are fractions of the bed, so the number is
   * remembered here in that space while the drawing happens in the scene's.
   * There is nothing to draw any more — the chapter IS the tile — so what used
   * to be a ruled band across the path is now one line of arithmetic.
   */
  const bandY: number[] = [];
  for (let j = 0; j < R; j++) bandY[rows[j].chapter] = yOf(groundOfRow(j)) - y0 - CLIP;

  // --- the tiles -----------------------------------------------------------
  const STATE_WORD = { done: 'solved', now: 'where you are up to', ahead: 'not started' };
  for (let j = 0; j < R; j++) {
    const row = rows[j];
    const g = groundOfRow(j);
    const part = row.done > 0 && row.state !== 'done';
    const state = `${row.state}${part ? ' going' : ''}`;
    /* The half that goes under the road: the skirt, and the light around it. */
    const under = svg('g', { class: `ptile ${state}` });
    const grp = svg('g', {
      class: `ptile ${state}`,
      role: 'listitem',
      tabindex: 0,
      'data-chapter': String(row.chapter),
      'aria-label': `Chapter ${row.chapter + 1}, ${row.name}, `
        + `${row.done} of ${row.puzzles.length} solved, ${STATE_WORD[row.state]}`,
    });

    /*
     * The tile's tap target, which is bigger than the tile.
     *
     * A tile is 144 by 88 in the drawing's units, and on the narrowest phone
     * still in use that comes out at about thirty pixels tall — under half of
     * what a thumb needs. So each tile carries an invisible rectangle sized so
     * that it clears forty-four pixels at the smallest width the drawing is
     * ever shown at, and small enough that neighbouring slots (259 apart down
     * the meander) cannot overlap. The target is part of the geometry rather
     * than something padded on afterwards.
     */
    const [hx, hy] = project(FLAT, g[0], g[1], 0);
    grp.appendChild(svg('rect', {
      class: 'hit',
      x: hx - HIT_W / 2, y: hy - HIT_H / 2, width: HIT_W, height: HIT_H,
    }));

    if (row.state === 'now') {
      under.appendChild(svg('path', {
        class: 'halo',
        fill: 'url(#pathhalo)',
        filter: 'url(#pathglow)',
        d: sweptPath(g, BOT_Z, TOP_Z + GLOW_H, true),
      }));
    }
    under.appendChild(svg('path', { class: 'side', d: sweptPath(g, BOT_Z, TOP_Z, false) }));
    grp.append(
      svg('path', { class: 'top', d: roundPoly(faceQuad(g, TOP_Z), CORNER_R) }),
      svg('path', { class: 'inner', d: roundPoly(faceQuad(g, TOP_Z, 0.5 * 0.675), CORNER_R * 0.86) }),
    );
    const num = svg('text', {
      class: 'pnum', 'text-anchor': 'middle', 'dominant-baseline': 'central',
      transform: faceTransform(g), text: String(row.chapter + 1),
    });
    grp.appendChild(num);

    /*
     * The chapter's name and how far through it you are, beside the tile.
     *
     * Beside, not on: the tile's face is a diamond seen at an angle and type
     * laid on it has to lie down with it, which is fine for one numeral and
     * unreadable for two words. So the caption is upright, in the drawing's
     * own units, on whichever side of the tile has the room.
     */
    const leftish = hx < VIEW_W / 2;
    const cap = svg('g', {
      class: `pcap ${row.state}`,
      'aria-hidden': 'true',
      transform: `translate(${(hx + (leftish ? 96 : -96)).toFixed(1)} ${hy.toFixed(1)})`,
    });
    cap.append(
      svg('text', {
        class: 'cname', x: 0, y: -6, 'text-anchor': leftish ? 'start' : 'end', text: row.name,
      }),
      svg('text', {
        class: 'ccount num', x: 0, y: 34, 'text-anchor': leftish ? 'start' : 'end',
        text: `${row.done} / ${row.puzzles.length}`,
      }),
    );
    grp.appendChild(cap);

    const open = () => hooks.openChapter(row.chapter);
    grp.addEventListener('click', open);
    grp.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
    });
    /* The press has to move both halves, and only the half with the hit target
       under it can know about the press — so it is a class rather than
       `:active`, set on the pair. */
    const press = (on: boolean) => {
      grp.classList.toggle('pressed', on);
      under.classList.toggle('pressed', on);
    };
    grp.addEventListener('pointerdown', () => press(true));
    for (const e of ['pointerup', 'pointercancel', 'pointerleave']) {
      grp.addEventListener(e, () => press(false));
    }
    skirts.appendChild(under);
    faces.appendChild(grp);
  }

  // --- the frame around it -------------------------------------------------
  /*
   * The bed is the scrollable box, and it is shorter than the drawing.
   *
   * Both numbers below are ratios of the drawing's own width, so the browser
   * works them out from whatever width the screen turns out to be and nothing
   * here has to measure anything or run again on a resize. The bed's height
   * comes from an aspect ratio; the drawing is pulled up by a negative margin,
   * and percentage margins resolve against the containing block's WIDTH, which
   * is the one place in CSS where that is what you want.
   */
  const bed = h('div', { class: 'pathbed' }, root);
  bed.style.aspectRatio = `${VIEW_W} / ${BED.toFixed(1)}`;
  root.style.marginTop = `${((-CLIP / VIEW_W) * 100).toFixed(4)}%`;
  const scroller = h('div', { class: 'pathscroll' }, bed);

  const meter = h('i');
  const bar = h('div', { class: 'pathmeter', 'aria-hidden': 'true' }, meter);
  meter.style.width = `${all.length ? (stats.solved / all.length) * 100 : 0}%`;

  // --- the chapter rail ----------------------------------------------------
  /*
   * A scrubber, not nineteen buttons. Nineteen buttons on a phone are either
   * below the forty-four pixel minimum or taller than the screen; one control
   * that reads a position and snaps to the nearest chapter is both reachable
   * and quicker. The hit area is the full forty-four pixel column; the line
   * you can see is three.
   */
  const track = h('div', { class: 'track' });
  const thumb = h('i', { class: 'thumb' });
  const marks: HTMLElement[] = chapters.map((_, c) => {
    const m = h('i', { class: 'mark' });
    m.style.top = `${((bandY[c] ?? 0) / BED) * 100}%`;
    track.appendChild(m);
    return m;
  });
  track.appendChild(thumb);
  const flagNum = h('b');
  const flagName = h('span');
  const flag = h('div', { class: 'flag', 'aria-hidden': 'true' }, flagNum, flagName);
  const rail = h('div', {
    class: 'chaprail',
    role: 'slider',
    tabindex: 0,
    'aria-label': 'Jump to chapter',
    'aria-valuemin': 1,
    'aria-valuemax': chapters.length,
    'aria-valuenow': 1,
  }, track, flag);

  let active = -1;
  const setActive = (c: number) => {
    if (c === active) return;
    if (marks[active]) marks[active].classList.remove('on');
    active = c;
    marks[c]?.classList.add('on');
    rail.setAttribute('aria-valuenow', String(c + 1));
    rail.setAttribute('aria-valuetext', `Chapter ${c + 1}, ${chapters[c]?.name ?? ''}`);
    flagNum.textContent = String(c + 1);
    flagName.textContent = chapters[c]?.name ?? '';
    flag.style.top = `${((bandY[c] ?? 0) / BED) * 100}%`;
  };

  /*
   * Two lines, and they are different on purpose.
   *
   * FOOT is where a chapter's band is put when you jump to it — low, so the
   * chapter's own tiles fill the screen above it. EYE is where the screen is
   * READ from, and it has to be higher than that: at either end of the scroll
   * the view is clamped and the band cannot sit at FOOT any more, so a reading
   * line down at FOOT ends up below the band and names the chapter you have
   * just left.
   */
  const FOOT = 0.78;
  const EYE = 0.5;

  /** Where the scroller has to be for chapter `c` to be at the foot of the view. */
  const targetOf = (c: number): number => {
    const k = root.clientWidth / VIEW_W || 1;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return Math.max(0, Math.min(max, (bandY[c] ?? 0) * k - scroller.clientHeight * FOOT));
  };

  const goTo = (c: number, behavior: ScrollBehavior) => {
    setActive(c);
    scroller.scrollTo({ top: targetOf(c), behavior });
  };

  /**
   * Which chapter the view is showing.
   *
   * The path climbs, so the drawing runs the other way from the list: chapter
   * one's band has the LARGEST y and the last chapter's the smallest. You are
   * in the highest-numbered chapter whose band is still below the line you are
   * reading from — which is the last index satisfying it, because the bands
   * descend.
   */
  const chapterInView = (): number => {
    const k = root.clientWidth / VIEW_W || 1;
    const line = scroller.scrollTop + scroller.clientHeight * EYE;
    let c = 0;
    for (let i = 0; i < chapters.length; i++) if ((bandY[i] ?? 0) * k >= line) c = i;
    return c;
  };

  let pending = 0;
  const onScroll = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const h0 = scroller.scrollHeight || 1;
      const seen = (scroller.scrollTop + scroller.clientHeight / 2) / h0;
      thumb.style.top = `${Math.max(0, Math.min(1, seen)) * 100}%`;
      thumb.style.height = `${Math.max(6, (scroller.clientHeight / h0) * 100)}%`;
      if (!scrubbing) setActive(chapterInView());
    });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  let scrubbing = false;
  const nearest = (clientY: number): number => {
    const box = track.getBoundingClientRect();
    const f = box.height ? (clientY - box.top) / box.height : 0;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < chapters.length; c++) {
      const d = Math.abs((bandY[c] ?? 0) / BED - f);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  rail.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    rail.classList.add('scrubbing');
    rail.setPointerCapture((e as PointerEvent).pointerId);
    goTo(nearest((e as PointerEvent).clientY), 'auto');
    haptics.notch();
    e.preventDefault();
  });
  rail.addEventListener('pointermove', (e) => {
    if (!scrubbing) return;
    const c = nearest((e as PointerEvent).clientY);
    if (c !== active) { goTo(c, 'auto'); haptics.notch(); }
  });
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    rail.classList.remove('scrubbing');
  };
  rail.addEventListener('pointerup', endScrub);
  rail.addEventListener('pointercancel', endScrub);
  rail.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    /* Up the rail is up the path, which is a later chapter. */
    const step = k === 'ArrowUp' || k === 'ArrowRight' ? 1 : k === 'ArrowDown' || k === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    goTo(Math.max(0, Math.min(chapters.length - 1, active + step)), 'smooth');
  });

  const el = h('div', { class: 'screen fixed pathscreen' },
    h('div', { class: 'gamebar chrome' },
      iconButton('back', 'Back to the library', () => hooks.onBack()),
      h('div', { class: 'middle' },
        h('div', { class: 'title', text: game.meta.name }),
        h('div', { class: 'sub' },
          h('span', { class: 'num', text: `${stats.solved} of ${all.length} solved` }),
        ),
      ),
      h('div', { class: 'right' }),
    ),
    bar,
    scroller,
    rail,
  );
  el.style.setProperty('--accent', `var(--${game.meta.accent})`);

  /*
   * Open where the player is, not at the top of a ladder they finished weeks
   * ago. One frame late, because the screen is measured and it cannot be
   * measured before it is in the document.
   */
  let first = requestAnimationFrame(() => {
    first = 0;
    const c = nowRow >= 0 ? rows[nowRow].chapter : chapters.length - 1;
    const k = root.clientWidth / VIEW_W || 1;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const to = nowRow >= 0
      ? rowY(nowRow) * k - scroller.clientHeight * 0.56
      : targetOf(c);
    scroller.scrollTop = Math.max(0, Math.min(max, to));
    setActive(c);
    onScroll();
  });

  return {
    el,
    dispose() {
      if (first) cancelAnimationFrame(first);
      if (pending) cancelAnimationFrame(pending);
      scroller.removeEventListener('scroll', onScroll);
    },
  };
}
