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
import { neighbours, stepsFrom } from './model.js';
import type { ZigSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/** Board units per cell. Everything below is in these. */
const U = 10;
/** How far into a cell the finger has to be, as a share of half a cell. */
const INSIDE = 0.62;
/**
 * The run strip under the grid: the sequence the numbers have to follow, with
 * the next one wanted lit. Its height, the size of one number in it, and the
 * gap between two.
 */
const STRIP = 9.5;
const RUN = 6;
const RUN_GAP = 1.5;

export function mountZigzag(
  root: HTMLElement, session: ZigSession, host: ViewHost,
): View {
  const zig = session.zig;
  const W = zig.w * U;
  const H = zig.h * U;
  /* The window: a unit of margin round the grid, and the run strip below. */
  const view = { x: -1, y: -1, W: W + 2, H: H + 2 + STRIP };

  const el = svg('svg', {
    class: 'zig-svg',
    viewBox: `${view.x} ${view.y} ${view.W} ${view.H}`,
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

  /*
   * The run. "1, 2, 3, 4, then 1 again" is the whole rule, and it used to
   * live only in the rules sheet — so a refused step was a step refused for
   * a reason you had to remember. The strip says the run once, under the
   * board, and lights the number the line wants next; it advances as the
   * line is drawn, which is also the only progress a Zigzag board has to
   * show that is not the line itself.
   */
  const gRun = svg('g', { class: 'zig-run' });
  const runEl: SVGRectElement[] = [];
  {
    const n = zig.sequence.length;
    const width = n * RUN + (n - 1) * RUN_GAP;
    const left = (W - width) / 2;
    const top = H + 1 + (STRIP - RUN) / 2;
    zig.sequence.forEach((v, i) => {
      const x = left + i * (RUN + RUN_GAP);
      const box = svg('rect', { x, y: top, width: RUN, height: RUN, rx: 1.2, class: 'zig-runbox' });
      const label = svg('text', {
        x: x + RUN / 2, y: top + RUN / 2, class: 'zig-runnum',
        'text-anchor': 'middle', 'dominant-baseline': 'central', text: String(v),
      });
      gRun.append(box, label);
      runEl.push(box);
    });
  }

  const line = svg('path', {
    class: 'zig-path', fill: 'none',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  });
  const lead = svg('line', { class: 'zig-lead' });

  /*
   * Taking line back off.
   *
   * The discarded stretch is drawn on a spare path and wound off: a dash as
   * long as the whole thing, retreating from the far end towards the cell the
   * line now ends at. A line that simply stops being there reads as a bug, and
   * on a board you are still dragging across it is easy to miss entirely —
   * which is exactly the complaint Thread had, so this is Thread's answer.
   *
   * Several of them, cycled, because winding back over five cells in one sweep
   * takes five stretches off and each deserves its own recoil rather than
   * cutting the one before it short.
   */
  const recoils: SVGPathElement[] = [];
  for (let i = 0; i < 6; i++) {
    const r = svg('path', {
      class: 'zig-path recoil', fill: 'none',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    gLine.appendChild(r);
    recoils.push(r);
  }
  let nextRecoil = 0;

  /** Where a cell's middle is, in board units. */
  const midOf = (c: number) => ({
    x: (c % zig.w) * U + U / 2,
    y: ((c / zig.w) | 0) * U + U / 2,
  });

  const dOf = (cells: readonly number[]): string => cells.map((c, i) => {
    const m = midOf(c);
    return `${i === 0 ? 'M' : 'L'}${m.x} ${m.y}`;
  }).join('');

  /**
   * Wind a stretch off. `cells` runs from the FAR end to the cell the line now
   * ends at, because that is the direction the dash retreats in.
   */
  function retract(cells: readonly number[]): void {
    if (cells.length < 2) return;
    const node = recoils[nextRecoil];
    nextRecoil = (nextRecoil + 1) % recoils.length;
    node.setAttribute('d', dOf(cells));
    node.classList.remove('go');
    // Measuring the path is what makes the dash exactly its own length, so the
    // recoil ends at the new head rather than somewhere near it.
    const len = node.getTotalLength();
    node.style.setProperty('--len', String(len));
    node.setAttribute('stroke-dasharray', String(len));
    node.classList.add('go');
  }

  gLine.append(line, lead);

  el.append(gCells, gMarks, gLine, gRun);
  const box = document.createElement('div');
  box.className = 'gameboard zig-board';
  // The stylesheet sizes the square from the container; a non-square board
  // needs its own ratio or it is letterboxed and drawn smaller than it needs.
  box.style.setProperty('--board-ratio', String(view.W / view.H));
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

    /*
     * Where the line can go next, marked. Not the answer — the answer is which
     * of them — but the rule, applied: a touching cell carrying the number the
     * run wants. A refused step is then a step onto a cell that was plainly
     * not marked, rather than a flinch to be puzzled over.
     */
    const can = new Set(head === undefined
      ? (path.length === 0 ? [zig.start] : [])
      : stepsFrom(zig, head).filter((c) => session.canGo(c)));
    for (let i = 0; i < cellEl.length; i++) cellEl[i].classList.toggle('can', can.has(i));

    /* The run strip: the number wanted next, lit. Nothing lit once the line
       is complete — there is no next. */
    const done = path.length >= zig.w * zig.h;
    const want = path.length % zig.sequence.length;
    runEl.forEach((r, i) => r.classList.toggle('next', !done && i === want));
    host.changed();
  }

  /** Board point from a client point. */
  function at(clientX: number, clientY: number): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    const side = Math.min(r.width / view.W, r.height / view.H);
    const ox = r.left + (r.width - side * view.W) / 2 - view.x * side;
    const oy = r.top + (r.height - side * view.H) / 2 - view.y * side;
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

  /**
   * Cut the line back to a cell it already runs through, and wind off what was
   * beyond it.
   *
   * This is the whole "grab it anywhere" gesture. Put a finger on the seventh
   * cell of a line twenty long and the thirteen after it come away, and you
   * carry on drawing from where your finger is — which is what you meant, and
   * is otherwise thirteen taps of undo.
   */
  function cutBackTo(cell: number): void {
    const path = session.path;
    const at = path.indexOf(cell);
    if (at < 0 || at === path.length - 1) return;
    session.mark();
    /* Far end first: the dash retreats from there towards the new head. */
    retract(path.slice(at).reverse());
    path.length = at + 1;
    host.buzz('notch');
    refused = -1;
    paint();
  }

  /** Step to a cell, or take one back. */
  function reach(cell: number): void {
    const path = session.path;
    // Back over the cell before: take the last step off. The correction you
    // make while drawing must cost exactly what making the step cost.
    if (path.length >= 2 && cell === path[path.length - 2]) {
      session.mark();
      retract([path[path.length - 1], cell]);
      path.pop();
      host.buzz('notch');
      refused = -1;
      paint();
      return;
    }
    /*
     * Somewhere further back along the line. Dragging onto it means the same
     * thing as pressing it: everything past that cell comes off and drawing
     * carries on from there.
     */
    if (path.includes(cell)) {
      if (cell !== path[path.length - 1]) cutBackTo(cell);
      return;
    }
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
    /*
     * A press on a cell the line already runs through takes it back to there.
     * A press anywhere else is a step, as before. Nobody is asked which they
     * meant: where the finger lands says it.
     */
    if (session.path.includes(cell)) cutBackTo(cell);
    else reach(cell);
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
    /* The window and where each cell's middle is, read rather than
       recomputed, so a harness cannot drift from what a thumb hits. */
    view,
    mids: () => zig.cells.map((_, c) => midOf(c)),
    /** The cells the board is marking as legal next steps. */
    can: () => cellEl.map((c, i) => (c.classList.contains('can') ? i : -1)).filter((i) => i >= 0),
  };

  paint();

  return {
    el: box,
    refresh: paint,
    spotlight(focus) {
      for (const c of cellEl) c.classList.remove('lookhere');
      for (const f of focus) {
        const n = Number(f.split(':')[1]);
        if (Number.isInteger(n)) cellEl[n]?.classList.add('lookhere');
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
