/**
 * Shape Up's board.
 *
 * Pick up a shape, then put it wherever it goes — the same two-part move as
 * One to Nine and Hexagony, and for the same reason: on a board of thirty-six
 * cells you are rarely placing one mark, you are placing six of the same kind
 * and then six of the next.
 *
 * This used to open a ring of options around whatever cell you pressed. A ring
 * is a fine menu and it was the wrong idea here. Every mark cost a press, a
 * pause and an aimed second press at a target the size of a thumbnail that had
 * just appeared under the thumb already covering it; the ring had to dodge the
 * edges of the board, so where an option was depended on where you pressed;
 * and filling a row of empties — the commonest thing anybody does — was that
 * whole dance, six times over.
 *
 * A palette costs one press to choose and then one tap per cell, the choice
 * stays where it was put, and a drag paints a whole run of cells. Tapping a
 * cell that already holds the chosen mark takes it off again, so rubbing out
 * is the same gesture as writing and there is no eraser to find.
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
 * A palette chip, and the gap between two of them.
 *
 * Twenty-six board units rather than a number chosen by eye. The narrowest
 * phone still in use gives a board 296 css pixels; the widest board is seven
 * cells and 174 units across, so a unit is 1.70 pixels there and a chip comes
 * to forty-four — the smallest target a thumb can be asked for.
 *
 * And the palette is never allowed to be narrower than that: when six chips
 * want more room than the grid does, THEY set the width of the drawing and the
 * grid is centred inside it (see W below). So the ratio of chip to drawing is
 * at worst 26 in 174 and the forty-four holds on every board, which is
 * precisely what the ring this replaced could not manage.
 */
const CHIP = 26;
const CHIP_GAP = 3;
/** Between the grid and the palette, with the rule halfway. */
const SPLIT = 14;

