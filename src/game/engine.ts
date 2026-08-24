/**
 * The play loop. Owns one level at a time and coordinates the scene graph, the
 * tween engine, the gesture machine and the rules.
 *
 * The contract that keeps it from glitching: pointer handlers mutate state and
 * ask for a frame. They never draw, never create a node, and never schedule
 * anything with setTimeout.
 */

import type { Pt } from '../core/geometry.js';
import { dist } from '../core/geometry.js';
import { type Level, deriveTarget, parLength, mechanicsOf, effectiveLoop } from '../core/level.js';
import {
  initialState, evaluate, canClose, normalizeClosedPath, threadPoints, lengthUsed,
  allCrossings, REJECT_TEXT, WIN_THRESHOLD,
  type PlayState, type Evaluation, type CrossingRef,
} from '../core/rules.js';
import { makeRaster, symmetricDifference, type Raster } from '../core/region.js';
import { BoardScene } from '../render/scene.js';
import { Overlay } from '../render/particles.js';
import { Ticker, easeOut, easeBack } from '../render/tween.js';
import { audio } from '../render/audio.js';
import { themeById, skinById } from '../render/theme.js';
import { GestureMachine, projectOnRail, type Action, type PointerInput } from './gesture.js';

export type PlayResult = {
  level: Level;
  win: boolean;
  similarity: number;
  lengthUsed: number;
  par: number;
  /** Closed loops tried before this one. */
  attempt: number;
  firstTry: boolean;
  hintsUsed: number;
  planningMs: number;
  executionMs: number;
  searchOps: number;
  raster: Raster;
};

export type EngineHooks = {
  onWin?: (r: PlayResult) => void;
  onMiss?: (r: PlayResult) => void;
  onAdvance?: () => void;
  onToast?: (msg: string) => void;
  onStateChange?: () => void;
};

export type EngineOpts = {
  themeId: string;
  skinId: string;
  reducedMotion: boolean;
  /** Zen and Workshop never auto-advance. */
  autoAdvance: boolean;
  /** One Life ends the run on a wrong loop. */
  suddenDeath?: boolean;
};

const AUTO_ADVANCE_MS = 1200;
const MISS_FLOOD_MS = 800;

export class Engine {
  readonly ticker: Ticker;
  readonly scene: BoardScene;
  readonly overlay: Overlay;
  private gm = new GestureMachine();

  level!: Level;
  state!: PlayState;
  private target!: Raster;
  private diff = makeRaster();
  private closedAt = -1e9;
  private hitRadius = 4;

  /**
   * Weave levels: which crossings have the FIRST strand on top. The default is
   * that the thread laid later passes over, which is what happens if you
   * really do lay one string across another; tapping a crossing flips it.
   */
  private overSet = new Set<number>();
  private crossings: CrossingRef[] = [];

  // Undo history: snapshots of the peg lists, cheap because they are short.
  private history: number[][][] = [];

  // Telemetry for the rating model.
  private levelStartedAt = 0;
  private firstPegAt = -1;
  attempts = 0;
  hintsUsed = 0;
  searchOps = 0;

  private awaitingAdvance = false;
  private destroyed = false;
  private opts: EngineOpts;

  constructor(private root: HTMLElement, opts: EngineOpts, private hooks: EngineHooks = {}) {
    this.opts = opts;
    this.ticker = new Ticker();
    this.ticker.reducedMotion = opts.reducedMotion;
    this.scene = new BoardScene(root);
    this.overlay = new Overlay(root);
    this.overlay.reducedMotion = opts.reducedMotion;
    this.ticker.setRenderer(this.render);
    this.bind();
  }

