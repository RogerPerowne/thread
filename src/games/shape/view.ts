/**
 * Shape Up's board.
 *
 * Pick up a shape, then put it where it goes — the same two-part move as One
 * to Nine and Hexagony, and for the same reason: on a board of thirty-six
 * cells you are rarely placing one mark, you are placing six of the same kind
 * and then six of the next. A palette costs one press to choose and then one
 * tap per cell, the choice stays where it was put, and tapping a cell that
 * already holds the chosen mark takes it off again, so rubbing out is the same
 * gesture as writing and there is no eraser to find.
 *
 * ONE MARK PER GESTURE. This used to paint: a drag across the grid wrote the
 * chosen mark into every cell it crossed, which sounds efficient and plays as
 * a board that fills itself in whenever a thumb rests on it to look. A finger
 * moving over a puzzle is nearly always a finger THINKING, and a board that
 * cannot tell thinking from writing is one you hold your hand away from. So a
 * gesture puts down exactly one mark, where it ends:
 *
 *   - tap a chip, then tap a cell: the mark goes in that cell;
 *   - press a chip and drag onto the grid: the mark is carried under the
 *     finger and goes in the cell it is let go over, and nowhere on the way;
 *   - press a mark already on the grid and drag: it is picked up and moved
 *     to wherever it is dropped, or off the grid to take it away.
 *
 * Nobody is asked which of those they are doing. A press that moves is a
 * drag, a press that does not is a tap, and that is the entire rule — the one
 * Nine and Hexagony already play by.
 *
 * THE CLUES SAY WHAT THEY MEAN. A clue is "looking in along this line, the
 * first shape you meet is a square" or "the second one is a triangle", and it
 * used to be drawn as the shape with one or two pips under it, which nobody
 * reads as a count. Now it is drawn along its own line of sight: the count as
 * a numeral, then the shape, then a chevron pointing into the grid — "2 ▲ ›"
 * — and tapping any clue lights its line up in the order it reads and puts
 * the clue into words on the note. A rule that can be asked is a rule that
 * gets learnt.
 *
 * And the board answers. A line that takes its last shape lights up and stays
 * lit, the clues it satisfies tick off, and when the last of the mark in your
 * hand goes down the palette hands you the next one. None of that is decided
 * by the view: they are all facts the model already knows, drawn.
 */

import { svg } from '../../platform/dom.js';
import { judge, sightLine, rowCells, colCells, clueText } from './model.js';
import { GLYPHS, glyphPath, glyphName } from './glyphs.js';
import type { ShapeSession } from './session.js';
import type { View, ViewHost } from '../../platform/types.js';

/*
 * Board units, and every one of them is a ratio of the cell rather than a
 * number chosen by eye.
 *
 * A mark fills a bit over half its cell — big enough to tell a triangle from a
 * diamond at the size a seven-wide board gets on a phone, small enough that a
 * row of them does not read as a solid bar. A clue is smaller again, because
 * it is a caption and not a move.
 */
const CELL = 20;
/** The clue gutter round the grid: room for a numeral, a shape and a chevron. */
const EDGE = 19;
/** A mark inside a cell. */
const MARK_R = CELL * 0.29;
/** A shape drawn as a clue, in the gutter. */
const CLUE_R = 4.4;
/**
 * A palette chip, and the gap between two of them.
 *
 * Twenty-six board units rather than a number chosen by eye. The narrowest
 * phone still in use gives a board 296 css pixels; the widest board is seven
 * cells and 178 units across, so a unit is 1.66 pixels there and a chip comes
 * to forty-three — the smallest target a thumb can be asked for.
 *
 * And the palette is never allowed to be narrower than that: when six chips
 * want more room than the grid does, THEY set the width of the drawing and the
 * grid is centred inside it (see W below). So the ratio of chip to drawing is
 * at worst 26 in 178 and the forty-three holds on every board.
 */
const CHIP = 26;
const CHIP_GAP = 3;
/** Between the grid and the palette, with the rule halfway. */
const SPLIT = 14;
/** How far a press has to travel, in board units, before it is a drag. */
const DRAG = CELL * 0.45;

