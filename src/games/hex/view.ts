/**
 * Hexagony's board.
 *
 * A set of spaces and a tray of tiles, and the whole interaction is moving one
 * tile. It is One to Nine's gesture model exactly — drag from the tray into a
 * space, drag between spaces to swap, drag off the board to put it back, or
 * tap a tile and then a space — because the two games ask for the same thing
 * and a player who has learnt one should not have to learn the other.
 *
 * What is different is what a tile IS. Six sectors, six numbers, and no
 * rotation: a tile with a five on its west face can only go where a five is
 * wanted on the west. So the tile is drawn as six coloured wedges with their
 * numbers written on them, and colour and number say the same thing twice —
 * the colour so a match can be seen across the board at a glance, the number
 * so it can still be seen when the colours cannot be told apart.
 *
 * Two constructions worth keeping. The spaces tile the plane, so the hexagon a
 * point is in is simply the one whose middle is nearest: no containment test,
 * no tolerance, and it cannot disagree with what is drawn. And the layout
 * chooses how many rows the tray takes by measuring the shape the whole
 * drawing would come out as, so a four-tile board and a nineteen-tile board
 * both land close to the proportions of a phone.
 */

import { svg } from '../../platform/dom.js';
import {
  judge, joinsOf, centreOf, hexPath, sectorPath, labelSpot, edgeCorners,
  DIRS, type Join,
} from './model.js';
import type { HexSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/** Board units: the circumradius of one space. Everything is a ratio of it. */
const R = 10;
/** A hexagon's bounding box, pointy-top. */
const HEX_W = Math.sqrt(3) * R;
const HEX_H = 2 * R;
/** Between tiles in the tray. Spaces on the board touch; the tray does not. */
const GAP = 0.18 * R;
/** Between the board and the tray, with the rule halfway. */
const SPLIT = 2.2 * R;
/**
 * The shape the whole drawing aims for, width over height.
 *
 * Measured rather than guessed: the box a board is given, after the masthead,
 * the status line and the controls, comes out at 0.53 wide-over-tall on a tall
 * phone and 0.75 on the shortest one still in use. This is the geometric
 * middle of those, so the worst case wastes the same fraction whichever way it
 * misses — and since all the aim does is choose how many rows the tray takes
 * from a handful of whole numbers, it is a target rather than a measurement to
 * be matched.
 */
const AIM = 0.62;

type Spot = { x: number; y: number };

export function mountHex(root: HTMLElement, session: HexSession, host: ViewHost): View {
  const hex = session.hex;
  const N = hex.tiles.length;
  const joins = joinsOf(hex);

  // --- layout --------------------------------------------------------------
  const raw = hex.cells.map((c) => centreOf(c));
  const boardMinX = Math.min(...raw.map((p) => p.x * R)) - HEX_W / 2;
  const boardMaxX = Math.max(...raw.map((p) => p.x * R)) + HEX_W / 2;
  const boardMinY = Math.min(...raw.map((p) => p.y * R)) - HEX_H / 2;
  const boardMaxY = Math.max(...raw.map((p) => p.y * R)) + HEX_H / 2;
  const boardW = boardMaxX - boardMinX;
  const boardH = boardMaxY - boardMinY;

  /** How many rows the tray takes, and the whole drawing's size with it. */
  const plan = (() => {
    let best = { rows: 1, cols: N, W: 0, H: 0, off: Infinity };
    for (let rows = 1; rows <= Math.min(4, N); rows++) {
      const cols = Math.ceil(N / rows);
      const trayW = cols * HEX_W + (cols - 1) * GAP;
      const trayH = rows * HEX_H + (rows - 1) * GAP;
      const W = Math.max(boardW, trayW);
      const H = boardH + SPLIT + trayH;
      const off = Math.abs(Math.log((W / H) / AIM));
      if (off < best.off) best = { rows, cols, W, H, off };
    }
    return best;
  })();
  const { W, H, cols } = plan;

  /** Where a space's middle sits in drawing coordinates. */
  const spaceAt = (at: number): Spot => ({
    x: (W - boardW) / 2 + raw[at].x * R - boardMinX,
    y: raw[at].y * R - boardMinY,
  });

  const trayTop = boardH + SPLIT;
  const RULE = boardH + SPLIT / 2;

  /**
   * Where a spare tile rests. Its place never changes, so the tile you were
   * looking at a moment ago is where you left it.
   */
  const slotAt = (tile: number): Spot => {
    const row = Math.floor(tile / cols);
    const col = tile % cols;
    const wide = Math.min(cols, N - row * cols);
    const width = wide * HEX_W + (wide - 1) * GAP;
    return {
      x: (W - width) / 2 + col * (HEX_W + GAP) + HEX_W / 2,
      y: trayTop + row * (HEX_H + GAP) + HEX_H / 2,
    };
  };

  const homeOf = (tile: number): Spot => {
    const at = session.where(tile);
    return at < 0 ? slotAt(tile) : spaceAt(at);
  };

  // --- the drawing ---------------------------------------------------------
  const PAD = 0.3 * R;
  const board = document.createElement('div');
  board.className = 'hex-board';
  board.style.setProperty('--hex-ratio', String((W + PAD * 2) / (H + PAD * 2)));

  const el = svg('svg', {
    class: 'hex-svg',
    viewBox: `${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'application',
    'aria-label': `Hexagony, ${hex.cells.length} spaces`,
    tabindex: 0,
  });
  board.appendChild(el);
  root.appendChild(board);

  const gSpaces = svg('g', { class: 'hex-spaces' });
  const gSlots = svg('g', { class: 'hex-slots' });
  const gTiles = svg('g', { class: 'hex-tiles' });
  const gJoins = svg('g', { class: 'hex-joins' });
  el.append(gSpaces, gSlots, gTiles, gJoins);

  const HOLE = hexPath(R * 0.94);
  const spaceEl: SVGPathElement[] = hex.cells.map((_, at) => {
    const s = spaceAt(at);
    const p = svg('path', {
      class: 'hex-hole', d: HOLE,
      transform: `translate(${s.x.toFixed(2)} ${s.y.toFixed(2)})`,
      'data-cell': at,
    });
    gSpaces.appendChild(p);
    return p;
  });

  for (let t = 0; t < N; t++) {
    const s = slotAt(t);
    gSlots.appendChild(svg('path', {
      class: 'hex-slot', d: HOLE,
      transform: `translate(${s.x.toFixed(2)} ${s.y.toFixed(2)})`,
    }));
  }

  el.insertBefore(svg('line', {
    class: 'hex-rule', x1: 0, x2: W, y1: RULE, y2: RULE,
  }), gTiles);

  /* One tile: six wedges, six numbers, and a hairline round the outside so a
     tile still reads as one object where two of them touch. */
  const tileEl: SVGGElement[] = [];
  for (let t = 0; t < N; t++) {
    const g = svg('g', { class: 'hex-tile', 'data-tile': t, role: 'button', tabindex: -1 });
    for (let d = 0; d < 6; d++) {
      const v = hex.tiles[t][d];
      g.appendChild(svg('path', { class: `hex-sec v${v}`, d: sectorPath(d, R) }));
    }
    g.appendChild(svg('path', { class: 'hex-edge', d: hexPath(R) }));
    for (let d = 0; d < 6; d++) {
      const spot = labelSpot(d, R);
      g.appendChild(svg('text', {
        class: 'hex-num', x: spot.x.toFixed(2), y: spot.y.toFixed(2),
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        text: String(hex.tiles[t][d]),
      }));
    }
    g.setAttribute('aria-label', `Tile ${t + 1}`);
    gTiles.appendChild(g);
    tileEl.push(g);
  }

  /*
   * A clash is drawn on the join itself: the shared edge, in the fault colour.
   * It can only appear where both tiles are down, so it says "these two, here"
   * rather than "something is wrong somewhere".
   */
  const joinEl: SVGLineElement[] = joins.map((j: Join) => {
    const s = spaceAt(j.a);
    const [p, q] = edgeCorners(j.dir, R);
    const line = svg('line', {
      class: 'hex-clash',
      x1: (s.x + p[0]).toFixed(2), y1: (s.y + p[1]).toFixed(2),
      x2: (s.x + q[0]).toFixed(2), y2: (s.y + q[1]).toFixed(2),
    });
    gJoins.appendChild(line);
    return line;
  });

  // --- painting ------------------------------------------------------------
  let held: number | null = null;
  let selected: number | null = null;
  let cursor = 0;

  function paint(): void {
    const j = judge(hex, session.placed);
    for (let t = 0; t < N; t++) {
      const g = tileEl[t];
      const at = session.where(t);
      g.classList.toggle('down', at >= 0);
      g.classList.toggle('picked', t === selected);
      g.setAttribute('aria-label', at >= 0 ? `Tile ${t + 1}, placed` : `Tile ${t + 1}, in the tray`);
      if (t === held) continue;
      const h = homeOf(t);
      g.setAttribute('transform', `translate(${h.x.toFixed(2)} ${h.y.toFixed(2)})`);
    }
    const clashing = new Set(j.clashes.map((c) => `${c.a}:${c.b}`));
    joins.forEach((join, i) => {
      joinEl[i].classList.toggle('on', clashing.has(`${join.a}:${join.b}`));
    });
    spaceEl.forEach((p, at) => {
      p.classList.toggle('cursor', at === cursor && el === document.activeElement);
      p.classList.toggle('full', session.placed[at] >= 0);
    });
  }

  // --- pointer -------------------------------------------------------------
  /** Drawing coordinates for a pointer event, through the SVG's own window. */
  const point = (e: PointerEvent): Spot => {
    const box = el.getBoundingClientRect();
    const side = Math.min(box.width / (W + PAD * 2), box.height / (H + PAD * 2));
    const ox = box.left + (box.width - side * (W + PAD * 2)) / 2 + side * PAD;
    const oy = box.top + (box.height - side * (H + PAD * 2)) / 2 + side * PAD;
    return { x: (e.clientX - ox) / side, y: (e.clientY - oy) / side };
  };

  /**
   * Which space a point is in, or -1.
   *
   * Hexagons tile the plane, so the one a point falls in is the one whose
   * middle is nearest — no containment test to get wrong, and no way for the
   * hit area to disagree with what is drawn. The reach is a shade over one
   * radius so that the space you are aiming at is still the space you get
   * when your thumb lands just outside it.
   */
  const spaceUnder = (p: Spot): number => {
    let best = -1;
    let bestD = R * 1.1;
    hex.cells.forEach((_, at) => {
      const s = spaceAt(at);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) { bestD = d; best = at; }
    });
    return best;
  };

  /**
   * Which spare tile is under a point, or -1.
   *
   * By the slot geometry and the model, never by what is drawn there: a tile
   * slides home over a tenth of a second, and for that tenth the thing under
   * the finger and the thing the board believes is under the finger are
   * different elements.
   */
  const trayUnder = (p: Spot): number => {
    let best = -1;
    let bestD = R;
    for (let t = 0; t < N; t++) {
      if (session.where(t) >= 0) continue;
      const s = slotAt(t);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  };

  let moved = false;
  let grabbed = { x: 0, y: 0 };
  let pointerId = -1;

  const lift = (tile: number, p: Spot): void => {
    held = tile;
    moved = false;
    const h = homeOf(tile);
    grabbed = { x: p.x - h.x, y: p.y - h.y };
    tileEl[tile].classList.add('held');
    gTiles.appendChild(tileEl[tile]); // the held tile draws over the rest
  };

  const drag = (p: Spot): void => {
    if (held === null) return;
    tileEl[held].setAttribute(
      'transform',
      `translate(${(p.x - grabbed.x).toFixed(2)} ${(p.y - grabbed.y).toFixed(2)})`,
    );
    const over = spaceUnder(p);
    spaceEl.forEach((s, at) => s.classList.toggle('over', at === over));
  };

  function settle(): void {
    session.openGesture();
    paint();
    host.changed();
    if (judge(hex, session.placed).solved) host.solved();
  }

  const drop = (p: Spot): void => {
    if (held === null) return;
    const tile = held;
    const target = spaceUnder(p);
    held = null;
    tileEl[tile].classList.remove('held');
    spaceEl.forEach((s) => s.classList.remove('over'));

    if (!moved) {
      /* A tap. A tile in the tray becomes the one waiting to be put down; a
         tile on the board goes back to the tray, which is the only thing a tap
         on it could mean. */
      const wasAt = session.where(tile);
      if (selected === tile) selected = null;
      else if (wasAt >= 0) { session.lift(wasAt); host.buzz('tick'); }
      else selected = tile;
      settle();
      return;
    }

    if (target >= 0) {
      session.place(target, tile);
      cursor = target;
      host.buzz('notch');
    } else if (session.where(tile) >= 0) {
      session.lift(session.where(tile));
      host.buzz('tick');
    }
    selected = null;
    settle();
  };

  const onDown = (e: PointerEvent): void => {
    if (pointerId !== -1) return;
    const p = point(e);
    const at = spaceUnder(p);

    if (at >= 0) {
      pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      cursor = at;
      const sitting = session.placed[at];
      if (sitting >= 0) {
        session.openGesture();
        lift(sitting, p);
      } else if (selected !== null) {
        session.openGesture();
        session.place(at, selected);
        selected = null;
        host.buzz('notch');
        settle();
      } else {
        paint();
      }
      e.preventDefault();
      return;
    }

    const spare = trayUnder(p);
    if (spare >= 0) {
      pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      session.openGesture();
      lift(spare, p);
      e.preventDefault();
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId || held === null) return;
    const p = point(e);
    const h = homeOf(held);
    if (!moved && Math.hypot(p.x - grabbed.x - h.x, p.y - grabbed.y - h.y) > 0.12 * R) moved = true;
    drag(p);
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    if (held !== null) drop(point(e));
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  // --- keyboard ------------------------------------------------------------
  /**
   * The cursor walks the board by direction, and Enter deals tiles into it.
   *
   * There is no numbering to type, so the keyboard does what a hand does: it
   * puts the next spare tile in the space and, pressed again, swaps it for the
   * one after that. Going round the tray in place is the keyboard's version of
   * holding a few tiles up to a gap in turn.
   */
  const index = new Map<string, number>();
  hex.cells.forEach(([q, r], i) => index.set(`${q},${r}`, i));
  const stepTo = (at: number, dir: number): number => {
    const [q, r] = hex.cells[at];
    const [dq, dr] = DIRS[dir];
    return index.get(`${q + dq},${r + dr}`) ?? at;
  };

  const onKey = (e: KeyboardEvent): void => {
    const turn: Record<string, number> = {
      ArrowRight: 0, ArrowUp: 2, ArrowLeft: 3, ArrowDown: 5,
    };
    if (e.key in turn) {
      cursor = stepTo(cursor, turn[e.key]);
      e.preventDefault();
      paint();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const here = session.placed[cursor];
      const spare = session.spare();
      if (spare.length === 0 && here < 0) return;
      session.openGesture();
      if (here < 0) session.place(cursor, spare[0]);
      else {
        const next = spare.find((t) => t > here) ?? spare[0];
        if (next === undefined) session.lift(cursor);
        else session.place(cursor, next);
      }
      settle();
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      session.openGesture();
      session.lift(cursor);
      settle();
      e.preventDefault();
    }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('focus', paint);
  el.addEventListener('blur', paint);

  paint();

  /* What a test may read. In the game's own terms: tiles and spaces. */
  (window as unknown as { __board?: unknown }).__board = {
    hex,
    placed: () => session.placed.slice(),
    space: (at: number) => spaceAt(at),
    slot: (tile: number) => slotAt(tile),
    radius: R,
    view: { W: W + PAD * 2, H: H + PAD * 2, ox: -PAD, oy: -PAD },
  };

  return {
    el: board,
    refresh: paint,
    spotlight(focus) {
      const spaces = new Set(focus.filter((f) => f.startsWith('cell:')).map((f) => Number(f.slice(5))));
      const tiles = new Set(focus.filter((f) => f.startsWith('tile:')).map((f) => Number(f.slice(5))));
      spaceEl.forEach((s, at) => s.classList.toggle('lookhere', spaces.has(at)));
      tileEl.forEach((g, t) => g.classList.toggle('lookhere', tiles.has(t)));
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('keydown', onKey);
      board.remove();
      delete (window as unknown as { __board?: unknown }).__board;
    },
  };
}