export function mountShape(root: HTMLElement, session: ShapeSession, host: ViewHost): View {
  const board = session.board;
  const { w, h, shapes } = board;
  const total = w * h;
  /** The marks you can make: one per shape, and one for "known empty". */
  const PICKS = shapes + 1;
  const PAL_W = PICKS * CHIP + (PICKS - 1) * CHIP_GAP;
  const W = Math.max(w * CELL + EDGE * 2, PAL_W);
  const GRID_H = h * CELL + EDGE * 2;
  const PAL_TOP = GRID_H + SPLIT;
  const H = PAL_TOP + CHIP;

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
  const gPal = svg('g', { class: 'shape-palette' });
  el.append(gCells, gClues, gMarks, gPal);

  /* The grid is centred in whatever width the drawing ended up with, so a
     board narrower than its own palette simply gets a wider clue gutter. */
  const x0 = (W - w * CELL) / 2;
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
    else if (clue.side === 'bottom') { cx = x0 + clue.line * CELL + CELL / 2; cy = GRID_H - EDGE / 2; }
    else if (clue.side === 'left') { cx = x0 - EDGE / 2; cy = y0 + clue.line * CELL + CELL / 2; }
    else { cx = x0 + w * CELL + EDGE / 2; cy = y0 + clue.line * CELL + CELL / 2; }

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

  // --- the palette ---------------------------------------------------------
  /*
   * One chip per mark, laid in a row under the board and never anywhere else.
   * A menu that appears where you pressed makes the player look for it every
   * time; a palette that is always in the same place is one the hand learns in
   * a couple of moves and then stops looking at.
   *
   * "Known empty" is a chip like any other rather than a special case. It is
   * the mark a player makes most, and on the ring it was the one option you
   * could not slide to, because it sat where the finger already was.
   */
  let picked = 1;

  const chipX = (pick: number): number => (W - PAL_W) / 2 + pick * (CHIP + CHIP_GAP);

  el.insertBefore(svg('line', {
    class: 'shape-rule', x1: (W - PAL_W) / 2, x2: (W + PAL_W) / 2,
    y1: GRID_H + SPLIT / 2, y2: GRID_H + SPLIT / 2,
  }), gPal);

  const chipEl: SVGGElement[] = [];
  for (let k = 0; k < PICKS; k++) {
    /* Shapes first, in the order the clues name them, and the empty mark last:
       it is a note about the answer rather than part of it. */
    const pick = k < shapes ? k + 1 : 0;
    const x = chipX(k) + CHIP / 2;
    const y = PAL_TOP + CHIP / 2;
    const g = svg('g', {
      class: 'shape-chip', 'data-pick': pick, role: 'button', tabindex: -1,
      'aria-label': pick === 0 ? 'Mark a cell empty' : `Shape ${pick}`,
    });
    g.appendChild(svg('rect', {
      class: 'shape-chipbg', x: chipX(k), y: PAL_TOP, width: CHIP, height: CHIP, rx: 3,
    }));
    if (pick === 0) {
      g.appendChild(svg('circle', { class: 'shape-blank', cx: x, cy: y, r: 1.9 }));
    } else {
      g.appendChild(svg('path', {
        class: `shape-glyph s${pick}`, d: glyphPath(pick, CHIP * 0.28),
        transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
      }));
    }
    gPal.appendChild(g);
    chipEl.push(g);
  }

  /** Which chip a board point is over, or -1. The gap counts, so nothing between
      two chips is dead. */
  const chipAt = (p: { x: number; y: number }): number => {
    if (p.y < PAL_TOP - CHIP_GAP || p.y > PAL_TOP + CHIP + CHIP_GAP) return -1;
    for (let k = 0; k < PICKS; k++) {
      const x = chipX(k);
      if (p.x >= x - CHIP_GAP / 2 && p.x <= x + CHIP + CHIP_GAP / 2) {
        return k < shapes ? k + 1 : 0;
      }
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
      holeEl[i].classList.toggle('cursor', i === cursor && el === document.activeElement);
    }
    board.clues.forEach((_, i) => {
      clueEl[i].classList.toggle('off', j.badClues.includes(i));
      clueEl[i].classList.toggle('out', j.goodClues.includes(i));
    });
    chipEl.forEach((g) => {
      g.classList.toggle('on', Number(g.getAttribute('data-pick')) === picked);
    });
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
  /*
   * What a drag is doing, decided by the cell it starts on and then held for
   * the whole sweep. A drag that changed its mind halfway — writing over an
   * empty cell and rubbing out the next one that already had the mark — would
   * be a gesture whose result depended on what it happened to pass over.
   */
  let painting = 0;
  let lastCell = -1;

  const put = (cell: number, value: number): void => {
    if (session.cells[cell] === value) return;
    session.openGesture();
    session.set(cell, value);
    host.buzz(value < 0 ? 'tick' : 'notch');
    settle();
  };

  /** Write the chosen mark here, or take it off if it is already here. */
  const stroke = (cell: number): void => {
    if (cell === lastCell) return;
    lastCell = cell;
    put(cell, painting === 1 ? picked : -1);
  };

  const onDown = (e: PointerEvent): void => {
    if (pointerId !== -1) return;
    const p = point(e);

    const chip = chipAt(p);
    if (chip >= 0) {
      picked = chip;
      host.buzz('tick');
      paint();
      e.preventDefault();
      return;
    }

    const cell = cellAt(p);
    if (cell < 0) return;
    pointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    cursor = cell;
    /* Rubbing out is the same gesture as writing: the cell that starts the
       drag says which of the two the whole drag is. */
    painting = session.cells[cell] === picked ? 0 : 1;
    lastCell = -1;
    stroke(cell);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const cell = cellAt(point(e));
    if (cell >= 0) { cursor = cell; stroke(cell); }
    e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    lastCell = -1;
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

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
    /* A digit chooses the mark AND makes it, so the keyboard is one keystroke
       per cell like the palette is one tap. */
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= shapes) {
      picked = Number(e.key);
      put(cursor, picked);
      e.preventDefault();
      return;
    }
    if (e.key === '0') { picked = 0; put(cursor, 0); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === ' ') { put(cursor, picked); e.preventDefault(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { put(cursor, -1); e.preventDefault(); }
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('focus', paint);
  el.addEventListener('blur', paint);

  paint();

  (window as unknown as { __board?: unknown }).__board = {
    shape: board,
    cells: () => session.cells.slice(),
    cellBox: (cell: number) => ({ x: cellX(cell), y: cellY(cell), size: CELL }),
    /* Where a palette chip sits, read rather than recomputed, so a harness
       cannot drift from the thing a thumb actually hits. */
    chipBox: (pick: number) => {
      const k = pick === 0 ? shapes : pick - 1;
      return { x: chipX(k), y: PAL_TOP, size: CHIP };
    },
    picked: () => picked,
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
