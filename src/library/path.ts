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
 *   - The ribbon runs past both ends of the ladder and fades out. The fade is
 *     anchored to the viewBox, not to the tiles, and HEAD and TAIL are defined
 *     as GAP + FADE — so the ribbon reaches zero exactly where the drawing
 *     ends. There is no blank space below the first tile to scroll into,
 *     because there is no drawing below where the ribbon has already gone.
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
  type Pt2, project, lift, groundOf, isoCam, ISO_PITCH, TILE_H, HALF_W, HALF_H,
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
/** The ribbon is a slab: this is how thick, in view units at the iso camera. */
const RIBBON_D = 9;
/** How far the column of light rises above the tile you are up to. */
const GLOW_PX = 78;

/*
 * The run past each end of the ladder, and how much of it is the fade.
 *
 * These two are why the path can continue past the first tile without leaving
 * anywhere empty to scroll to: the fade is the last FADE units of the drawing
 * at each end, so the ribbon is already gone by the time the drawing is.
 */
const FADE = 200;
const GAP = 62;
const HEAD = GAP + FADE;
const TAIL = GAP + FADE;

/** A chapter's band, in view units. Tall enough for two lines of type. */
const BAND_H = 132;

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
 * A tile straddles the ribbon: its top face is half its height above the
 * surface and its base half below, so the ribbon runs into the middle of the
 * side face rather than meeting its top or bottom edge.
 */
const TOP_Z = TILE_H / 2;
const BOT_Z = -TILE_H / 2;

/** Ground-space versions of the above. Converted once, here. */
const G_PERIOD = PERIOD / HALF_H;
const G_CORNERS = CORNERS.map(([x, y]) => groundOf(x, y));
const G_RIBBON_D = RIBBON_D / (HALF_W * Math.sin(ISO_PITCH));
const GLOW_H = GLOW_PX / (HALF_W * Math.sin(ISO_PITCH));

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
const FLAT = isoCam(0, 0);

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

type Row =
  | { kind: 'band'; chapter: number; name: string }
  | { kind: 'tile'; puzzle: Puzzle<unknown>; n: number; chapter: number; state: 'done' | 'now' | 'ahead'; going: boolean };

