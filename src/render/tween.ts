/**
 * One requestAnimationFrame loop for the whole game.
 *
 * Every visual transition — segment settle, fill fade, peg pop, win flourish,
 * the strum — goes through this. Nothing schedules visual work with
 * setTimeout: a stale timer writing into a new level's state is the
 * second-order cause of most "glitchiness", so the ability to cancel
 * everything at once on a level change is the point of the design.
 */

export type Ease = (t: number) => number;

export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn: Ease = (t) => t * t * t;
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const linear: Ease = (t) => t;
/** A single overshoot — used once per win and nowhere else. */
export const easeBack: Ease = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

export type Tween = {
  from: number;
  to: number;
  t0: number;
  dur: number;
  ease: Ease;
  onUpdate: (v: number) => void;
  onDone?: () => void;
};

export type TweenSpec = {
  from?: number;
  to?: number;
  dur: number;
  delay?: number;
  ease?: Ease;
  onUpdate: (v: number) => void;
  onDone?: () => void;
};

/** A chained run of beats. Used by the solution animation and the strum. */
export type Beat = { at: number; run: () => void };

export class Ticker {
  private tweens: Tween[] = [];
  private beats: Beat[] = [];
  private clock = 0;
  private raf = 0;
  private renderFn: (() => void) | null = null;
  private dirty = false;
  private lastNow = 0;

  /** Set by the accessibility layer; when true, tweens land instantly. */
  reducedMotion = false;

  /** Frame timings for the performance assertion. */
  readonly frameTimes: number[] = [];
  private recording = false;

  constructor(private now: () => number = () => performance.now()) {}

  setRenderer(fn: (() => void) | null): void {
    this.renderFn = fn;
  }

  /** Ask for exactly one more frame. Pointer handlers call this; they never draw. */
  requestFrame(): void {
    this.dirty = true;
    this.ensureRunning();
  }

  add(spec: TweenSpec): void {
    const from = spec.from ?? 0;
    const to = spec.to ?? 1;
    if (this.reducedMotion) {
      // Land immediately, but still on a frame so callers never re-enter.
      this.beats.push({
        at: this.clock,
        run: () => {
          spec.onUpdate(to);
          spec.onDone?.();
        },
      });
      this.ensureRunning();
      return;
    }
    this.tweens.push({
      from,
      to,
      t0: this.clock + (spec.delay ?? 0),
      dur: Math.max(spec.dur, 1),
      ease: spec.ease ?? easeOut,
      onUpdate: spec.onUpdate,
      onDone: spec.onDone,
    });
    this.ensureRunning();
  }

  /** Run `fn` after `ms` of animation time. The rAF-driven stand-in for setTimeout. */
  after(ms: number, fn: () => void): void {
    this.beats.push({ at: this.clock + (this.reducedMotion ? 0 : ms) , run: fn });
    this.ensureRunning();
  }

  /** Chained beats: [[0, a], [200, b], [400, c]] in animation time. */
  sequence(steps: Array<[number, () => void]>): void {
    for (const [at, run] of steps) this.after(at, run);
  }

  /** Everything stops. Called on every level change, without exception. */
  cancelAll(): void {
    this.tweens.length = 0;
    this.beats.length = 0;
  }

  get busy(): boolean {
    return this.tweens.length > 0 || this.beats.length > 0;
  }

  startRecording(): void {
    this.frameTimes.length = 0;
    this.recording = true;
  }

  stopRecording(): number[] {
    this.recording = false;
    return [...this.frameTimes];
  }

  private ensureRunning(): void {
    if (this.raf !== 0) return;
    this.lastNow = this.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const start = this.now();
    const dt = Math.min(now - this.lastNow, 64); // a backgrounded tab must not jump
    this.lastNow = now;
    this.clock += dt;
    this.tick();
    if (this.recording) this.frameTimes.push(this.now() - start);
    if (this.busy || this.dirty) this.ensureRunning();
  };

  /** Advance every active tween, fire due beats, then render exactly once. */
  tick(): void {
    let wrote = false;

    if (this.beats.length) {
      const due: Beat[] = [];
      const rest: Beat[] = [];
      for (const b of this.beats) (b.at <= this.clock ? due : rest).push(b);
      this.beats = rest;
      for (const b of due) {
        b.run();
        wrote = true;
      }
    }

    if (this.tweens.length) {
      const live: Tween[] = [];
      for (const tw of this.tweens) {
        const elapsed = this.clock - tw.t0;
        if (elapsed < 0) {
          live.push(tw);
          continue;
        }
        const p = elapsed >= tw.dur ? 1 : elapsed / tw.dur;
        tw.onUpdate(tw.from + (tw.to - tw.from) * tw.ease(p));
        wrote = true;
        if (p < 1) live.push(tw);
        else tw.onDone?.();
      }
      this.tweens = live;
    }

    if (wrote || this.dirty) {
      this.dirty = false;
      this.renderFn?.();
    }
  }

  /** Deterministic stepping for tests, with no rAF involved. */
  advance(ms: number): void {
    this.clock += ms;
    this.tick();
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cancelAll();
  }
}

export const ticker = new Ticker();