  // -------------------------------------------------------------------------
  // Level lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load a level. Everything animating is cancelled BEFORE the new state
   * exists, so a tween from the previous level can never write into this one.
   */
  load(level: Level, opts: Partial<EngineOpts> = {}): void {
    this.ticker.cancelAll();
    this.overlay.clear();
    this.opts = { ...this.opts, ...opts };
    this.ticker.reducedMotion = this.opts.reducedMotion;
    this.overlay.reducedMotion = this.opts.reducedMotion;

    this.level = level;
    this.state = initialState(level);
    const derived = deriveTarget(level);
    this.target = derived.raster;
    this.history = [];
    this.attempts = 0;
    this.hintsUsed = 0;
    this.searchOps = 0;
    this.firstPegAt = -1;
    this.levelStartedAt = performance.now();
    this.closedAt = -1e9;
    this.awaitingAdvance = false;
    this.overSet = new Set();
    this.crossings = [];
    this.gm.reset();

    const theme = themeById(this.opts.themeId);
    audio.setTheme(theme);
    this.scene.mount(level, { theme, skin: skinById(this.opts.skinId), showTarget: !level.fog });
    this.scene.setTarget(level, derived.loops);
    this.scene.setTargetVisible(level.fog ? 0 : 1);
    this.resize();

    // One quiet entrance: the target fades in. Nothing else moves.
    if (!level.fog) {
      this.scene.setTargetVisible(0);
      this.ticker.add({ dur: 220, ease: easeOut, onUpdate: (v) => this.scene.setTargetVisible(v) });
    }
    this.ticker.requestFrame();
    this.hooks.onStateChange?.();
  }

