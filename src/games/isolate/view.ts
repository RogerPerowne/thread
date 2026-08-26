/**
 * Isolate's board.
 *
 * One verb: draw a wall on the line between two cells. A press puts one there,
 * a press on one that is already there takes it off, and a drag does the same
 * to every line it crosses — with the FIRST line deciding which of the two the
 * whole drag is doing, so a sweep along a room's edge never rubs out half of
 * what it just drew.
 *
 * Walls are hit by their line, not by the cell they belong to. A press is
 * measured against every edge and takes the nearest, if it is near enough:
 * that way the middle of a cell is dead ground rather than a coin toss between
 * four walls, and the target is the thing you were aiming at rather than the
 * box round it.
 */

import { svg } from '../../platform/dom.js';
import {
  judge, edgeBetween, edgeCount, upright, cornerAt,
} from './model.js';
import type { IsolateSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/** Board units. Everything below is a ratio of the cell. */
const CELL = 20;
/** The paper round the grid, enough for the outer wall to have somewhere. */
const EDGE = 5;
/** A circle in a cell, and the number written in it. */
const DOT_R = CELL * 0.3;
/** How close a press has to come to a line to be about that line. */
const REACH = CELL * 0.34;

export function mountIsolate(root: HTMLElement, session: IsolateSession, host: ViewHost): View {
  const board = session.board;
  const { w, h } = board;
  const total = w * h;
  const E = edgeCount(w, h);
  const W = w * CELL + EDGE * 2;
  const H = h * CELL + EDGE * 2;

  const wrap = document.createElement('div');
  wrap.className = 'gameboard iso-board';
  wrap.style.setProperty('--board-ratio', String(W / H));

  const el = svg('svg', {
    class: 'iso-svg',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'application',
    'aria-label': `Isolate, ${w} by ${h}`,
    tabindex: 0,
  });
  wrap.appendChild(el);
  root.appendChild(wrap);

  const gCells = svg('g', { class: 'iso-cells' });
  const gLines = svg('g', { class: 'iso-lines' });
  const gDots = svg('g', { class: 'iso-dots' });
  const gCross = svg('g', { class: 'iso-crosses' });
  const gWalls = svg('g', { class: 'iso-walls' });
  el.append(gCells, gLines, gDots, gCross, gWalls);

  const cellX = (i: number) => EDGE + (i % w) * CELL;
  const cellY = (i: number) => EDGE + ((i / w) | 0) * CELL;

  const cellEl: SVGRectElement[] = [];
  for (let i = 0; i < total; i++) {
    const rect = svg('rect', {
      class: 'iso-cell', x: cellX(i), y: cellY(i), width: CELL, height: CELL,
    });
    gCells.appendChild(rect);
    cellEl.push(rect);
  }

  /** The two ends of an edge, in board units. */
  const endsOf = (edge: number): [number, number, number, number] => {
    const up = upright(w, h);
    if (edge < up) {
      const r = (edge / (w - 1)) | 0;
      const c = edge % (w - 1);
      const x = EDGE + (c + 1) * CELL;
      return [x, EDGE + r * CELL, x, EDGE + (r + 1) * CELL];
    }
    const k = edge - up;
    const r = (k / w) | 0;
    const c = k % w;
    const y = EDGE + (r + 1) * CELL;
    return [EDGE + c * CELL, y, EDGE + (c + 1) * CELL, y];
  };

  /* The faint lines every wall could be drawn on. They are what makes the
     board look like something you draw on rather than something you fill in. */
  for (let edge = 0; edge < E; edge++) {
    const [x1, y1, x2, y2] = endsOf(edge);
    gLines.appendChild(svg('line', { class: 'iso-line', x1, y1, x2, y2 }));
  }

  /* The outside of the board is a wall everywhere, and is drawn as one so the
     player is never left wondering whether it counts. */
  gWalls.appendChild(svg('rect', {
    class: 'iso-rim', x: EDGE, y: EDGE, width: w * CELL, height: h * CELL,
  }));

  const wallEl: SVGLineElement[] = [];
  for (let edge = 0; edge < E; edge++) {
    const [x1, y1, x2, y2] = endsOf(edge);
    const line = svg('line', { class: 'iso-wall', x1, y1, x2, y2 });
    gWalls.appendChild(line);
    wallEl.push(line);
  }

  // --- the circles ---------------------------------------------------------
  for (const cell of board.dots) {
    const x = cellX(cell) + CELL / 2;
    const y = cellY(cell) + CELL / 2;
    const size = board.sizes[cell];
    const g = svg('g', { class: `iso-dot${size === undefined ? '' : ' numbered'}` });
    g.appendChild(svg('circle', { class: 'iso-ring', cx: x, cy: y, r: DOT_R }));
    if (size !== undefined) {
      g.appendChild(svg('text', {
        class: 'iso-num', x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        text: String(size),
      }));
    }
    gDots.appendChild(g);
  }

  // --- the crosses ---------------------------------------------------------
  const crossEl = new Map<number, SVGGElement>();
  for (const corner of board.crosses) {
    const at = cornerAt(w, corner);
    const x = EDGE + at.x * CELL;
    const y = EDGE + at.y * CELL;
    const arm = CELL * 0.17;
    const g = svg('g', { class: 'iso-cross' });
    g.append(
      svg('line', { x1: x - arm, y1: y, x2: x + arm, y2: y }),
      svg('line', { x1: x, y1: y - arm, x2: x, y2: y + arm }),
    );
    gCross.appendChild(g);
    crossEl.set(corner, g);
  }

  // --- painting ------------------------------------------------------------
  let cursor = 0;

  function paint(): void {
    const j = judge(board, session.walls);
    for (let edge = 0; edge < E; edge++) {
      const on = session.walls.has(edge);
      wallEl[edge].classList.toggle('on', on);
      wallEl[edge].classList.toggle('given', session.fixed(edge));
    }
    const wrong = new Set(j.wrong.flat());
    for (let i = 0; i < total; i++) {
      cellEl[i].classList.toggle('wrong', wrong.has(i));
      cellEl[i].classList.toggle('cursor', i === cursor && el === document.activeElement);
    }
    const waiting = new Set(j.waiting);
    for (const [corner, g] of crossEl) g.classList.toggle('done', !waiting.has(corner));
  }

  function settle(): void {
    session.openGesture();
    paint();
    host.changed();
    if (judge(board, session.walls).solved) host.solved();
  }

  // --- pointer -------------------------------------------------------------
  const point = (e: PointerEvent): { x: number; y: number } => {
    const box = el.getBoundingClientRect();
    const side = Math.min(box.width / W, box.height / H);
    const ox = box.left + (box.width - side * W) / 2;
    const oy = box.top + (box.height - side * H) / 2;
    return { x: (e.clientX - ox) / side, y: (e.clientY - oy) / side };
  };

  /**
   * The line a point is about, or -1.
   *
   * Measured against the line itself rather than against the cell it sits in,
   * so the middle of a cell belongs to nothing and a press near a line is
   * about that line however far along it lands.
   */
  const edgeUnder = (p: { x: number; y: number }): number => {
    let best = -1;
    let bestD = REACH;
    for (let edge = 0; edge < E; edge++) {
      const [x1, y1, x2, y2] = endsOf(edge);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len2));
      const d = Math.hypot(x1 + dx * t - p.x, y1 + dy * t - p.y);
      if (d < bestD) { bestD = d; best = edge; }
    }
    return best;
  };

  const cellUnder = (p: { x: number; y: number }): number => {
    const c = Math.floor((p.x - EDGE) / CELL);
    const r = Math.floor((p.y - EDGE) / CELL);
    if (c < 0 || r < 0 || c >= w || r >= h) return -1;
    return r * w + c;
  };

  let pointerId = -1;
  /** 1 while a drag is drawing walls, 0 while it is rubbing them out. */
  let drawing = 1;
  let lastEdge = -1;

  const stroke = (edge: number): void => {
    if (edge < 0 || edge === lastEdge) return;
    lastEdge = edge;
    if (session.fixed(edge)) { host.buzz('bump'); return; }
    if (session.set(edge, drawing === 1)) {
      host.buzz(drawing === 1 ? 'notch' : 'tick');
      settle();
    }
  };

  const onDown = (e: PointerEvent): void => {
    if (pointerId !== -1) return;
    const p = point(e);
    const edge = edgeUnder(p);
    const cell = cellUnder(p);
    if (cell >= 0) cursor = cell;
    if (edge < 0) { paint(); return; }
    pointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    session.openGesture();
    /* The line the drag starts on says what the whole drag does. */
    drawing = session.has(edge) ? 0 : 1;
    lastEdge = -1;
    stroke(edge);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    stroke(edgeUnder(point(e)));
    e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    lastEdge = -1;
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  // --- keyboard ------------------------------------------------------------
  /*
   * A cursor on a cell, and a wall drawn on whichever side you press. The
   * same verb as the thumb: one key, one wall.
   */
  const onKey = (e: KeyboardEvent): void => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -w, ArrowDown: w };
    if (e.key in step && e.shiftKey) {
      const other = cursor + step[e.key];
      const sameRow = Math.abs(step[e.key]) === 1 && ((cursor / w) | 0) === ((other / w) | 0);
      if (other >= 0 && other < total && (Math.abs(step[e.key]) === w || sameRow)) {
        const edge = edgeBetween(w, h, cursor, other);
        session.openGesture();
        drawing = session.has(edge) ? 0 : 1;
        lastEdge = -1;
        stroke(edge);
      }
      e.preventDefault();
      return;
    }
    if (e.key in step) {
      const next = cursor + step[e.key];
      const sameRow = Math.abs(step[e.key]) === 1 && ((cursor / w) | 0) === ((next / w) | 0);
      if (next >= 0 && next < total && (Math.abs(step[e.key]) === w || sameRow)) cursor = next;
      e.preventDefault();
      paint();
    }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('focus', paint);
  el.addEventListener('blur', paint);

  paint();

  (window as unknown as { __board?: unknown }).__board = {
    isolate: board,
    walls: () => [...session.walls].sort((a, b) => a - b),
    /** The middle of a line, which is where a thumb aims. */
    edgeSpot: (edge: number) => {
      const [x1, y1, x2, y2] = endsOf(edge);
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    },
    edgeBetween: (a: number, b: number) => edgeBetween(w, h, a, b),
    cellBox: (cell: number) => ({ x: cellX(cell), y: cellY(cell), size: CELL }),
    view: { W, H },
  };

  return {
    el: wrap,
    refresh: paint,
    spotlight(focus) {
      const cells = new Set(focus.filter((f) => f.startsWith('cell:')).map((f) => Number(f.slice(5))));
      const corners = new Set(focus.filter((f) => f.startsWith('corner:')).map((f) => Number(f.slice(7))));
      for (let i = 0; i < total; i++) cellEl[i].classList.toggle('lookhere', cells.has(i));
      for (const [corner, g] of crossEl) g.classList.toggle('lookhere', corners.has(corner));
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('keydown', onKey);
      wrap.remove();
      delete (window as unknown as { __board?: unknown }).__board;
    },
  };
}
