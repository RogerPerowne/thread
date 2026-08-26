/**
 * Zigzag's board.
 *
 * You put a finger on the first cell and draw. The line follows, one cell at a
 * time, and dragging back over the cell before removes the last step — the
 * correction you make constantly while drawing has to cost nothing, or the
 * whole gesture becomes a thing you brace for.
 *
 * Two things make it feel right on a phone and both are about sampling. The
 * line between two pointer samples is walked rather than jumped, so a fast
 * finger crosses the same cells a slow one does. And a cell is entered when
 * the finger is properly inside it, not when it grazes a corner: diagonal
 * moves are legal here, so a lenient hit area would step diagonally every time
 * a thumb wandered near a corner.
 */

import { svg } from '../../platform/dom.js';
import { neighbours } from './model.js';
import type { ZigSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/** Board units per cell. Everything below is in these. */
const U = 10;
/** How far into a cell the finger has to be, as a share of half a cell. */
const INSIDE = 0.62;

export function mountZigzag(
  root: HTMLElement, session: ZigSession, host: ViewHost,
): View {
  const zig = session.zig;
  const W = zig.w * U;
  const H = zig.h * U;

  const el = svg('svg', {
    class: 'zig-svg',
    viewBox: `-1 -1 ${W + 2} ${H + 2}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'application',
    'aria-label': `Zigzag board, ${zig.w} by ${zig.h}`,
  });

  const gCells = svg('g', { class: 'zig-cells' });
  const gLine = svg('g', { class: 'zig-line' });
  const gMarks = svg('g', { class: 'zig-marks' });

  const cellEl: SVGRectElement[] = [];
  const textEl: SVGTextElement[] = [];

  for (let i = 0; i < zig.w * zig.h; i++) {
    const x = (i % zig.w) * U;
    const y = ((i / zig.w) | 0) * U;
    const box = svg('rect', {
      x: x + 0.35, y: y + 0.35, width: U - 0.7, height: U - 0.7, rx: 1.1,
      class: 'zig-cell',
    });
    const label = svg('text', {
      x: x + U / 2, y: y + U / 2, class: 'zig-num',
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      text: String(zig.cells[i]),
    });
    gCells.append(box, label);
    cellEl.push(box);
    textEl.push(label);
  }

  // The two ends, marked so the board says where to begin without a caption.
  for (const [cell, kind] of [[zig.start, 'from'], [zig.finish, 'to']] as const) {
    const x = (cell % zig.w) * U;
    const y = ((cell / zig.w) | 0) * U;
    gMarks.appendChild(svg('rect', {
      x: x + 0.35, y: y + 0.35, width: U - 0.7, height: U - 0.7, rx: 1.1,
      class: `zig-end ${kind}`,
    }));
  }

  const line = svg('path', {
    class: 'zig-path', fill: 'none',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const lead = svg('line', { class: 'zig-lead' });
  gLine.append(line, lead);

  el.append(gCells, gMarks, gLine);
  const box = document.createElement('div');
  box.className = 'zig-board';
  // The stylesheet sizes the square from the container; a non-square board
  // needs its own ratio or it is letterboxed and drawn smaller than it needs.
  box.style.setProperty('--zig-ratio', String((W + 2) / (H + 2)));
  box.appendChild(el);
  root.appendChild(box);

  // --- drawing --------------------------------------------------------------

  function paint(): void {
    const path = session.path;
    const d = path.map((c, i) => {
      const x = (c % zig.w) * U + U / 2;
      const y = ((c / zig.w) | 0) * U + U / 2;
      return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
    }).join('');
    line.setAttribute('d', path.length === 1 ? `${d}l0 0` : d);

    const on = new Set(path);
    for (let i = 0; i < cellEl.length; i++) {
      cellEl[i].classList.toggle('on', on.has(i));
      textEl[i].classList.toggle('on', on.has(i));
    }
    const head = path[path.length - 1];
    for (let i = 0; i < cellEl.length; i++) cellEl[i].classList.toggle('head', i === head);
    host.changed();
  }

  /** Board point from a client point. */
  function at(clientX: number, clientY: number): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    const side = Math.min(r.width / (W + 2), r.height / (H + 2));
    const ox = r.left + (r.width - side * (W + 2)) / 2 + side;
    const oy = r.top + (r.height - side * (H + 2)) / 2 + side;
    return { x: (clientX - ox) / side, y: (clientY - oy) / side };
  }

  /**
   * The cell a point is properly inside, or -1.
   *
   * Properly, not merely nearest. Diagonal steps are legal, so a hit area that
   * reached the corners would let a thumb drifting past a corner take a
   * diagonal the player never meant.
   */
  function cellAt(x: number, y: number): number {
    const cx = Math.floor(x / U);
    const cy = Math.floor(y / U);
    if (cx < 0 || cy < 0 || cx >= zig.w || cy >= zig.h) return -1;
    const dx = Math.abs(x - (cx * U + U / 2));
    const dy = Math.abs(y - (cy * U + U / 2));
    if (Math.max(dx, dy) > (U / 2) * INSIDE) return -1;
    return cy * zig.w + cx;
  }

  let holding = false;
  let lastAt: { x: number; y: number } | null = null;
  let lastCell = -1;
  let refused = -1;

  /** Step to a cell, or take one back. */
  function reach(cell: number): void {
    const path = session.path;
    // Back over the cell before: take the last step off. The correction you
    // make while drawing must cost exactly what making the step cost.
    if (path.length >= 2 && cell === path[path.length - 2]) {
      session.mark();
      path.pop();
      host.buzz('notch');
      refused = -1;
      paint();
      return;
    }
    if (path.includes(cell)) return;
    if (!session.canGo(cell)) {
      if (cell !== refused) {
        refused = cell;
        cellEl[cell]?.classList.remove('no');
        void cellEl[cell]?.getBoundingClientRect();
        cellEl[cell]?.classList.add('no');
        setTimeout(() => cellEl[cell]?.classList.remove('no'), 420);
        host.buzz('bump');
      }
      return;
    }
    session.mark();
    path.push(cell);
    refused = -1;
    host.buzz('tick');
    paint();
  }

  /** Every cell the finger crossed since the last sample, in order. */
  function sweep(to: { x: number; y: number }): void {
    const from = lastAt ?? to;
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.min(64, Math.max(1, Math.ceil(span / (U * 0.34))));
    for (let i = 1; i <= steps && holding; i++) {
      const k = i / steps;
      const cell = cellAt(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      if (cell < 0 || cell === lastCell) continue;
      lastCell = cell;
      reach(cell);
    }
  }

  const onDown = (e: PointerEvent) => {
    if (session.verdict().solved) return;
    const p = at(e.clientX, e.clientY);
    const cell = cellAt(p.x, p.y);
    if (cell < 0) return;
    holding = true;
    lastAt = p;
    lastCell = cell;
    refused = -1;
    session.openGesture();
    reach(cell);
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!holding) return;
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const s of samples.length > 0 ? samples : [e]) {
      const p = at(s.clientX, s.clientY);
      sweep(p);
      lastAt = p;
    }
    const head = session.path[session.path.length - 1];
    if (head !== undefined && lastAt) {
      const hx = (head % zig.w) * U + U / 2;
      const hy = ((head / zig.w) | 0) * U + U / 2;
      lead.setAttribute('x1', String(hx));
      lead.setAttribute('y1', String(hy));
      lead.setAttribute('x2', lastAt.x.toFixed(2));
      lead.setAttribute('y2', lastAt.y.toFixed(2));
      lead.setAttribute('opacity', '1');
    }
    e.preventDefault();
  };

  const onUp = () => {
    if (!holding) return;
    holding = false;
    lastAt = null;
    lastCell = -1;
    refused = -1;
    lead.setAttribute('opacity', '0');
    paint();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  // --- the keyboard --------------------------------------------------------
  /*
   * The whole game without a pointer: arrows step the line to the neighbour in
   * that direction, backspace takes one back. It works because the move set is
   * the eight neighbours, which is exactly what a keypad can express.
   */
  el.tabIndex = 0;
  const onKey = (e: KeyboardEvent) => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1],
    };
    if (e.key === 'Backspace') {
      if (session.path.length > 0) {
        session.openGesture();
        session.mark();
        session.path.pop();
        paint();
      }
      e.preventDefault();
      return;
    }
    const dir = dirs[e.key];
    if (!dir) return;
    e.preventDefault();
    const head = session.path[session.path.length - 1];
    if (head === undefined) {
      session.openGesture();
      reach(zig.start);
      return;
    }
    const x = (head % zig.w) + dir[0];
    const y = ((head / zig.w) | 0) + dir[1];
    if (x < 0 || y < 0 || x >= zig.w || y >= zig.h) return;
    session.openGesture();
    reach(y * zig.w + x);
  };
  el.addEventListener('keydown', onKey);

  // A read-only handle for the harness: see the note in Thread's board.
  (window as unknown as { __board: unknown }).__board = {
    game: 'zigzag',
    zig,
    path: () => [...session.path],
  };

  paint();

  return {
    el: box,
    refresh: paint,
    spotlight(focus) {
      for (const c of cellEl) c.classList.remove('look');
      for (const f of focus) {
        const n = Number(f.split(':')[1]);
        if (Number.isInteger(n)) cellEl[n]?.classList.add('look');
      }
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('keydown', onKey);
      delete (window as unknown as { __board?: unknown }).__board;
    },
  };
}

export { neighbours };