  destroy(): void {
    this.destroyed = true;
    this.ticker.stop();
    this.ticker.setRenderer(null);
    this.unbind();
    this.scene.destroy();
    this.overlay.clear();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private lastRenderAt = 0;
  private render = (): void => {
    if (this.destroyed || !this.level) return;
    this.scene.update(this.state);
    const now = performance.now();
    this.overlay.step(Math.min(now - this.lastRenderAt, 64));
    this.lastRenderAt = now;
    this.overlay.render();
  };

  resize(): void {
    const rect = this.root.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) || 320;
    this.overlay.resize(rect.width, rect.height);
    this.hitRadius = this.scene.setHitRadius(size);
    this.ticker.requestFrame();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private bind(): void {
    const el = this.scene.svg;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('keydown', this.onKeyDown);
    el.addEventListener('contextmenu', preventDefault);
  }

  private unbind(): void {
    const el = this.scene.svg;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('keydown', this.onKeyDown);
    el.removeEventListener('contextmenu', preventDefault);
  }

  /** Client coordinates to board space, via the SVG's own viewBox mapping. */
  private toBoard(ev: PointerEvent): Pt {
    const rect = this.scene.svg.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const ox = rect.left + (rect.width - size) / 2;
    const oy = rect.top + (rect.height - size) / 2;
    return [((ev.clientX - ox) / size) * 100, ((ev.clientY - oy) / size) * 100];
  }

  private onPointerDown = (ev: PointerEvent): void => {
    if (this.awaitingAdvance) {
      this.skipToNext();
      return;
    }
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
    const p = this.toBoard(ev);
    // On a weave level a tap near a crossing flips which strand is on top,
    // and that takes priority over threading.
    if (this.level.weave && this.toggleCrossingAt(p)) return;
    this.feed({ type: 'down', p, t: ev.timeStamp });
  };

  /** Flip the over/under at the nearest crossing, if the tap was near one. */
  private toggleCrossingAt(p: Pt): boolean {
    let best = -1;
    let bestD = Math.max(this.hitRadius * 0.8, 3.2) ** 2;
    for (let k = 0; k < this.crossings.length; k++) {
      const c = this.crossings[k].point;
      const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0) return false;
    if (this.overSet.has(best)) this.overSet.delete(best);
    else this.overSet.add(best);
    audio.pluck(28, 0.6);
    this.refreshWeave();
    // Flipping a crossing can be the last thing a solve needs.
    if (this.state.threads.every((t) => t.closed)) {
      const result = this.score();
      if (result.win) this.onWin(result);
    }
    this.ticker.requestFrame();
    return true;
  }

  /** Recompute crossings and redraw the breaks. Once per closed loop, not per frame. */
  private refreshWeave(): void {
    if (!this.level.weave) return;
    const loops = this.state.threads.map((t, i) => (
      t.closed && t.pegs.length >= 3
        ? effectiveLoop(this.level, threadPoints(this.level, this.state, i))
        : []
    ));
    if (loops.some((l) => l.length < 3)) {
      this.crossings = [];
      this.scene.clearWeave();
      return;
    }
    this.crossings = allCrossings(loops);
    this.scene.setWeave(this.crossings, this.overSet, loops);
  }

  private onPointerMove = (ev: PointerEvent): void => {
    if (this.awaitingAdvance) return;
    this.feed({ type: 'move', p: this.toBoard(ev), t: ev.timeStamp });
  };

  private onPointerUp = (ev: PointerEvent): void => {
    if (this.awaitingAdvance) return;
    this.feed({ type: 'up', p: this.toBoard(ev), t: ev.timeStamp });
  };

  private onPointerCancel = (ev: PointerEvent): void => {
    this.feed({ type: 'cancel', t: ev.timeStamp });
  };

  /** Full keyboard play: arrows move focus between pegs, Enter/Space threads. */
  private onKeyDown = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    const pegAttr = target?.dataset?.peg;
    if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      this.undo();
      return;
    }
    if (pegAttr === undefined) return;
    const peg = Number(pegAttr);
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.feed({ type: 'activate', peg, t: ev.timeStamp });
      return;
    }
    const dir = { ArrowRight: 0, ArrowDown: 90, ArrowLeft: 180, ArrowUp: 270 }[ev.key];
    if (dir === undefined) return;
    ev.preventDefault();
    const next = this.nearestInDirection(peg, dir);
    if (next >= 0) this.scene.pegNodes[next].focus();
  };

  private nearestInDirection(from: number, degrees: number): number {
    const a = (degrees * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const p = this.level.pegs[from];
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.level.pegs.length; i++) {
      if (i === from) continue;
      const q = this.level.pegs[i];
      const vx = q[0] - p[0];
      const vy = q[1] - p[1];
      const len = Math.hypot(vx, vy);
      const along = (vx * dx + vy * dy) / len;
      if (along < 0.35) continue; // not really in that direction
      const score = len / along;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private feed(input: PointerInput): void {
    if (!this.level) return;
    const actions = this.gm.handle(input, {
      level: this.level,
      state: this.state,
      closedAt: this.closedAt,
      pegAt: (p) => this.scene.pegAt(p, this.hitRadius, this.state),
    });
    for (const a of actions) this.apply(a, input.t ?? performance.now());
    this.ticker.requestFrame();
  }

  // -------------------------------------------------------------------------
  // Applying gesture actions
  // -------------------------------------------------------------------------

  private apply(a: Action, t: number): void {
    const st = this.state.threads[this.state.active];
    switch (a.type) {
      case 'add': {
        if (this.firstPegAt < 0) this.firstPegAt = performance.now();
        this.pushHistory();
        const prev = st.pegs[st.pegs.length - 1];
        st.pegs.push(a.peg);
        this.popPeg(a.peg);
        if (prev !== undefined) {
          audio.pluck(dist(this.pegPoint(prev), this.pegPoint(a.peg)));
        }
        this.hooks.onStateChange?.();
        break;
      }
      case 'retract': {
        this.pushHistory();
        st.pegs.pop();
        this.searchOps++;
        this.hooks.onStateChange?.();
        break;
      }
      case 'close': {
        this.closeLoop(t);
        break;
      }
      case 'reopen': {
        st.closed = false;
        this.closedAt = -1e9;
        this.overlay.clearDifference();
        this.ticker.add({
          from: this.scene.fillOpacity, to: 0, dur: 140,
          onUpdate: (v) => { this.scene.fillOpacity = v; },
        });
        this.hooks.onStateChange?.();
        break;
      }
      case 'reject': {
        const msg = REJECT_TEXT[a.reason];
        if (msg) this.hooks.onToast?.(msg);
        this.nudgePeg(a.peg);
        break;
      }
      case 'cursor': {
        this.scene.cursor = a.p;
        break;
      }
      case 'slide': {
        const rail = this.level.rails?.find((r) => r.peg === a.peg);
        if (rail) {
          this.state.railPos[a.peg] = projectOnRail(a.p, rail.a as Pt, rail.b as Pt) as [number, number];
        }
        break;
      }
    }
  }

  private pegPoint(i: number): Pt {
    return (this.state.railPos[i] ?? this.level.pegs[i]) as Pt;
  }

  private popPeg(i: number): void {
    this.ticker.add({
      from: 1, to: 0, dur: 260, ease: easeOut,
      onUpdate: (v) => this.scene.setPegPop(i, v),
    });
  }

  private nudgePeg(i: number): void {
    this.ticker.add({
      from: 0.6, to: 0, dur: 180, ease: easeOut,
      onUpdate: (v) => this.scene.setPegPop(i, v),
    });
  }

  private pushHistory(): void {
    this.history.push(this.state.threads.map((t) => [...t.pegs]));
    if (this.history.length > 128) this.history.shift();
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.searchOps++;
    this.state.threads.forEach((t, i) => {
      t.pegs = prev[i];
      t.closed = false;
    });
    this.closedAt = -1e9;
    this.overlay.clearDifference();
    this.scene.fillOpacity = 0;
    this.ticker.requestFrame();
    this.hooks.onStateChange?.();
  }

  clear(): void {
    this.pushHistory();
    this.state.threads.forEach((t) => {
      t.pegs = [];
      t.closed = false;
    });
    this.state.active = 0;
    this.closedAt = -1e9;
    this.overlay.clearDifference();
    this.scene.fillOpacity = 0;
    this.ticker.requestFrame();
    this.hooks.onStateChange?.();
  }

  // -------------------------------------------------------------------------
  // Closing a loop
  // -------------------------------------------------------------------------

  private closeLoop(t: number): void {
    const st = this.state.threads[this.state.active];
    if (!canClose(this.level, this.state).ok) return;
    this.pushHistory();
    st.pegs = normalizeClosedPath(st.pegs);
    st.closed = true;
    this.closedAt = t;

    // Tying off strums the loop, in order.
    audio.strum(segmentLengths(threadPoints(this.level, this.state, this.state.active)));
    this.ticker.add({
      from: 0, to: 1, dur: 200, ease: easeOut,
      onUpdate: (v) => { this.scene.fillOpacity = v; },
    });

    this.refreshWeave();

    // Another thread still to lay? Move to it rather than scoring yet.
    const nextOpen = this.state.threads.findIndex((th) => !th.closed);
    if (nextOpen >= 0) {
      this.state.active = nextOpen;
      this.gm.reset();
      this.hooks.onStateChange?.();
      this.ticker.requestFrame();
      return;
    }

    this.attempts++;
    const result = this.score();
    if (result.win) this.onWin(result);
    else this.onMiss(result);
  }

  private score(): PlayResult {
    const e: Evaluation = evaluate(this.level, this.state, this.target, this.overSet);
    const now = performance.now();
    return {
      level: this.level,
      win: e.win,
      similarity: e.similarity,
      lengthUsed: e.lengthUsed,
      par: parLength(this.level),
      attempt: this.attempts,
      firstTry: this.attempts === 1,
      hintsUsed: this.hintsUsed,
      planningMs: this.firstPegAt < 0 ? now - this.levelStartedAt : this.firstPegAt - this.levelStartedAt,
      executionMs: this.firstPegAt < 0 ? 0 : now - this.firstPegAt,
      searchOps: this.searchOps,
      raster: e.raster,
    };
  }

  private onWin(r: PlayResult): void {
    audio.win();
    const pts = threadPoints(this.level, this.state, 0);
    this.overlay.flourish(pts, this.level.threads[0].color);
    // One flourish, then stillness.
    this.ticker.add({
      from: 1, to: 1.06, dur: 180, ease: easeBack,
      onUpdate: (v) => { this.scene.svg.style.transform = `scale(${v})`; },
      onDone: () => {
        this.ticker.add({
          from: 1.06, to: 1, dur: 200, ease: easeOut,
          onUpdate: (v) => { this.scene.svg.style.transform = `scale(${v})`; },
        });
      },
    });
    this.hooks.onWin?.(r);

    if (this.opts.autoAdvance) {
      this.awaitingAdvance = true;
      // The decision to continue should require no decision. A tap skips ahead.
      this.ticker.schedule(AUTO_ADVANCE_MS, () => {
        if (this.awaitingAdvance) this.skipToNext();
      });
    }
  }

  private skipToNext(): void {
    if (!this.awaitingAdvance) return;
    this.awaitingAdvance = false;
    this.scene.svg.style.transform = '';
    this.hooks.onAdvance?.();
  }

  /**
   * Near-miss feedback: show the match percentage and flood the exact region
   * that is wrong. "94%" makes people try again immediately; "wrong" makes them
   * quit.
   */
  private onMiss(r: PlayResult): void {
    audio.miss();
    if (this.level.weave && r.similarity >= WIN_THRESHOLD) {
      // The shape is right; only the over/under is wrong. Say so, and leave
      // the loop up so the player can tap the crossings.
      this.hooks.onToast?.('Right shape — check which thread goes over');
      this.hooks.onMiss?.(r);
      return;
    }
    if (this.level.fog) {
      // Each attempt reveals a little more. Deduction, not vision.
      const reveal = Math.min(1, this.attempts * 0.34);
      this.ticker.add({
        from: 0, to: reveal, dur: 260, ease: easeOut,
        onUpdate: (v) => this.scene.setTargetVisible(v),
      });
    }
    symmetricDifference(r.raster, this.target, this.diff);
    this.overlay.showDifference(this.diff);
    this.ticker.add({
      from: 0, to: 1, dur: MISS_FLOOD_MS * 0.45, ease: easeOut,
      onUpdate: (v) => this.overlay.setDifferenceProgress(v),
      onDone: () => {
        this.ticker.add({
          from: 1, to: 0, dur: MISS_FLOOD_MS * 0.55, ease: easeOut,
          delay: 220,
          onUpdate: (v) => this.overlay.setDifferenceProgress(v),
          onDone: () => this.overlay.clearDifference(),
        });
      },
    });
    this.hooks.onMiss?.(r);
    if (this.opts.suddenDeath) return; // One Life: the run is over, the caller decides

    // Leave the wrong loop up briefly, then release it so the retry is instant.
    this.ticker.schedule(MISS_FLOOD_MS, () => {
      const st = this.state.threads[this.state.active];
      if (st.closed) {
        st.closed = false;
        this.scene.fillOpacity = 0;
        this.hooks.onStateChange?.();
        this.ticker.requestFrame();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Hints
  // -------------------------------------------------------------------------

  /** Reveal one more peg of the intended solution. Costs the second star. */
  hint(): void {
    this.hintsUsed++;
    const sol = this.level.threads[this.state.active].sol;
    const st = this.state.threads[this.state.active];
    const k = Math.min(st.pegs.length, sol.length - 1);
    const peg = sol[k];
    this.popPeg(peg);
    this.hooks.onToast?.(`Try peg ${peg + 1}`);
    this.hooks.onStateChange?.();
  }

  /** Play the intended solution back as an animation, for the mercy path. */
  showSolution(): void {
    this.clear();
    const sol = this.level.threads[0].sol;
    this.state.active = 0;
    this.ticker.sequence(
      sol.map((peg, i) => [i * 180, () => {
        this.state.threads[0].pegs.push(peg);
        this.popPeg(peg);
        if (i > 0) audio.pluck(dist(this.pegPoint(sol[i - 1]), this.pegPoint(peg)));
        this.ticker.requestFrame();
      }] as [number, () => void]),
    );
    this.ticker.after(sol.length * 180 + 120, () => {
      this.state.threads[0].closed = true;
      this.ticker.add({ from: 0, to: 1, dur: 200, onUpdate: (v) => { this.scene.fillOpacity = v; } });
      audio.strum(segmentLengths(sol.map((i) => this.pegPoint(i))));
    });
  }

  /** How much of the spool is left, or null on levels without a budget. */
  get spool(): { used: number; budget: number; fraction: number } | null {
    if (!this.level || this.level.budget === undefined) return null;
    const used = lengthUsed(this.level, this.state);
    return { used, budget: this.level.budget, fraction: Math.max(0, 1 - used / this.level.budget) };
  }

  get mechanics(): string[] {
    return this.level ? mechanicsOf(this.level) : [];
  }

  get winThreshold(): number {
    return WIN_THRESHOLD;
  }
}

function segmentLengths(pts: Pt[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(dist(pts[i], pts[(i + 1) % pts.length]));
  }
  return out;
}

function preventDefault(e: Event): void {
  e.preventDefault();
}