export type PathHooks = { onBack(): void; open(puzzleId: string): void };

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
  const numberOf = new Map(all.map((p, i) => [p.id, i + 1]));

  /*
   * The ladder, bottom first. A chapter's band comes before its puzzles, so it
   * sits under the first tile of the chapter it names and above the last tile
   * of the one below — which is where a chapter heading belongs when the path
   * is climbed rather than read down.
   */
  const rows: Row[] = [];
  chapters.forEach((ch, c) => {
    rows.push({ kind: 'band', chapter: c, name: ch.name });
    for (const p of ch.puzzles) {
      const done = store.isDone(gid, p.id);
      rows.push({
        kind: 'tile',
        puzzle: p,
        n: numberOf.get(p.id) ?? 0,
        chapter: c,
        state: done ? 'done' : p.id === nowId ? 'now' : 'ahead',
        going: !done && Boolean(store.resumeOf(gid, p.id)),
      });
    }
  });
  const R = rows.length;

  /** Row `j` counted from the bottom, on the meander. */
  const groundOfRow = (j: number): Pt2 => slotAt(R - 1 - j);

  const yOf = (g: Pt2) => project(FLAT, g[0], g[1], 0)[1];
  const yTop = yOf(groundOfRow(R - 1));
  const yBot = yOf(groundOfRow(0));
  const y0 = yTop - HEAD;
  const H = yBot + TAIL - y0;
  /** View-unit y of a row, in the finished drawing. */
  const rowY = (j: number) => yOf(groundOfRow(j)) - y0;

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

  /*
   * The ends of the ribbon.
   *
   * The mask is fixed to the viewBox rather than to the tiles, and HEAD and
   * TAIL are FADE + GAP, so the ribbon is at zero exactly where the drawing
   * stops. That is the whole trick: the path carries on past the first tile,
   * and there is still nothing underneath it to scroll into.
   */
  const fade = (id: string, up: boolean) => {
    const g = svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.appendChild(svg('stop', { offset: '0', 'stop-color': up ? '#000' : '#fff' }));
    g.appendChild(svg('stop', { offset: '1', 'stop-color': up ? '#fff' : '#000' }));
    return g;
  };
  defs.appendChild(fade('pathfadetop', true));
  defs.appendChild(fade('pathfadebot', false));
  const mask = svg('mask', { id: 'pathends', maskUnits: 'userSpaceOnUse' });
  /* In the scene's own space: it is the ribbon that wears the mask, and the
     ribbon is inside the shift. */
  const wide = { x: -120, width: VIEW_W + 240 };
  mask.append(
    svg('rect', { ...wide, y: y0, height: FADE, fill: 'url(#pathfadetop)' }),
    svg('rect', { ...wide, y: y0 + FADE, height: Math.max(0, H - 2 * FADE), fill: '#fff' }),
    svg('rect', { ...wide, y: y0 + H - FADE, height: FADE, fill: 'url(#pathfadebot)' }),
  );
  defs.appendChild(mask);

  root.appendChild(scene);

  // --- the ribbon ----------------------------------------------------------
  /*
   * A slab, not a line: walked behind you, pale ahead. The side is a genuine
   * sweep — the run stroked at every step down to its depth — because one copy
   * shifted down leaves a notch of background at every corner, where the two
   * round joins bulge apart.
   */
  const ground = meanderGround(R);
  const nowRow = rows.findIndex((r) => r.kind === 'tile' && r.state === 'now');
  const cutAt = groundOfRow(nowRow === -1 ? R - 1 : nowRow);
  const halves = splitPolyline(ground, cutAt);

  const ribbon = svg('g', { class: 'ribbon', mask: 'url(#pathends)' });
  const pointsOf = (pts: Pt2[], z: number) => {
    const dz = z * lift(FLAT);
    let out = '';
    for (const g of pts) {
      const q = project(FLAT, g[0], g[1], 0);
      out += `${q[0].toFixed(1)},${(q[1] - dz).toFixed(1)} `;
    }
    return out;
  };
  const run = (cls: string, z: number, pts: Pt2[]) => {
    ribbon.appendChild(svg('polyline', { class: cls, points: pointsOf(pts, z) }));
  };
  const SWEEP_STEP = 1.5;
  const sweep = (cls: string, pts: Pt2[]) => {
    const step = (SWEEP_STEP / RIBBON_D) * G_RIBBON_D;
    for (let z = 0; z < G_RIBBON_D; z += step) run(cls, BOT_Z + z, pts);
  };
  // The ribbon shares a floor with the tiles: its underside is level with
  // their bases, so the path does not hover.
  sweep('ahead side', halves.before);
  run('ahead', BOT_Z + G_RIBBON_D, halves.before);
  sweep('walked side', halves.after);
  run('walked', BOT_Z + G_RIBBON_D, halves.after);
  scene.appendChild(ribbon);

  // --- the chapter bands ---------------------------------------------------
  /*
   * Drawn over the ribbon and in the same units as everything else, so they
   * scale with the drawing and need no measuring after layout. The path runs
   * behind a band rather than through it: a chapter break is a break.
   */
  const bandY: number[] = [];
  for (let j = 0; j < R; j++) {
    const row = rows[j];
    if (row.kind !== 'band') continue;
    /* Drawn in the scene's space; remembered in the drawing's, because that is
       what the rail's percentages are a fraction of. */
    const y = yOf(groundOfRow(j));
    bandY[row.chapter] = y - y0;
    const g = svg('g', { class: 'pband', 'aria-hidden': 'true' });
    g.append(
      svg('rect', { class: 'plate', x: -120, width: VIEW_W + 240, y: y - BAND_H / 2, height: BAND_H }),
      svg('line', { class: 'rule', x1: -120, x2: VIEW_W + 240, y1: y - BAND_H / 2, y2: y - BAND_H / 2 }),
      svg('line', { class: 'rule', x1: -120, x2: VIEW_W + 240, y1: y + BAND_H / 2, y2: y + BAND_H / 2 }),
      svg('text', {
        class: 'bnum', x: VIEW_W / 2, y: y - 14, 'text-anchor': 'middle',
        text: `Chapter ${row.chapter + 1}`,
      }),
      svg('text', {
        class: 'bname', x: VIEW_W / 2, y: y + 34, 'text-anchor': 'middle', text: row.name,
      }),
    );
    scene.appendChild(g);
  }

  // --- the tiles -----------------------------------------------------------
  const STATE_WORD = { done: 'solved', now: 'where you are up to', ahead: 'not started' };
  for (let j = 0; j < R; j++) {
    const row = rows[j];
    if (row.kind !== 'tile') continue;
    const g = groundOfRow(j);
    const cls = `ptile ${row.state}${row.going ? ' going' : ''}`;
    const grp = svg('g', {
      class: cls,
      role: 'listitem',
      tabindex: 0,
      'data-puzzle': row.puzzle.id,
      'aria-label': `Puzzle ${row.n}, ${chapters[row.chapter].name}, ${row.going ? 'in progress' : STATE_WORD[row.state]}`,
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
      grp.appendChild(svg('path', {
        class: 'halo',
        fill: 'url(#pathhalo)',
        filter: 'url(#pathglow)',
        d: sweptPath(g, BOT_Z, TOP_Z + GLOW_H, true),
      }));
    }
    grp.append(
      svg('path', { class: 'side', d: sweptPath(g, BOT_Z, TOP_Z, false) }),
      svg('path', { class: 'top', d: roundPoly(faceQuad(g, TOP_Z), CORNER_R) }),
      svg('path', { class: 'inner', d: roundPoly(faceQuad(g, TOP_Z, 0.5 * 0.675), CORNER_R * 0.86) }),
    );
    const num = svg('text', {
      class: 'pnum', 'text-anchor': 'middle', 'dominant-baseline': 'central',
      transform: faceTransform(g), text: String(row.n),
    });
    grp.appendChild(num);

    const open = () => hooks.open(row.puzzle.id);
    grp.addEventListener('click', open);
    grp.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
    });
    scene.appendChild(grp);
  }

  // --- the frame around it -------------------------------------------------
  const scroller = h('div', { class: 'pathscroll' }, root);

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
    m.style.top = `${((bandY[c] ?? 0) / H) * 100}%`;
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
    flag.style.top = `${((bandY[c] ?? 0) / H) * 100}%`;
  };

  /** Where the scroller has to be for chapter `c` to be at the foot of the view. */
  const targetOf = (c: number): number => {
    const k = root.clientWidth / VIEW_W || 1;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    return Math.max(0, Math.min(max, (bandY[c] ?? 0) * k - scroller.clientHeight * 0.78));
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
    const line = scroller.scrollTop + scroller.clientHeight * 0.78;
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
      const d = Math.abs((bandY[c] ?? 0) / H - f);
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
    const c = rows[nowRow]?.kind === 'tile' && nowRow >= 0
      ? (rows[nowRow] as Extract<Row, { kind: 'tile' }>).chapter
      : chapters.length - 1;
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
