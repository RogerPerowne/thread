/**
 * Shape Up's board.
 *
 * A cell holds one of five things, so cycling through them with taps would be
 * five taps to reach the fifth, over and over, on a board of thirty-six. The
 * brief is right that that is the wrong interaction and right about the fix:
 * put the choice under the finger rather than at the edge of the screen.
 *
 * Press a cell and a ring of shapes opens around it. Slide onto one and let
 * go, or let go and tap one — the same gesture works either way, because a
 * player who has never seen a radial menu will lift their finger and a player
 * who has will not, and neither should be wrong. The ring puts every choice
 * the same short distance away, which is the whole point of a ring: no option
 * is further to reach than any other, and the distance does not grow when a
 * sixth shape is added.
 *
 * The one thing that is not on the ring is "empty", because empty is what a
 * cell already is, and it sits in the middle where the finger already is.
 */

import { svg } from '../../platform/dom.js';
import { judge, sightLine } from './model.js';
import { GLYPHS, glyphPath } from './glyphs.js';
import type { ShapeSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/*
 * Board units, and every one of them is a ratio of the cell rather than a
 * number chosen by eye.
 *
 * A mark fills a bit over half its cell — big enough to tell a triangle from a
 * diamond at the size a seven-wide board gets on a phone, small enough that a
 * row of them does not read as a solid bar. A clue is smaller again, because
 * it is a caption and not a move. And the ring's options are spaced so that
 * two of them cannot touch: five of them round a circle of radius RING sit
 * 2 * RING * sin(pi/5) apart, which has to clear their own width.
 */
const CELL = 20;
/** The clue gutter round the grid. */
const EDGE = 17;
/** A mark inside a cell. */
const MARK_R = CELL * 0.29;
/** A shape drawn as a clue, in the gutter. */
const CLUE_R = EDGE * 0.30;
/**
 * The ring is measured in PIXELS, not in board units.
 *
 * Everything else here scales with the board, and it should: a mark belongs to
 * its cell. The ring does not — it is a menu, and a menu has to fit a thumb
 * whatever it happens to be sitting on top of. Sized in board units it came
 * out at thirty-five pixels across on a seven-wide board on the narrowest
 * phone, which is under the forty-four a thumb needs, and it got smaller the
 * bigger the puzzle grew. So its size is worked out at the moment it opens,
 * from the scale the board is actually being drawn at.
 */
const OPT_PX = 46;

export function mountShape(root: HTMLElement, session: ShapeSession, host: ViewHost): View {
  const board = session.board;
  const { w, h, shapes } = board;
  const total = w * h;
  const W = w * CELL + EDGE * 2;
  const H = h * CELL + EDGE * 2;

  const wrap = document.createElement('div');
  wrap.className = 'shape-board';
  wrap.style.setProperty('--shape-ratio', String(W / H));

  const el = svg('svg', {
    class: 'shape-svg',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'application',
    'aria-label': `Shape Up, ${w} by ${h}, ${shapes} shapes`,
    tabindex: 0,
  });
  wrap.appendChild(el);
  root.appendChild(wrap);

  const gCells = svg('g', { class: 'shape-cells' });
  const gMarks = svg('g', { class: 'shape-marks' });
  const gClues = svg('g', { class: 'shape-clues' });
  const gRing = svg('g', { class: 'shape-ring' });
  el.append(gCells, gClues, gMarks, gRing);

  const x0 = EDGE;
  const y0 = EDGE;
  const cellX = (i: number) => x0 + (i % w) * CELL;
  const cellY = (i: number) => y0 + ((i / w) | 0) * CELL;

  const holeEl: SVGRectElement[] = [];
  const markEl: SVGGElement[] = [];
  for (let i = 0; i < total; i++) {
    const hole = svg('rect', {
      class: 'shape-hole', x: cellX(i) + 0.4, y: cellY(i) + 0.4,
      width: CELL - 0.8, height: CELL - 0.8, rx: 2,
    });
    gCells.appendChild(hole);
    holeEl.push(hole);
    const mark = svg('g', { class: 'shape-mark' });
    gMarks.appendChild(mark);
    markEl.push(mark);
  }

  // --- the clues -----------------------------------------------------------
  /*
   * A clue sits in the gutter, pointing in. Its depth is drawn as that many
   * pips beside the shape rather than as a colour, because "the second shape
   * in" is a count and a count should look like one — and because a third or
   * fourth would need a third or fourth colour nobody could name.
   */
  const clueEl: SVGGElement[] = [];
  board.clues.forEach((clue) => {
    const g = svg('g', { class: 'shape-clue' });
    let cx = 0;
    let cy = 0;
    if (clue.side === 'top') { cx = x0 + clue.line * CELL + CELL / 2; cy = EDGE / 2; }
    else if (clue.side === 'bottom') { cx = x0 + clue.line * CELL + CELL / 2; cy = H - EDGE / 2; }
    else if (clue.side === 'left') { cx = EDGE / 2; cy = y0 + clue.line * CELL + CELL / 2; }
    else { cx = W - EDGE / 2; cy = y0 + clue.line * CELL + CELL / 2; }

    g.setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`);
    g.appendChild(svg('path', {
      class: `shape-glyph s${clue.shape}`, d: glyphPath(clue.shape, CLUE_R),
      transform: `translate(0 ${(-CLUE_R * 0.3).toFixed(2)})`,
    }));
    /* The pips: one per shape deep, in a short row under the glyph. */
    for (let k = 0; k < clue.depth; k++) {
      const gap = 2.2;
      const spread = (clue.depth - 1) * gap;
      g.appendChild(svg('circle', {
        class: 'shape-pip', cx: k * gap - spread / 2, cy: CLUE_R + 1.6, r: 0.75,
      }));
    }
    gClues.appendChild(g);
    clueEl.push(g);
  });

  // --- the ring ------------------------------------------------------------
  let openAt = -1;
  let hoverPick = -1;
  /** Worked out afresh every time the ring opens; see OPT_PX. */
  let geom = { cx: 0, cy: 0, optR: 9.5, ring: 22 };

  /**
   * How big the ring is, in board units, for the scale the board is drawn at.
   *
   * The radius follows from the pixel size. The ring's own radius then follows
   * from the radius and from how many options there are: `shapes` circles of
   * radius r round a ring of radius R are 2 R sin(pi/shapes) apart, which has
   * to clear 2r — and the middle option needs its own clearance too, which is
   * the term that wins for three or four shapes.
   */
  const measure = (): { optR: number; ring: number } => {
    const box = el.getBoundingClientRect();
    const px = box.width > 0 ? box.width / W : 1;
    const optR = Math.max(9.5, OPT_PX / 2 / px);
    /*
     * Two things have to clear, and the second is the one that usually wins:
     * neighbours on the ring, and every option against the one in the middle.
     * The middle is drawn at the same size as the rest — it is a choice like
     * any other and a thumb does not care that it means "empty" — so the ring
     * has to be at least two radii out, with a little air.
     */
    const apart = 1 / Math.sin(Math.PI / shapes) + 0.16;
    return { optR, ring: optR * Math.max(2.15, apart) };
  };

  const ringSpot = (k: number): { x: number; y: number } => {
    /* Fanned round the cell, starting at the top and going clockwise. The
       whole ring is nudged back inside the board when it opens on an edge. */
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / shapes;
    return { x: Math.cos(a) * geom.ring, y: Math.sin(a) * geom.ring };
  };

  function closeRing(): void {
    openAt = -1;
    hoverPick = -1;
    gRing.replaceChildren();
    gRing.classList.remove('open');
    paint();
  }

  function openRing(cell: number): void {
    openAt = cell;
    hoverPick = -1;
    gRing.replaceChildren();
    gRing.classList.add('open');

    const { optR, ring } = measure();
    let cx = cellX(cell) + CELL / 2;
    let cy = cellY(cell) + CELL / 2;
    /* Keep the ring on the board: it is a menu, and a menu half off the screen
       is a menu with options nobody can reach. */
    cx = Math.max(ring + optR, Math.min(W - ring - optR, cx));
    cy = Math.max(ring + optR, Math.min(H - ring - optR, cy));
    geom = { cx, cy, optR, ring };

    gRing.appendChild(svg('circle', { class: 'shape-scrim', cx, cy, r: ring + optR + 2 }));
    /* The middle is "empty", where the finger already is. */
    const mid = svg('g', { class: 'shape-opt clear', 'data-pick': 0 });
    mid.append(
      svg('circle', { cx, cy, r: optR, class: 'shape-optbg' }),
      svg('path', {
        class: 'shape-clearmark',
        d: `M ${cx - optR * 0.3} ${cy - optR * 0.3} L ${cx + optR * 0.3} ${cy + optR * 0.3}`
          + ` M ${cx + optR * 0.3} ${cy - optR * 0.3} L ${cx - optR * 0.3} ${cy + optR * 0.3}`,
      }),
    );
    gRing.appendChild(mid);

    for (let s = 1; s <= shapes; s++) {
      const p = ringSpot(s - 1);
      const g = svg('g', { class: 'shape-opt', 'data-pick': s });
      g.append(
        svg('circle', { cx: cx + p.x, cy: cy + p.y, r: optR, class: 'shape-optbg' }),
        svg('path', {
          class: `shape-glyph s${s}`, d: glyphPath(s, optR * 0.6),
          transform: `translate(${(cx + p.x).toFixed(2)} ${(cy + p.y).toFixed(2)})`,
        }),
      );
      gRing.appendChild(g);
    }
    paint();
  }

  /** Which option a board point is over, or -1 for none. 0 is "empty". */
  const optionAt = (p: { x: number; y: number }): number => {
    if (openAt < 0) return -1;
    const dx = p.x - geom.cx;
    const dy = p.y - geom.cy;
    if (Math.hypot(dx, dy) < geom.optR * 1.05) return 0;
    for (let s = 1; s <= shapes; s++) {
      const q = ringSpot(s - 1);
      /* A shade wider than the option is drawn: a finger that lands between
         two of them should get the nearer one rather than nothing. */
      if (Math.hypot(dx - q.x, dy - q.y) < geom.optR * 1.25) return s;
    }
    return -1;
  };

  // --- painting ------------------------------------------------------------
  function paint(): void {
    const j = judge(board, session.cells);
    for (let i = 0; i < total; i++) {
      const v = session.cells[i];
      markEl[i].replaceChildren();
      if (v > 0) {
        markEl[i].appendChild(svg('path', {
          class: `shape-glyph s${v}`, d: glyphPath(v, MARK_R),
          transform: `translate(${cellX(i) + CELL / 2} ${cellY(i) + CELL / 2})`,
        }));
      } else if (v === 0) {
        markEl[i].appendChild(svg('circle', {
          class: 'shape-blank', cx: cellX(i) + CELL / 2, cy: cellY(i) + CELL / 2, r: 1.5,
        }));
      }
      holeEl[i].classList.toggle('open', i === openAt);
      holeEl[i].classList.toggle('cursor', i === cursor && el === document.activeElement);
    }
    board.clues.forEach((_, i) => {
      clueEl[i].classList.toggle('off', j.badClues.includes(i));
      clueEl[i].classList.toggle('out', j.goodClues.includes(i));
    });
    for (const g of gRing.querySelectorAll('.shape-opt')) {
      g.classList.toggle('over', Number(g.getAttribute('data-pick')) === hoverPick);
    }
  }

  function settle(): void {
    session.openGesture();
    paint();
    host.changed();
    if (judge(board, session.cells).solved) host.solved();
  }

  // --- pointer -------------------------------------------------------------
  const point = (e: PointerEvent): { x: number; y: number } => {
    const box = el.getBoundingClientRect();
    const side = Math.min(box.width / W, box.height / H);
    const ox = box.left + (box.width - side * W) / 2;
    const oy = box.top + (box.height - side * H) / 2;
    return { x: (e.clientX - ox) / side, y: (e.clientY - oy) / side };
  };

  const cellAt = (p: { x: number; y: number }): number => {
    const c = Math.floor((p.x - x0) / CELL);
    const r = Math.floor((p.y - y0) / CELL);
    if (c < 0 || r < 0 || c >= w || r >= h) return -1;
    return r * w + c;
  };

  let cursor = 0;
  let pointerId = -1;
  let moved = false;

  const put = (cell: number, value: number): void => {
    session.openGesture();
    session.set(cell, value);
    host.buzz(value === 0 ? 'tick' : 'notch');
    settle();
  };

  const onDown = (e: PointerEvent): void => {
    if (pointerId !== -1) return;
    const p = point(e);
    moved = false;

    if (openAt >= 0) {
      const pick = optionAt(p);
      if (pick >= 0) { put(openAt, pick); closeRing(); }
      else closeRing();
      e.preventDefault();
      return;
    }

    const cell = cellAt(p);
    if (cell < 0) return;
    pointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    cursor = cell;
    openRing(cell);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId || openAt < 0) return;
    const p = point(e);
    const cx = cellX(openAt) + CELL / 2;
    const cy = cellY(openAt) + CELL / 2;
    if (!moved && Math.hypot(p.x - cx, p.y - cy) > 3) moved = true;
    const pick = optionAt(p);
    if (pick !== hoverPick) {
      hoverPick = pick;
      if (pick >= 0) host.buzz('tick');
      paint();
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    if (openAt < 0) return;
    /*
     * A gesture that moved onto an option chose it. One that did not is a
     * press: the ring stays open and waits to be tapped. Nobody is asked
     * which of the two they meant.
     */
    if (!moved) return;
    const pick = optionAt(point(e));
    if (pick >= 0) put(openAt, pick);
    closeRing();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', () => { pointerId = -1; closeRing(); });

  // --- keyboard ------------------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -w, ArrowDown: w };
    if (e.key in step) {
      const next = cursor + step[e.key];
      const sameRow = Math.abs(step[e.key]) === 1 && ((cursor / w) | 0) === ((next / w) | 0);
      if (next >= 0 && next < total && (Math.abs(step[e.key]) === w || sameRow)) cursor = next;
      e.preventDefault();
      paint();
      return;
    }
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= shapes) {
      put(cursor, Number(e.key));
      e.preventDefault();
      return;
    }
    if (e.key === '0' || e.key === ' ') { put(cursor, 0); e.preventDefault(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { put(cursor, -1); e.preventDefault(); return; }
    if (e.key === 'Escape' && openAt >= 0) { closeRing(); e.preventDefault(); }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('focus', paint);
  el.addEventListener('blur', paint);

  paint();

  (window as unknown as { __board?: unknown }).__board = {
    shape: board,
    cells: () => session.cells.slice(),
    cellBox: (cell: number) => ({ x: cellX(cell), y: cellY(cell), size: CELL }),
    /* Where an option sits, once the ring is open, and how big it is drawn.
       Read rather than recomputed, so a harness cannot drift from the menu. */
    ring: () => ({ ...geom }),
    ringSpot: (pick: number) => (pick === 0 ? { x: 0, y: 0 } : ringSpot(pick - 1)),
    measureRing: () => measure(),
    sight: (side: string, line: number) => sightLine(board, side as never, line),
    view: { W, H },
  };

  return {
    el: wrap,
    refresh: paint,
    spotlight(focus) {
      const want = new Set(focus.filter((f) => f.startsWith('cell:')).map((f) => Number(f.slice(5))));
      for (let i = 0; i < total; i++) holeEl[i].classList.toggle('lookhere', want.has(i));
    },
    dispose() {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('keydown', onKey);
      wrap.remove();
      delete (window as unknown as { __board?: unknown }).__board;
    },
  };
}

export { GLYPHS };