const NAMES = [1, 2, 3, 4, 5].map((n) => glyphName(n));

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
  wrap.className = 'gameboard shape-board';
  wrap.style.setProperty('--board-ratio', String(W / H));

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
  /* The mark under the finger while one is being carried. Last, so it is over
     everything, and empty whenever nothing is being dragged. */
  const gCarry = svg('g', { class: 'shape-carry' });
  el.append(gCells, gClues, gMarks, gPal, gCarry);

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

  /** The empty mark: a small cross, "nothing goes here", never a dot. */
  const blankPath = (r: number): string =>
    `M ${-r} ${-r} L ${r} ${r} M ${r} ${-r} L ${-r} ${r}`;
  const blank = (cx: number, cy: number, r: number): SVGElement => svg('path', {
    class: 'shape-blank', d: blankPath(r),
    transform: `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`,
  });

  // --- the clues -----------------------------------------------------------
  /*
   * A clue sits in the gutter and is laid out ALONG its own line of sight:
   * the count furthest out, the shape in the middle, a chevron nearest the
   * grid pointing in. Read towards the grid it says "second, triangle, this
   * way" — which is the clue. The count is a numeral because it is a count,
   * and a count should look like one.
   *
   * Two groups per clue and not one. The outer one carries the translation
   * and rotation into the gutter and never moves again; the inner one holds
   * the ink and is the only thing that ever gets a scale. Animating the outer
   * group instead would compose a scale with that translation and throw the
   * clue across the board, and no transform-origin can undo it, because the
   * origin it needs is inside a box the translation has already moved.
   *
   * The whole clue is a target. A press on it lights its line up in reading
   * order and says the clue in words, because a clue you can ask is a clue
   * you can learn to read.
   */
  const clueEl: SVGGElement[] = [];
  board.clues.forEach((clue, k) => {
    const g = svg('g', {
      class: 'shape-clue', role: 'button', tabindex: -1,
      'aria-label': clueText(clue, NAMES),
      'data-clue': k,
    });
    const ink = svg('g', { class: 'shape-clueink' });
    let cx = 0;
    let cy = 0;
    /* The gutter axis points INTO the grid. Everything in the inner group is
       drawn for a clue on the left, reading left to right, and turned. */
    let turn = 0;
    if (clue.side === 'top') { cx = x0 + clue.line * CELL + CELL / 2; cy = EDGE / 2; turn = 90; }
    else if (clue.side === 'bottom') { cx = x0 + clue.line * CELL + CELL / 2; cy = GRID_H - EDGE / 2; turn = -90; }
    else if (clue.side === 'left') { cx = x0 - EDGE / 2; cy = y0 + clue.line * CELL + CELL / 2; }
    else { cx = x0 + w * CELL + EDGE / 2; cy = y0 + clue.line * CELL + CELL / 2; turn = 180; }

    g.setAttribute('transform', `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${turn})`);
    /* A bed under the whole clue, so the press target is the gutter cell
       rather than the ink, which is thin. */
    ink.appendChild(svg('rect', {
      class: 'shape-cluebed', x: -EDGE / 2, y: -CELL / 2, width: EDGE, height: CELL, rx: 2,
    }));
    /* The count, outermost. Upright whatever way the clue is turned: a "2"
       lying on its side is a thing you have to think about. */
    ink.appendChild(svg('text', {
      class: 'shape-count', x: -EDGE / 2 + 3.1, y: 0,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      transform: `rotate(${-turn} ${(-EDGE / 2 + 3.1).toFixed(2)} 0)`,
      text: String(clue.depth),
    }));
    /* The shape, turned back upright for the same reason as the count: a
       triangle on its side is not the triangle in the palette. */
    ink.appendChild(svg('path', {
      class: `shape-glyph s${clue.shape}`, d: glyphPath(clue.shape, CLUE_R),
      transform: `translate(1.1 0) rotate(${-turn})`,
    }));
    /* The chevron, pointing into the grid. */
    ink.appendChild(svg('path', {
      class: 'shape-chev',
      d: `M ${EDGE / 2 - 3.4} -2.1 L ${EDGE / 2 - 1.6} 0 L ${EDGE / 2 - 3.4} 2.1`,
    }));
    g.appendChild(ink);
    gClues.appendChild(g);
    clueEl.push(g);
  });

  /** Which clue a board point is on, or -1. */
  const clueAt = (p: { x: number; y: number }): number => {
    for (let k = 0; k < board.clues.length; k++) {
      const clue = board.clues[k];
      let x = 0;
      let y = 0;
      let bw = EDGE;
      let bh = CELL;
      if (clue.side === 'top') { x = x0 + clue.line * CELL; y = 0; bw = CELL; bh = EDGE; }
      else if (clue.side === 'bottom') { x = x0 + clue.line * CELL; y = GRID_H - EDGE; bw = CELL; bh = EDGE; }
      else if (clue.side === 'left') { x = x0 - EDGE; y = y0 + clue.line * CELL; }
      else { x = x0 + w * CELL; y = y0 + clue.line * CELL; }
      if (p.x >= x && p.x <= x + bw && p.y >= y && p.y <= y + bh) return k;
    }
    return -1;
  };

  /**
   * Read a clue out: its line lights up cell by cell in the order the clue
   * looks along it, and the words go on the note.
   */
  function readClue(k: number): void {
    const clue = board.clues[k];
    const line = sightLine(board, clue.side, clue.line);
    for (let i = 0; i < total; i++) {
      holeEl[i].classList.remove('read');
      holeEl[i].style.removeProperty('--i');
    }
    line.forEach((i, n) => {
      holeEl[i].style.setProperty('--i', String(n));
      /* Reading a layout property restarts the animation rather than letting
         the removal and the addition collapse into one frame with no change. */
      void holeEl[i].getBoundingClientRect();
      holeEl[i].classList.add('read');
    });
    const ink = clueEl[k].firstElementChild;
    if (ink) flash(ink, 'ding', 420);
    host.buzz('tick');
    host.say(`${clueText(clue, NAMES)}.`);
  }

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
      'aria-label': pick === 0 ? 'Mark a cell empty' : `Shape ${pick}, the ${NAMES[pick - 1]}`,
    });
    g.appendChild(svg('rect', {
      class: 'shape-chipbg', x: chipX(k), y: PAL_TOP, width: CHIP, height: CHIP, rx: 3,
    }));
    if (pick === 0) {
      g.appendChild(blank(x, y, CHIP * 0.17));
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

  // --- what the board knows about itself -----------------------------------
  /*
   * A line is DONE when it holds one of each shape and no shape twice. That is
   * the rule, not a heuristic: the line is finished at that moment whether or
   * not its gaps have been dotted, so it is finished on the screen too.
   *
   * Done lines are what the board's reward is made of, and they are computed
   * from the cells every paint rather than tracked, so undo, restart and
   * reveal all get the right answer without any of them having to know this
   * exists.
   */
  const lineDone = (idx: readonly number[]): boolean => {
    const count = new Array(shapes + 1).fill(0);
    for (const i of idx) if (session.cells[i] > 0) count[session.cells[i]]++;
    for (let s = 1; s <= shapes; s++) if (count[s] !== 1) return false;
    return true;
  };

  /** Which lines are done, as `r3` / `c5`. */
  function doneNow(): Set<string> {
    const out = new Set<string>();
    for (let r = 0; r < h; r++) if (lineDone(rowCells(board, r))) out.add(`r${r}`);
    for (let c = 0; c < w; c++) if (lineDone(colCells(board, c))) out.add(`c${c}`);
    return out;
  }

  /** The lines that were done last paint, so a NEW one can be told from an old. */
  let wasDone = new Set<string>();
  /** Clues that had come true last paint, for the same reason. */
  let wasGood = new Set<number>();
  const timers = new Set<number>();

  /** Run `cls` as a one-shot animation, from a clean start every time. */
  function flash(node: Element, cls: string, ms: number): void {
    if (node.classList.contains(cls)) {
      /* Still running from last time. Take it off and read the box, which is
         what commits the removal — without that the browser sees no change and
         a line finished twice in quick succession animates once. Only in that
         case: a forced reflow per cell of every line is not free. */
      node.classList.remove(cls);
      void (node as SVGGraphicsElement).getBoundingClientRect();
    }
    node.classList.add(cls);
    const t = window.setTimeout(() => { node.classList.remove(cls); timers.delete(t); }, ms);
    timers.add(t);
  }

  // --- painting ------------------------------------------------------------
  function paint(): void {
    const j = judge(board, session.cells);
    const done = doneNow();

    for (let i = 0; i < total; i++) {
      const v = session.cells[i];
      markEl[i].replaceChildren();
      if (v > 0) {
        markEl[i].appendChild(svg('path', {
          class: `shape-glyph s${v}`, d: glyphPath(v, MARK_R),
          transform: `translate(${cellX(i) + CELL / 2} ${cellY(i) + CELL / 2})`,
        }));
      } else if (v === 0) {
        markEl[i].appendChild(blank(cellX(i) + CELL / 2, cellY(i) + CELL / 2, CELL * 0.11));
      }
      holeEl[i].classList.toggle('cursor', i === cursor && el === document.activeElement);
      /*
       * Settled: this cell sits on a line that is finished. The board fills in
       * behind you as you go, which is the same fact as the meter and a great
       * deal easier to read — and a cell where a finished row crosses a
       * finished column is settled twice over, so it takes the deeper of the
       * two papers and the last cells to change are the ones that were hardest.
       */
      const r = (i / w) | 0;
      const c = i % w;
      const both = done.has(`r${r}`) && done.has(`c${c}`);
      holeEl[i].classList.toggle('settled', both || done.has(`r${r}`) || done.has(`c${c}`));
      holeEl[i].classList.toggle('settled2', both);
    }

    /*
     * A line that has just been finished lights up, once. Counted rather than
     * compared by size: a move can finish one line and break another in the
     * same breath, and that is still a line finished.
     */
    let lit = 0;
    for (const key of done) {
      if (wasDone.has(key)) continue;
      lit++;
      const n = Number(key.slice(1));
      const cells = key[0] === 'r' ? rowCells(board, n) : colCells(board, n);
      for (const i of cells) flash(holeEl[i], 'lit', 620);
    }
    if (lit > 0) host.buzz('tie');
    wasDone = done;

    const good = new Set(j.goodClues);
    board.clues.forEach((_, i) => {
      clueEl[i].classList.toggle('off', j.badClues.includes(i));
      clueEl[i].classList.toggle('out', good.has(i));
      /* A clue that has just come true ticks off. It is the smallest reward on
         the board and the most frequent one, which is exactly the pair that
         makes a puzzle hard to put down. */
      const ink = clueEl[i].firstElementChild;
      if (ink && good.has(i) && !wasGood.has(i)) flash(ink, 'ding', 420);
    });
    wasGood = good;

    chipEl.forEach((g) => {
      const pick = Number(g.getAttribute('data-pick'));
      g.classList.toggle('on', pick === picked);
      /* A shape with all of itself on the board is spent: there are `h` of
         each, one per row, and no more of them to place. */
      g.classList.toggle('spent', pick > 0 && countOf(pick) >= h);
    });
  }

  /** How many of a shape are on the board. */
  function countOf(pick: number): number {
    let n = 0;
    for (const v of session.cells) if (v === pick) n++;
    return n;
  }

  /**
   * Hand over the next mark once the one in your hand is all placed.
   *
   * Only between gestures, never during one: a drag that changed what it was
   * carrying halfway along would be a gesture whose result depended on how
   * far it happened to get. And only forwards onto a shape that is not
   * finished — it never lands on the blank, which is a note rather than part
   * of the answer and is therefore never "done".
   */
  function handOver(): void {
    if (picked <= 0 || countOf(picked) < h) return;
    for (let k = 1; k <= shapes; k++) {
      const next = ((picked - 1 + k) % shapes) + 1;
      if (countOf(next) < h) { picked = next; host.buzz('tick'); paint(); return; }
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

  /*
   * What the gesture in progress is, decided by where it started and by
   * whether it has moved yet.
   *
   *   carrying   a mark is under the finger, from a chip or lifted off a cell,
   *              and goes down where the finger is let go;
   *   pending    a press on a cell that already holds a mark, which is a tap
   *              (toggle) if the finger lifts here and a lift-and-carry if it
   *              moves away first;
   *   neither    a tap that already happened at the press, or a press on
   *              nothing.
   */
  let carrying = -1;
  /** The cell a carried mark was lifted from, or -1 if it came from a chip. */
  let liftedFrom = -1;
  let pending = -1;
  let pressAt: { x: number; y: number } | null = null;
  /** The cell the carried mark is over, lit so the drop has a visible target. */
  let under = -1;

  const put = (cell: number, value: number): void => {
    if (session.cells[cell] === value) return;
    session.set(cell, value);
    host.buzz(value < 0 ? 'tick' : 'notch');
    settle();
  };

  /**
   * The mark being carried, drawn under the finger.
   *
   * Bigger than the mark in a cell and softened, so what is under the thumb is
   * plainly the thing being carried rather than a mark that has already been
   * put down somewhere odd. Cleared the moment the finger lifts.
   */
  const carry = (p: { x: number; y: number } | null): void => {
    gCarry.replaceChildren();
    const was = under;
    under = p ? cellAt(p) : -1;
    if (was !== under) {
      if (was >= 0) holeEl[was].classList.remove('under');
      if (under >= 0) holeEl[under].classList.add('under');
    }
    if (!p || carrying < 0) return;
    const g = svg('g', { transform: `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})` });
    if (carrying === 0) g.appendChild(blank(0, 0, CELL * 0.14));
    else g.appendChild(svg('path', { class: `shape-glyph s${carrying}`, d: glyphPath(carrying, MARK_R * 1.25) }));
    gCarry.appendChild(g);
  };

  const onDown = (e: PointerEvent): void => {
    if (pointerId !== -1) return;
    const p = point(e);

    const k = clueAt(p);
    if (k >= 0) {
      readClue(k);
      e.preventDefault();
      return;
    }

    /*
     * A press on a chip chooses it, and then keeps the pointer, so the same
     * press can carry the mark onto the board without letting go. Let go over
     * the palette and it was a tap that chose a mark, which is what it always
     * was; carry on onto the grid and it is a drag that drops. One gesture,
     * and nothing had to decide which it was at the start.
     */
    const chip = chipAt(p);
    if (chip >= 0) {
      picked = chip;
      pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      carrying = chip;
      liftedFrom = -1;
      pressAt = p;
      host.buzz('tick');
      paint();
      carry(p);
      e.preventDefault();
      return;
    }

    const cell = cellAt(p);
    if (cell < 0) return;
    pointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    session.openGesture();
    cursor = cell;
    pressAt = p;
    if (session.cells[cell] >= 0) {
      /* A mark is here already. Whether this is a tap on it or the start of
         moving it is not known yet, so nothing changes until it is. */
      pending = cell;
    } else {
      put(cell, picked);
    }
    e.preventDefault();
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const p = point(e);
    const moved = pressAt ? Math.hypot(p.x - pressAt.x, p.y - pressAt.y) : 0;

    if (pending >= 0 && (moved > DRAG || cellAt(p) !== pending)) {
      /* The finger has left with the mark: it is being moved, not tapped. The
         cell it came from is left undecided — a mark in the air is not on the
         board — and it lands wherever the finger stops. */
      carrying = session.cells[pending];
      liftedFrom = pending;
      session.set(pending, -1);
      pending = -1;
      paint();
      host.changed();
    }
    if (carrying >= 0) carry(p);
    e.preventDefault();
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    const p = point(e);

    if (pending >= 0) {
      /* Never left the cell: a tap. The chosen mark goes down, or comes off
         if it is what was there already. */
      const cell = pending;
      pending = -1;
      put(cell, session.cells[cell] === picked ? -1 : picked);
    } else if (carrying >= 0) {
      const cell = cellAt(p);
      const mark = carrying;
      carrying = -1;
      carry(null);
      if (cell >= 0) {
        put(cell, mark);
        /* Dropped back where it was lifted from: nothing happened, and the
           board is exactly as it was, but the paint above already drew it. */
      } else if (liftedFrom >= 0) {
        /* Lifted off the grid and let go off the grid: taken away. That is
           already what the board shows, so only the beat is missing. */
        host.buzz('tick');
        settle();
      }
      liftedFrom = -1;
    }
    pressAt = null;
    carry(null);
    /* Between gestures is the only safe place to change what is in the hand. */
    handOver();
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
      session.openGesture();
      put(cursor, picked);
      handOver();
      e.preventDefault();
      return;
    }
    if (e.key === '0' || e.key === 'x') {
      picked = 0;
      session.openGesture();
      put(cursor, 0);
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      session.openGesture();
      put(cursor, session.cells[cursor] === picked ? -1 : picked);
      handOver();
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      session.openGesture();
      put(cursor, -1);
      e.preventDefault();
    }
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
    /* Where a clue's press target sits, the same way. */
    clueBox: (k: number) => {
      const clue = board.clues[k];
      if (clue.side === 'top') return { x: x0 + clue.line * CELL, y: 0, w: CELL, h: EDGE };
      if (clue.side === 'bottom') return { x: x0 + clue.line * CELL, y: GRID_H - EDGE, w: CELL, h: EDGE };
      if (clue.side === 'left') return { x: x0 - EDGE, y: y0 + clue.line * CELL, w: EDGE, h: CELL };
      return { x: x0 + w * CELL, y: y0 + clue.line * CELL, w: EDGE, h: CELL };
    },
    picked: () => picked,
    /** The rows and columns that already hold one of each shape. */
    done: () => [...doneNow()],
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
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('keydown', onKey);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      wrap.remove();
      delete (window as unknown as { __board?: unknown }).__board;
    },
  };
}

export { GLYPHS };
