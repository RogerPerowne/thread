/**
 * One to Nine's board.
 *
 * Nine tokens and nine holes. The whole interaction is moving one token, and
 * the design rule is that there is never a wrong way to do it:
 *
 *   - drag a token from the tray into a cell;
 *   - drag a token from one cell to another, which swaps them, because that is
 *     what you meant and nothing else it could mean is useful;
 *   - drag a token out of the board, anywhere, to put it back;
 *   - or tap: a token, then a cell. Either order — tap the cell first and then
 *     the token and it goes in just the same.
 *
 * Nobody is asked which of those they are doing. A gesture that moved is a
 * drag and a gesture that did not is a tap, and that is the entire rule.
 *
 * Two things are deliberate and easy to get wrong. The token follows the
 * finger from the moment it is picked up rather than after a threshold, so it
 * never feels stuck. And it is drawn with a lift under it while it is in the
 * air, because that is the only cue that says which of the two identical
 * things on screen is the one you are holding.
 */

import { svg } from '../../platform/dom.js';
import { OP_GLYPH, rowOpsOf, colOpsOf, judge } from './model.js';
import type { NineSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/** Board units. Everything below is in these. */
const CELL = 20;
const GAP = 11;
/** Where the nth cell's top-left corner sits. */
const at = (i: number) => i * (CELL + GAP);
const TOKEN = 19;
const TRAY_GAP = 4;

export function mountNine(root: HTMLElement, session: NineSession, host: ViewHost): View {
  const nine = session.nine;
  const { n } = nine;
  const total = n * n;
  const span = at(n - 1) + CELL;
  /** Where the targets are written. */
  const TARGET = span + 7;
  const W = span + 7 + 21;
  const perRow = Math.ceil(total / 2);
  /*
   * The tray is set well clear of the column totals under the grid. They are
   * both numerals in the same face, so if they sit close they read as one
   * block and the eye has to work out which numbers are the puzzle and which
   * are the pieces. The rule between them says the same thing again.
   */
  const RULE = span + 20;
  const TRAY_TOP = RULE + 12;
  const H = TRAY_TOP + TOKEN * 2 + TRAY_GAP;

  const board = document.createElement('div');
  board.className = 'nine-board';
  board.style.setProperty('--nine-ratio', String((W + 6) / (H + 6)));

  const el = svg('svg', {
    class: 'nine-svg',
    viewBox: `-3 -3 ${W + 6} ${H + 6}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'application',
    'aria-label': `One to Nine, ${n} by ${n}`,
    tabindex: 0,
  });
  board.appendChild(el);
  root.appendChild(board);

  const gCells = svg('g', { class: 'nine-cells' });
  const gOps = svg('g', { class: 'nine-ops' });
  const gTray = svg('g', { class: 'nine-tray' });
  const gTokens = svg('g', { class: 'nine-tokens' });
  el.append(gCells, gOps, gTray, gTokens);

  // --- the holes -----------------------------------------------------------
  const holeEl: SVGRectElement[] = [];
  for (let i = 0; i < total; i++) {
    const x = at(i % n);
    const y = at((i / n) | 0);
    const hole = svg('rect', {
      x, y, width: CELL, height: CELL, rx: 3, class: 'nine-hole', 'data-cell': i,
    });
    gCells.appendChild(hole);
    holeEl.push(hole);
  }

  // --- the operators and the targets --------------------------------------
  const rowTargetEl: SVGTextElement[] = [];
  const colTargetEl: SVGTextElement[] = [];
  for (let r = 0; r < n; r++) {
    const ops = rowOpsOf(nine, r);
    for (let k = 0; k < ops.length; k++) {
      gOps.appendChild(svg('text', {
        class: 'nine-op', x: at(k) + CELL + GAP / 2, y: at(r) + CELL / 2,
        'text-anchor': 'middle', 'dominant-baseline': 'central', text: OP_GLYPH[ops[k]],
      }));
    }
    const t = svg('text', {
      class: 'nine-target', x: TARGET, y: at(r) + CELL / 2,
      'text-anchor': 'start', 'dominant-baseline': 'central',
      text: String(nine.rowTargets[r]),
    });
    gOps.appendChild(t);
    rowTargetEl.push(t);
  }
  for (let c = 0; c < n; c++) {
    const ops = colOpsOf(nine, c);
    for (let k = 0; k < ops.length; k++) {
      gOps.appendChild(svg('text', {
        class: 'nine-op', x: at(c) + CELL / 2, y: at(k) + CELL + GAP / 2,
        'text-anchor': 'middle', 'dominant-baseline': 'central', text: OP_GLYPH[ops[k]],
      }));
    }
    const t = svg('text', {
      class: 'nine-target', x: at(c) + CELL / 2, y: TARGET + 5,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      text: String(nine.colTargets[c]),
    });
    gOps.appendChild(t);
    colTargetEl.push(t);
  }

  el.insertBefore(svg('line', {
    class: 'nine-rule', x1: 0, x2: W, y1: RULE, y2: RULE,
  }), gTray);

  // --- the tray ------------------------------------------------------------
  /** Where a spare digit rests. Its place in the tray never changes, so the
      digit you are looking for is where it was last time. */
  const slotOf = (digit: number): { x: number; y: number } => {
    const k = digit - 1;
    const row = k < perRow ? 0 : 1;
    const col = k < perRow ? k : k - perRow;
    const wide = row === 0 ? perRow : total - perRow;
    const width = wide * TOKEN + (wide - 1) * TRAY_GAP;
    return {
      x: (W - width) / 2 + col * (TOKEN + TRAY_GAP),
      y: TRAY_TOP + row * (TOKEN + TRAY_GAP),
    };
  };
  for (let d = 1; d <= total; d++) {
    const s = slotOf(d);
    gTray.appendChild(svg('rect', {
      class: 'nine-slot', x: s.x, y: s.y, width: TOKEN, height: TOKEN, rx: 3,
    }));
  }

  // --- the tokens ----------------------------------------------------------
  type Token = { g: SVGGElement; box: SVGRectElement; label: SVGTextElement };
  const tokens = new Map<number, Token>();
  for (let d = 1; d <= total; d++) {
    const g = svg('g', { class: 'nine-token', 'data-digit': d, role: 'button', tabindex: -1 });
    const box = svg('rect', { width: TOKEN, height: TOKEN, rx: 3, class: 'nine-chip' });
    const label = svg('text', {
      class: 'nine-digit', x: TOKEN / 2, y: TOKEN / 2,
      'text-anchor': 'middle', 'dominant-baseline': 'central', text: String(d),
    });
    g.append(box, label);
    gTokens.appendChild(g);
    tokens.set(d, { g, box, label });
  }

  /** Where a digit should be drawn: its cell, or its slot. */
  const homeOf = (digit: number): { x: number; y: number; size: number } => {
    const cell = session.where(digit);
    if (cell < 0) {
      const s = slotOf(digit);
      return { x: s.x, y: s.y, size: TOKEN };
    }
    const inset = (CELL - TOKEN) / 2;
    return { x: at(cell % n) + inset, y: at((cell / n) | 0) + inset, size: TOKEN };
  };

  // --- painting ------------------------------------------------------------
  let held: number | null = null;
  let selected: number | null = null;
  let cursor = 0;

  function paint(): void {
    const j = judge(nine, session.cells);
    for (let d = 1; d <= total; d++) {
      const t = tokens.get(d)!;
      if (d === held) continue;
      const h = homeOf(d);
      t.g.setAttribute('transform', `translate(${h.x.toFixed(2)} ${h.y.toFixed(2)})`);
      t.g.classList.toggle('placed', session.where(d) >= 0);
      t.g.classList.toggle('picked', d === selected);
      t.g.setAttribute('aria-label', session.where(d) >= 0
        ? `Digit ${d}, placed`
        : `Digit ${d}, in the tray`);
    }
    for (let i = 0; i < total; i++) {
      holeEl[i].classList.toggle('cursor', i === cursor && el === document.activeElement);
    }
    for (let r = 0; r < n; r++) {
      rowTargetEl[r].classList.toggle('out', j.goodRows.includes(r));
      rowTargetEl[r].classList.toggle('off', j.badRows.includes(r));
    }
    for (let c = 0; c < n; c++) {
      colTargetEl[c].classList.toggle('out', j.goodCols.includes(c));
      colTargetEl[c].classList.toggle('off', j.badCols.includes(c));
    }
  }

  // --- pointer -------------------------------------------------------------
  /** Board coordinates for a pointer event, through the SVG's own window. */
  const point = (e: PointerEvent): { x: number; y: number } => {
    const box = el.getBoundingClientRect();
    const side = Math.min(box.width / (W + 6), box.height / (H + 6));
    const ox = box.left + (box.width - side * (W + 6)) / 2 + side * 3;
    const oy = box.top + (box.height - side * (H + 6)) / 2 + side * 3;
    return { x: (e.clientX - ox) / side, y: (e.clientY - oy) / side };
  };

  /** Which cell a board point is in, or -1. Generous: the gap counts too. */
  const cellAt = (p: { x: number; y: number }): number => {
    if (p.y > span + 4) return -1;
    const k = (v: number): number => {
      for (let i = 0; i < n; i++) {
        const lo = at(i) - GAP / 2;
        const hi = at(i) + CELL + GAP / 2;
        if (v >= lo && v < hi) return i;
      }
      return -1;
    };
    const c = k(p.x);
    const r = k(p.y);
    return c < 0 || r < 0 ? -1 : r * n + c;
  };

  let moved = false;
  let grabbed = { x: 0, y: 0 };
  let pointerId = -1;

  const lift = (digit: number, p: { x: number; y: number }): void => {
    held = digit;
    moved = false;
    const h = homeOf(digit);
    grabbed = { x: p.x - h.x, y: p.y - h.y };
    const t = tokens.get(digit)!;
    t.g.classList.add('held');
    gTokens.appendChild(t.g); // held tokens draw over the rest
  };

  const drag = (p: { x: number; y: number }): void => {
    if (held === null) return;
    const t = tokens.get(held)!;
    t.g.setAttribute('transform', `translate(${(p.x - grabbed.x).toFixed(2)} ${(p.y - grabbed.y).toFixed(2)})`);
    const over = cellAt(p);
    for (let i = 0; i < total; i++) holeEl[i].classList.toggle('over', i === over);
  };

  const drop = (p: { x: number; y: number }): void => {
    if (held === null) return;
    const digit = held;
    const target = cellAt(p);
    held = null;
    tokens.get(digit)!.g.classList.remove('held');
    for (let i = 0; i < total; i++) holeEl[i].classList.remove('over');

    if (!moved) {
      /*
       * A tap. If a cell was waiting, the digit goes there; otherwise the
       * digit becomes the one that is waiting. Tapping a placed digit takes
       * it off the board, which is the only thing a tap on it could mean.
       */
      const wasOn = session.where(digit);
      if (selected === digit) selected = null;
      else if (wasOn >= 0) { session.lift(wasOn); host.buzz('tick'); }
      else selected = digit;
      settle();
      return;
    }

    if (target >= 0) {
      session.place(target, digit);
      cursor = target;
      host.buzz('notch');
    } else if (session.where(digit) >= 0) {
      session.lift(session.where(digit));
      host.buzz('tick');
    }
    selected = null;
    settle();
  };

  function settle(): void {
    session.openGesture();
    paint();
    host.changed();
    if (judge(nine, session.cells).solved) host.solved();
  }

  /**
   * Which spare digit is under a board point, or 0.
   *
   * By slot geometry and the model, not by what is drawn there. A token slides
   * to its place over a tenth of a second, and for that tenth of a second the
   * thing under the finger and the thing the board believes is under the
   * finger are different elements — so a press right after a move used to land
   * on the empty hole and do nothing at all. Nothing here asks the DOM what it
   * is showing.
   */
  const trayDigitAt = (p: { x: number; y: number }): number => {
    for (let d = 1; d <= total; d++) {
      if (session.where(d) >= 0) continue;
      const s = slotOf(d);
      const pad = 2;
      if (p.x >= s.x - pad && p.x <= s.x + TOKEN + pad
        && p.y >= s.y - pad && p.y <= s.y + TOKEN + pad) return d;
    }
    return 0;
  };

  const onDown = (e: PointerEvent): void => {
    if (pointerId !== -1) return;
    const p = point(e);
    const cell = cellAt(p);

    if (cell >= 0) {
      pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      cursor = cell;
      const sitting = session.cells[cell];
      if (sitting !== 0) {
        // Pick up what is there. A tap puts it back in the tray; a drag takes
        // it wherever it is going.
        session.openGesture();
        lift(sitting, p);
      } else if (selected !== null) {
        session.openGesture();
        session.place(cell, selected);
        selected = null;
        host.buzz('notch');
        settle();
      } else {
        paint();
      }
      e.preventDefault();
      return;
    }

    const spare = trayDigitAt(p);
    if (spare !== 0) {
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
    if (!moved && Math.hypot(p.x - grabbed.x - h.x, p.y - grabbed.y - h.y) > 1.4) moved = true;
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
  const onKey = (e: KeyboardEvent): void => {
    const step: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -n, ArrowDown: n,
    };
    if (e.key in step) {
      const next = cursor + step[e.key];
      const sameRow = Math.abs(step[e.key]) === 1
        && ((cursor / n) | 0) === ((next / n) | 0);
      if (next >= 0 && next < total && (Math.abs(step[e.key]) === n || sameRow)) cursor = next;
      e.preventDefault();
      paint();
      return;
    }
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= total) {
      session.openGesture();
      session.place(cursor, Number(e.key));
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

  /* What a test may read. In the game's own terms: digits and cells. */
  (window as unknown as { __board?: unknown }).__board = {
    nine,
    cells: () => session.cells.slice(),
    slot: (digit: number) => slotOf(digit),
    cellBox: (cell: number) => ({ x: at(cell % n), y: at((cell / n) | 0), size: CELL }),
    view: { W: W + 6, H: H + 6, ox: -3, oy: -3 },
  };

  return {
    el: board,
    refresh: paint,
    spotlight(focus) {
      const want = new Set(focus.filter((f) => f.startsWith('cell:')).map((f) => Number(f.slice(5))));
      for (let i = 0; i < total; i++) holeEl[i].classList.toggle('lookhere', want.has(i));
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
