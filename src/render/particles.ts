/**
 * The canvas overlay. It draws exactly two things: particles, and the
 * near-miss flood. Everything else is SVG.
 *
 * Particle storage is pre-allocated typed arrays — the frame loop never
 * allocates. When prefers-reduced-motion is set, no particle is ever emitted.
 */

import { GRID, type Raster } from '../core/region.js';

const MAX = 320;

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;

  // Particle pool.
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private hue = new Uint8Array(MAX * 3);
  private live = 0;

  /** Symmetric-difference flood: the exact region the player got wrong. */
  private diff: Raster | null = null;
  private diffProgress = 0;
  private diffColor = '#C0392B';

  reducedMotion = false;

  constructor(private root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board-canvas';
    this.root.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = cssW;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  /** Board space (0..100) to canvas pixels. */
  private toPx(v: number): number {
    return (v / 100) * this.w * this.dpr;
  }

  /** Emit a small burst at a board-space point. */
  burst(x: number, y: number, color: string, count = 10): void {
    if (this.reducedMotion) return;
    const [r, g, b] = parseHex(color);
    for (let k = 0; k < count && this.live < MAX; k++) {
      const i = this.live++;
      const a = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 16;
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(a) * speed;
      this.vy[i] = Math.sin(a) * speed;
      this.maxLife[i] = 380 + Math.random() * 420;
      this.life[i] = this.maxLife[i];
      this.size[i] = 0.5 + Math.random() * 1.1;
      this.hue[i * 3] = r;
      this.hue[i * 3 + 1] = g;
      this.hue[i * 3 + 2] = b;
    }
  }

  /** A ring of sparks around a closed loop — the one flourish per win. */
  flourish(points: Array<readonly [number, number]>, color: string): void {
    if (this.reducedMotion) return;
    for (const [x, y] of points) this.burst(x, y, color, 6);
  }

  showDifference(diff: Raster, color = '#C0392B'): void {
    this.diff = diff;
    this.diffColor = color;
    this.diffProgress = 0;
  }

  setDifferenceProgress(v: number): void {
    this.diffProgress = v;
    if (v <= 0) this.diff = null;
  }

  clearDifference(): void {
    this.diff = null;
    this.diffProgress = 0;
  }

  /** Advance particles. Called by the ticker, never by a pointer handler. */
  step(dtMs: number): void {
    let n = 0;
    for (let i = 0; i < this.live; i++) {
      const l = this.life[i] - dtMs;
      if (l <= 0) continue;
      const dt = dtMs / 1000;
      this.px[n] = this.px[i] + this.vx[i] * dt;
      this.py[n] = this.py[i] + this.vy[i] * dt + 14 * dt * dt * 60;
      this.vx[n] = this.vx[i] * 0.965;
      this.vy[n] = this.vy[i] * 0.965 + 22 * dt;
      this.life[n] = l;
      this.maxLife[n] = this.maxLife[i];
      this.size[n] = this.size[i];
      this.hue[n * 3] = this.hue[i * 3];
      this.hue[n * 3 + 1] = this.hue[i * 3 + 1];
      this.hue[n * 3 + 2] = this.hue[i * 3 + 2];
      n++;
    }
    this.live = n;
  }

  get busy(): boolean {
    return this.live > 0 || this.diff !== null;
  }

  render(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.diff && this.diffProgress > 0) {
      const cell = (100 / GRID);
      const cw = this.toPx(cell) + 1;
      ctx.save();
      ctx.globalAlpha = 0.45 * this.diffProgress;
      ctx.fillStyle = this.diffColor;
      // Flood outward from the centre so the wrong region reads as spreading.
      const reach = this.diffProgress * 1.45;
      for (let i = 0; i < this.diff.length; i++) {
        if (!this.diff[i]) continue;
        const gx = i % GRID;
        const gy = (i / GRID) | 0;
        const d = Math.hypot(gx / GRID - 0.5, gy / GRID - 0.5) * 1.42;
        if (d > reach) continue;
        ctx.fillRect(this.toPx(gx * cell), this.toPx(gy * cell), cw, cw);
      }
      ctx.restore();
    }

    for (let i = 0; i < this.live; i++) {
      const t = this.life[i] / this.maxLife[i];
      ctx.globalAlpha = t * t;
      ctx.fillStyle = `rgb(${this.hue[i * 3]},${this.hue[i * 3 + 1]},${this.hue[i * 3 + 2]})`;
      const s = this.toPx(this.size[i] * t);
      ctx.beginPath();
      ctx.arc(this.toPx(this.px[i]), this.toPx(this.py[i]), Math.max(s, 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.live = 0;
    this.diff = null;
    this.diffProgress = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

function parseHex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}
