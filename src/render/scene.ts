/**
 * The board's scene graph. Built ONCE per level; after that only attributes
 * are mutated.
 *
 * The prototype called board.innerHTML = buildSvgString() on every pointer
 * move. That destroys and recreates every node, so CSS animations restart from
 * frame 0, filter references re-resolve, and elements visibly flicker. It was
 * never a styling problem — it was an architecture problem. There is no
 * innerHTML anywhere in this file's update path.
 */

import type { Pt } from '../core/geometry.js';
import { type Level, isPortalEdge, portalTwin } from '../core/level.js';
import type { PlayState } from '../core/rules.js';
import { pegPos } from '../core/rules.js';
import { GRID, type Raster } from '../core/region.js';
import { type Theme, type Skin, blendColors } from './theme.js';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, String(attrs[k]));
  return node;
}

export type SceneOpts = {
  theme: Theme;
  skin: Skin;
  /** Fog levels hide the target until a loop has been closed. */
  showTarget: boolean;
};

/** A path `d` builder that reuses one array, so update() allocates almost nothing. */
class PathBuf {
  private parts: string[] = [];
  private n = 0;
  reset(): void {
    this.n = 0;
  }
  moveTo(p: Pt): void {
    this.parts[this.n++] = `M${round(p[0])} ${round(p[1])}`;
  }
  lineTo(p: Pt): void {
    this.parts[this.n++] = `L${round(p[0])} ${round(p[1])}`;
  }
  close(): void {
    this.parts[this.n++] = 'Z';
  }
  build(): string {
    return this.parts.slice(0, this.n).join('');
  }
  get empty(): boolean {
    return this.n === 0;
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export class BoardScene {
  readonly svg: SVGSVGElement;
  private level!: Level;
  private opts!: SceneOpts;

  // Persistent node references. Nothing here is ever recreated mid-level.
  private pegGroup!: SVGGElement;
  pegNodes: SVGGElement[] = [];
  private pegDots: SVGCircleElement[] = [];
  private pegHalos: SVGCircleElement[] = [];
  postNodes: SVGCircleElement[] = [];
  private railNodes: SVGLineElement[] = [];
  threadPath: SVGPathElement[] = [];
  threadUnder: SVGPathElement[] = [];
  threadFill: SVGPathElement[] = [];
  private portalGhost: SVGPathElement[] = [];
  private targetFill: SVGPathElement[] = [];
  private cursorLine!: SVGLineElement;
  private layers: Record<string, SVGGElement> = {};

  private buf = new PathBuf();
  private fillBuf = new PathBuf();
  private ghostBuf = new PathBuf();

  /** Pointer position in board space while dragging, or null. */
  cursor: Pt | null = null;
  /** 0..1 opacity of the live region fill — tweened, never set directly. */
  fillOpacity = 0;
  /** 0..1 per-peg pop scale, tweened on contact. */
  private pegPop: Float32Array = new Float32Array(0);

  constructor(private root: HTMLElement) {
    this.svg = el('svg', {
      viewBox: '0 0 100 100',
      class: 'board-svg',
      preserveAspectRatio: 'xMidYMid meet',
      'aria-label': 'Pegboard',
      role: 'application',
    });
    this.root.appendChild(this.svg);
  }

  /**
   * Build the whole scene for a level. The ONLY place nodes are created.
   * Called on level change and never again.
   */
  mount(level: Level, opts: SceneOpts): void {
    this.level = level;
    this.opts = opts;
    // Tear down the previous level's nodes wholesale — this is a level change,
    // not a frame, so replacing the tree here is correct and happens once.
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.pegNodes = [];
    this.pegDots = [];
    this.pegHalos = [];
    this.postNodes = [];
    this.railNodes = [];
    this.threadPath = [];
    this.threadUnder = [];
    this.threadFill = [];
    this.portalGhost = [];
    this.targetFill = [];
    this.pegPop = new Float32Array(level.pegs.length);

    for (const name of ['target', 'rails', 'fills', 'posts', 'ghost', 'threads', 'cursor', 'pegs']) {
      const g = el('g', { class: `layer-${name}` });
      this.layers[name] = g;
      this.svg.appendChild(g);
    }

    // --- target ghost -------------------------------------------------------
    for (let t = 0; t < level.threads.length; t++) {
      const p = el('path', {
        'fill-rule': 'evenodd',
        fill: opts.theme.target,
        'fill-opacity': opts.showTarget ? 0.13 : 0,
        stroke: opts.theme.target,
        'stroke-opacity': opts.showTarget ? 0.5 : 0,
        'stroke-width': 0.45,
        'stroke-dasharray': '1.8 1.4',
        'stroke-linejoin': 'round',
        class: 'target-ghost',
      });
      this.targetFill.push(p);
      this.layers.target.appendChild(p);
    }

    // --- rails --------------------------------------------------------------
    for (const rail of level.rails ?? []) {
      const line = el('line', {
        x1: rail.a[0], y1: rail.a[1], x2: rail.b[0], y2: rail.b[1],
        stroke: opts.theme.peg, 'stroke-width': 0.8, 'stroke-linecap': 'round',
        'stroke-dasharray': '1 1.2', class: 'rail',
      });
      this.railNodes.push(line);
      this.layers.rails.appendChild(line);
    }

    // --- posts --------------------------------------------------------------
    for (const [x, y, r] of level.posts ?? []) {
      const c = el('circle', {
        cx: x, cy: y, r,
        fill: opts.theme.peg, 'fill-opacity': 0.85,
        stroke: opts.theme.pegLive, 'stroke-opacity': 0.25, 'stroke-width': 0.4,
        class: 'post',
      });
      this.postNodes.push(c);
      this.layers.posts.appendChild(c);
    }

    // --- threads ------------------------------------------------------------
    for (let t = 0; t < level.threads.length; t++) {
      const color = level.threads[t].color || opts.theme.thread;
      const fill = el('path', {
        'fill-rule': 'evenodd',
        fill: color,
        'fill-opacity': 0,
        stroke: 'none',
        class: 'thread-fill',
      });
      this.threadFill.push(fill);
      this.layers.fills.appendChild(fill);

      const ghost = el('path', {
        fill: 'none', stroke: color, 'stroke-opacity': 0.35,
        'stroke-width': 0.4, 'stroke-dasharray': '1 1',
        class: 'portal-ghost',
      });
      this.portalGhost.push(ghost);
      this.layers.ghost.appendChild(ghost);

      if (opts.skin.under) {
        const under = el('path', {
          fill: 'none', stroke: opts.skin.under,
          'stroke-width': 1.5 * opts.skin.weight, 'stroke-linecap': opts.skin.cap,
          'stroke-linejoin': 'round', class: 'thread-under',
        });
        this.threadUnder.push(under);
        this.layers.threads.appendChild(under);
      } else {
        this.threadUnder.push(null as unknown as SVGPathElement);
      }

      const path = el('path', {
        fill: 'none', stroke: color,
        'stroke-width': 0.95 * opts.skin.weight,
        'stroke-linecap': opts.skin.cap,
        'stroke-linejoin': 'round',
        class: 'thread-path',
      });
      if (opts.skin.dash) path.setAttribute('stroke-dasharray', opts.skin.dash);
      this.threadPath.push(path);
      this.layers.threads.appendChild(path);
    }

    // --- the rubber band to the pointer -------------------------------------
    this.cursorLine = el('line', {
      stroke: level.threads[0].color || opts.theme.thread,
      'stroke-width': 0.6, 'stroke-opacity': 0, 'stroke-linecap': 'round',
      'stroke-dasharray': '1.4 1.2', class: 'cursor-line',
    });
    this.layers.cursor.appendChild(this.cursorLine);

    // --- pegs ---------------------------------------------------------------
    this.pegGroup = this.layers.pegs;
    for (let i = 0; i < level.pegs.length; i++) {
      const [x, y] = level.pegs[i];
      const g = el('g', { class: 'peg', transform: `translate(${x} ${y})` });
      // The halo is the touch target. Its radius is set from the viewport by
      // setHitRadius so it is always at least 44 CSS pixels across.
      const halo = el('circle', { r: 3.4, fill: 'transparent', class: 'peg-halo' });
      const dot = el('circle', { r: 1.5, fill: opts.theme.peg, class: 'peg-dot' });
      g.append(halo, dot);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `Peg ${i + 1}`);
      g.dataset.peg = String(i);

      if (level.gold?.includes(i)) {
        g.appendChild(el('circle', { r: 2.5, fill: 'none', stroke: '#C8A020', 'stroke-width': 0.5, class: 'peg-gold' }));
        dot.setAttribute('fill', '#C8A020');
      }
      if (level.thorn?.includes(i)) {
        const spikes = el('path', {
          d: thornPath(2.6), fill: 'none', stroke: '#C0392B',
          'stroke-width': 0.45, 'stroke-linecap': 'round', class: 'peg-thorn',
        });
        g.appendChild(spikes);
        dot.setAttribute('fill', '#C0392B');
      }
      const twin = portalTwin(level, i);
      if (twin >= 0) {
        const pairIndex = (level.portals ?? []).findIndex(([a, b]) => a === i || b === i);
        const hue = ['#1F8A8A', '#7A4FBF', '#D98324'][pairIndex % 3];
        g.appendChild(el('circle', { r: 2.6, fill: 'none', stroke: hue, 'stroke-width': 0.5, 'stroke-dasharray': '0.9 0.7', class: 'peg-portal' }));
        dot.setAttribute('fill', hue);
      }

      this.pegNodes.push(g);
      this.pegDots.push(dot);
      this.pegHalos.push(halo);
      this.pegGroup.appendChild(g);
    }

    this.setTarget(level);
    this.fillOpacity = 0;
  }

  /** Draw the derived target region. Called on mount and when fog lifts. */
  setTarget(level: Level, loops?: Pt[][]): void {
    const shown = loops ?? [];
    for (let t = 0; t < this.targetFill.length; t++) {
      const pts = shown[t];
      if (!pts || pts.length < 3) continue;
      this.buf.reset();
      this.buf.moveTo(pts[0]);
      for (let i = 1; i < pts.length; i++) this.buf.lineTo(pts[i]);
      this.buf.close();
      this.targetFill[t].setAttribute('d', this.buf.build());
    }
    void level;
  }

  setTargetVisible(v: number): void {
    for (const p of this.targetFill) {
      p.setAttribute('fill-opacity', String(0.13 * v));
      p.setAttribute('stroke-opacity', String(0.5 * v));
    }
  }

  /**
   * Mutate attributes to match the state. This is the whole play-loop render
   * path: no node is created, removed or replaced.
   */
  update(state: PlayState): void {
    const level = this.level;
    for (let t = 0; t < level.threads.length; t++) {
      const st = state.threads[t];
      const pegs = st.pegs;
      this.buf.reset();
      this.fillBuf.reset();
      this.ghostBuf.reset();

      if (pegs.length > 0) {
        const first = pegPos(level, state, pegs[0]);
        this.fillBuf.moveTo(first);
        this.buf.moveTo(first);
        let penDown = true;
        for (let i = 1; i < pegs.length; i++) {
          const prev = pegs[i - 1];
          const cur = pegs[i];
          const p = pegPos(level, state, cur);
          this.fillBuf.lineTo(p);
          if (isPortalEdge(level, prev, cur)) {
            // The hop is a real edge of the region but is drawn as a ghost.
            this.ghostBuf.moveTo(pegPos(level, state, prev));
            this.ghostBuf.lineTo(p);
            this.buf.moveTo(p);
            penDown = true;
          } else {
            if (!penDown) this.buf.moveTo(pegPos(level, state, prev));
            this.buf.lineTo(p);
            penDown = true;
          }
        }
        if (st.closed && pegs.length >= 3) {
          const last = pegs[pegs.length - 1];
          const firstPeg = pegs[0];
          if (isPortalEdge(level, last, firstPeg)) {
            this.ghostBuf.moveTo(pegPos(level, state, last));
            this.ghostBuf.lineTo(first);
          } else {
            this.buf.lineTo(first);
          }
          this.fillBuf.close();
        }
      }

      setD(this.threadPath[t], this.buf.build());
      if (this.threadUnder[t]) setD(this.threadUnder[t], this.buf.build());
      setD(this.portalGhost[t], this.ghostBuf.build());
      const fillPath = this.threadFill[t];
      setD(fillPath, st.closed && pegs.length >= 3 ? this.fillBuf.build() : '');
      fillPath.setAttribute('fill-opacity', String(st.closed ? 0.22 * this.fillOpacity : 0));
    }

    // Rubber band from the loose end to the pointer.
    const active = state.threads[state.active];
    if (this.cursor && active && active.pegs.length > 0 && !active.closed) {
      const from = pegPos(level, state, active.pegs[active.pegs.length - 1]);
      this.cursorLine.setAttribute('x1', String(round(from[0])));
      this.cursorLine.setAttribute('y1', String(round(from[1])));
      this.cursorLine.setAttribute('x2', String(round(this.cursor[0])));
      this.cursorLine.setAttribute('y2', String(round(this.cursor[1])));
      this.cursorLine.setAttribute('stroke-opacity', '0.45');
    } else {
      this.cursorLine.setAttribute('stroke-opacity', '0');
    }

    // Peg states.
    const onLoop = new Set<number>();
    for (const th of state.threads) for (const p of th.pegs) onLoop.add(p);
    const loose = active && !active.closed && active.pegs.length
      ? active.pegs[active.pegs.length - 1]
      : -1;

    for (let i = 0; i < this.pegNodes.length; i++) {
      const dot = this.pegDots[i];
      const pop = this.pegPop[i];
      const base = onLoop.has(i) ? 2.0 : 1.5;
      dot.setAttribute('r', String(round(base + pop * 1.2)));
      if (i === loose) {
        dot.setAttribute('fill-opacity', '1');
        this.pegNodes[i].setAttribute('data-live', '1');
      } else {
        this.pegNodes[i].removeAttribute('data-live');
        dot.setAttribute('fill-opacity', onLoop.has(i) ? '1' : '0.75');
      }
      if (!this.level.gold?.includes(i) && !this.level.thorn?.includes(i) && portalTwin(this.level, i) < 0) {
        dot.setAttribute('fill', onLoop.has(i) ? this.opts.theme.pegLive : this.opts.theme.peg);
      }
      // Rail pegs may have been slid.
      const p = pegPos(level, state, i);
      this.pegNodes[i].setAttribute('transform', `translate(${round(p[0])} ${round(p[1])})`);
    }
  }

  /** Called by the tween engine; never set directly. */
  setPegPop(i: number, v: number): void {
    if (i >= 0 && i < this.pegPop.length) this.pegPop[i] = v;
  }

  /**
   * Touch targets must be at least 44 CSS pixels, so the halo radius scales
   * with the viewport rather than with the peg's drawn radius.
   */
  setHitRadius(boardPixelSize: number): number {
    const unitsPerPixel = 100 / Math.max(boardPixelSize, 1);
    const r = Math.max(3.0, 22 * unitsPerPixel);
    for (const h of this.pegHalos) h.setAttribute('r', String(round(r)));
    return r;
  }

  /** Which peg is nearest to a board-space point, within the hit radius. */
  pegAt(p: Pt, radius: number, state: PlayState): number {
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < this.level.pegs.length; i++) {
      const q = pegPos(this.level, state, i);
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Blend colour for the legend when two thread regions overlap. */
  blendOf(indices: number[]): string {
    return blendColors(indices.map((i) => this.level.threads[i].color));
  }

  destroy(): void {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.pegNodes = [];
  }
}

/** Only touch the DOM when the value actually changed. */
function setD(node: SVGPathElement | null, d: string): void {
  if (!node) return;
  if (node.getAttribute('d') !== d) node.setAttribute('d', d);
}

function thornPath(r: number): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    d += `M${round(Math.cos(a) * r * 0.45)} ${round(Math.sin(a) * r * 0.45)}`;
    d += `L${round(Math.cos(a) * r)} ${round(Math.sin(a) * r)}`;
  }
  return d;
}

/** Raster helper for the near-miss flood: cell index -> board rect. */
export function cellRect(i: number): [number, number, number, number] {
  const cell = 100 / GRID;
  const x = (i % GRID) * cell;
  const y = Math.floor(i / GRID) * cell;
  return [x, y, cell, cell];
}

export function rasterBounds(r: Raster): [number, number, number, number] | null {
  let minX = GRID, minY = GRID, maxX = -1, maxY = -1;
  for (let i = 0; i < r.length; i++) {
    if (!r[i]) continue;
    const x = i % GRID;
    const y = (i / GRID) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  const cell = 100 / GRID;
  return [minX * cell, minY * cell, (maxX - minX + 1) * cell, (maxY - minY + 1) * cell];
}
