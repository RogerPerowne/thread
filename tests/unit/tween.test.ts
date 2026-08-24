import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Ticker, easeOut, easeInOut, linear } from '../../src/render/tween.js';

// The Ticker only touches rAF when something asks it to run; `advance` steps it
// deterministically, so these tests never need a real frame loop.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

describe('tween engine', () => {
  it('interpolates from start to end and lands exactly on the end value', () => {
    const t = new Ticker(() => 0);
    const seen: number[] = [];
    t.add({ from: 0, to: 100, dur: 100, ease: linear, onUpdate: (v) => seen.push(v) });
    t.advance(50);
    expect(seen.at(-1)).toBeCloseTo(50);
    t.advance(50);
    expect(seen.at(-1)).toBe(100);
  });

  it('fires onDone exactly once', () => {
    const t = new Ticker(() => 0);
    let done = 0;
    t.add({ dur: 100, onUpdate: () => {}, onDone: () => done++ });
    t.advance(100);
    t.advance(100);
    t.advance(100);
    expect(done).toBe(1);
  });

  it('honours a delay', () => {
    const t = new Ticker(() => 0);
    const seen: number[] = [];
    t.add({ from: 0, to: 1, dur: 100, delay: 200, ease: linear, onUpdate: (v) => seen.push(v) });
    t.advance(100);
    expect(seen).toHaveLength(0);
    t.advance(150);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('renders exactly once per tick no matter how many tweens are running', () => {
    const t = new Ticker(() => 0);
    let renders = 0;
    t.setRenderer(() => renders++);
    for (let i = 0; i < 8; i++) t.add({ dur: 100, onUpdate: () => {} });
    t.advance(50);
    expect(renders).toBe(1);
    t.advance(50);
    expect(renders).toBe(2);
  });

  it('does not render when nothing changed', () => {
    const t = new Ticker(() => 0);
    let renders = 0;
    t.setRenderer(() => renders++);
    t.advance(16);
    expect(renders).toBe(0);
  });

  it('requestFrame draws once and then goes quiet — pointer handlers never draw', () => {
    const t = new Ticker(() => 0);
    let renders = 0;
    t.setRenderer(() => renders++);
    t.requestFrame();
    t.tick();
    expect(renders).toBe(1);
    t.tick();
    expect(renders).toBe(1);
  });

  it('cancelAll stops every tween AND every pending beat', () => {
    const t = new Ticker(() => 0);
    let updates = 0;
    let beats = 0;
    t.add({ dur: 1000, onUpdate: () => updates++ });
    t.after(500, () => beats++);
    t.cancelAll();
    t.advance(2000);
    expect(updates).toBe(0);
    expect(beats).toBe(0);
    expect(t.busy).toBe(false);
  });

  it('a cancelled tween cannot write into the next level — the stale-timer bug', () => {
    const t = new Ticker(() => 0);
    const levelA = { opacity: 0 };
    let target = levelA;
    t.add({ from: 0, to: 1, dur: 400, onUpdate: (v) => { target.opacity = v; } });
    t.advance(100);
    expect(levelA.opacity).toBeGreaterThan(0);
    // Level change: everything is cancelled before the new state exists.
    t.cancelAll();
    const levelB = { opacity: 0 };
    target = levelB;
    t.advance(1000);
    expect(levelB.opacity).toBe(0);
  });

  it('sequences chained beats in animation time', () => {
    const t = new Ticker(() => 0);
    const order: string[] = [];
    t.sequence([
      [0, () => order.push('a')],
      [200, () => order.push('b')],
      [400, () => order.push('c')],
    ]);
    t.advance(0);
    expect(order).toEqual(['a']);
    t.advance(250);
    expect(order).toEqual(['a', 'b']);
    t.advance(250);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('reduced motion lands every tween instantly, with no intermediate frames', () => {
    const t = new Ticker(() => 0);
    t.reducedMotion = true;
    const seen: number[] = [];
    let done = false;
    t.add({ from: 0, to: 42, dur: 5000, onUpdate: (v) => seen.push(v), onDone: () => { done = true; } });
    t.advance(0);
    expect(seen).toEqual([42]);
    expect(done).toBe(true);
    expect(t.busy).toBe(false);
  });

  it('reduced motion runs visual sequences immediately too', () => {
    const t = new Ticker(() => 0);
    t.reducedMotion = true;
    const order: string[] = [];
    t.sequence([[0, () => order.push('a')], [800, () => order.push('b')]]);
    t.advance(0);
    expect(order).toEqual(['a', 'b']);
  });

  it('but reduced motion does NOT collapse gameplay pacing', () => {
    // A player who asked for less movement did not ask for the game to skip
    // ahead before they have seen what happened.
    const t = new Ticker(() => 0);
    t.reducedMotion = true;
    let advanced = false;
    t.schedule(1200, () => { advanced = true; });
    t.advance(0);
    expect(advanced).toBe(false);
    t.advance(600);
    expect(advanced).toBe(false);
    t.advance(700);
    expect(advanced).toBe(true);
  });

  it('easings are well formed', () => {
    for (const e of [easeOut, easeInOut, linear]) {
      expect(e(0)).toBeCloseTo(0);
      expect(e(1)).toBeCloseTo(1);
    }
  });
});
