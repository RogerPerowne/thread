/**
 * Instinct tests.
 *
 * "Is it solvable" and "does the natural gesture work" are different
 * questions. The prototype passed every solvability test and still shipped a
 * level that felt impossible, because only the first was ever asked. These
 * assert the OBVIOUS gesture works.
 */
import { describe, it, expect } from 'vitest';
import { GestureMachine, REOPEN_GRACE_MS, projectOnRail, type Action, type GestureCtx } from '../../src/game/gesture.js';
import { initialState, normalizeClosedPath, type PlayState } from '../../src/core/rules.js';
import { validateLevel, type Level } from '../../src/core/level.js';
import type { Pt } from '../../src/core/geometry.js';

const ring = (n: number, r = 35): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  return out;
};

/** A tiny harness that applies actions the way the game does. */
class Harness {
  gm = new GestureMachine();
  state: PlayState;
  closedAt = -1e9;
  log: Action[] = [];
  t = 1000;

  constructor(public level: Level) {
    this.state = initialState(level);
  }
  get ctx(): GestureCtx {
    return {
      level: this.level,
      state: this.state,
      closedAt: this.closedAt,
      pegAt: (p: Pt, mode: 'tap' | 'sweep' = 'tap') => {
        let best = -1;
        let bd = mode === 'sweep' ? 2.8 * 2.8 : 4 * 4;
        this.level.pegs.forEach((q, i) => {
          const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
          if (d <= bd) { bd = d; best = i; }
        });
        return best;
      },
    };
  }
  apply(actions: Action[]): void {
    for (const a of actions) {
      this.log.push(a);
      const st = this.state.threads[this.state.active];
      if (a.type === 'add') st.pegs.push(a.peg);
      else if (a.type === 'retract') st.pegs.pop();
      else if (a.type === 'close') { st.closed = true; this.closedAt = this.t; }
      else if (a.type === 'reopen') { st.closed = false; this.closedAt = -1e9; }
    }
  }
  feed(i: Parameters<GestureMachine['handle']>[0]): void {
    this.apply(this.gm.handle(i, this.ctx));
  }
  at(peg: number): Pt { return this.level.pegs[peg] as Pt; }
  /** Nudge a point slightly, to simulate a finger that is not pixel perfect. */
  near(peg: number, dx = 0.8, dy = -0.6): Pt {
    const p = this.at(peg);
    return [p[0] + dx, p[1] + dy];
  }
  tap(peg: number): void {
    this.feed({ type: 'down', p: this.near(peg), t: this.t });
    this.t += 60;
    this.feed({ type: 'up', p: this.near(peg), t: this.t });
    this.t += 140;
  }
  /** A real drag: press on the first peg, sweep through the rest, release. */
  drag(pegs: number[]): void {
    this.feed({ type: 'down', p: this.near(pegs[0]), t: this.t });
    for (let i = 1; i < pegs.length; i++) {
      const from = this.at(pegs[i - 1]);
      const to = this.at(pegs[i]);
      for (let s = 1; s <= 5; s++) {
        const k = s / 5;
        this.t += 12;
        this.feed({ type: 'move', p: [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k], t: this.t });
      }
    }
    this.t += 12;
    this.feed({ type: 'up', p: this.near(pegs[pegs.length - 1]), t: this.t });
  }
  get closed(): boolean { return this.state.threads[0].closed; }
  get pegs(): number[] { return this.state.threads[0].pegs; }
  closes(): number { return this.log.filter((a) => a.type === 'close').length; }
}

const square = (over: Partial<Level> = {}): Level => validateLevel({
  id: 'sq', mode: 'classic', chapter: 1,
  pegs: [[20, 20], [80, 20], [80, 80], [20, 80]],
  threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3] }],
  ...over,
}) as Level;

describe('drag and release', () => {
  it('drag around the pegs and let go — it closes', () => {
    const h = new Harness(square());
    h.drag([0, 1, 2, 3]);
    expect(h.pegs).toEqual([0, 1, 2, 3]);
    expect(h.closed).toBe(true);
  });

  it('a drag that never reaches three pegs does NOT close', () => {
    const h = new Harness(square());
    h.drag([0, 1]);
    expect(h.closed).toBe(false);
  });

  it('a drag across empty board that adds no peg does NOT close', () => {
    const h = new Harness(square());
    h.feed({ type: 'down', p: [50, 50], t: h.t });
    for (let i = 0; i < 10; i++) { h.t += 16; h.feed({ type: 'move', p: [50 + i * 2, 50], t: h.t }); }
    h.feed({ type: 'up', p: [70, 50], t: h.t });
    expect(h.closed).toBe(false);
    expect(h.pegs).toEqual([]);
  });

  it('a stationary press and lift is a tap, not a drag — it does not close', () => {
    const h = new Harness(square());
    h.tap(0); h.tap(1); h.tap(2);
    expect(h.pegs).toEqual([0, 1, 2]);
    expect(h.closed).toBe(false);
  });
});

describe('tap mode', () => {
  it('tap the loose end a second time — it closes, on every level', () => {
    const h = new Harness(square());
    h.tap(0); h.tap(1); h.tap(2);
    expect(h.closed).toBe(false);
    h.tap(2); // the loose end, again
    expect(h.closed).toBe(true);
  });

  it('the loose-end tap works on a CROSSING level too — the universal fallback', () => {
    const h = new Harness(validateLevel({
      id: 'star', mode: 'classic', chapter: 3, allowCross: true,
      pegs: ring(5), threads: [{ color: '#7A4FBF', sol: [0, 2, 4, 1, 3] }],
    }) as Level);
    h.tap(0); h.tap(2); h.tap(4); h.tap(1); h.tap(3);
    expect(h.closed).toBe(false);
    h.tap(3);
    expect(h.closed).toBe(true);
    expect(h.pegs).toEqual([0, 2, 4, 1, 3]);
  });

  it('tapping the loose end with fewer than three pegs does nothing but complain', () => {
    const h = new Harness(square());
    h.tap(0); h.tap(0);
    expect(h.closed).toBe(false);
    expect(h.log.some((a) => a.type === 'reject' && a.reason === 'too-short')).toBe(true);
  });
});

describe('returning to the start peg', () => {
  it('closes on a non-crossing level — the instinctive gesture', () => {
    const h = new Harness(square());
    h.tap(0); h.tap(1); h.tap(2); h.tap(3);
    h.tap(0); // back to the start
    expect(h.closed).toBe(true);
    expect(h.pegs).toEqual([0, 1, 2, 3]);
  });

  it('does NOT close on a crossing level — that is how a keyhole is cut', () => {
    // Chapter 4: revisit the start peg mid-loop to carve a hole.
    const outer = ring(4, 40);
    const inner = ring(4, 15);
    const h = new Harness(validateLevel({
      id: 'keyhole', mode: 'classic', chapter: 4, allowCross: true,
      pegs: [...outer, ...inner],
      threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3, 0, 4, 5, 6, 7] }],
    }) as Level);
    h.tap(0); h.tap(1); h.tap(2); h.tap(3);
    h.tap(0); // mid-loop revisit; must NOT tie off
    expect(h.closed).toBe(false);
    expect(h.pegs).toEqual([0, 1, 2, 3, 0]);
    h.tap(4); h.tap(5); h.tap(6); h.tap(7);
    h.tap(7); // loose-end double tap ties it
    expect(h.closed).toBe(true);
    expect(h.pegs).toEqual([0, 1, 2, 3, 0, 4, 5, 6, 7]);
  });

  it('and the same keyhole works by dragging, with a mid-loop pass over the start', () => {
    const outer = ring(4, 40);
    const inner = ring(4, 15);
    const h = new Harness(validateLevel({
      id: 'keyhole2', mode: 'classic', chapter: 4, allowCross: true,
      pegs: [...outer, ...inner],
      threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3, 0, 4, 5, 6, 7] }],
    }) as Level);
    h.drag([0, 1, 2, 3, 0, 4, 5, 6, 7]);
    expect(h.pegs).toEqual([0, 1, 2, 3, 0, 4, 5, 6, 7]);
    expect(h.closed).toBe(true);
    expect(h.closes()).toBe(1); // and it closed exactly once, at the end
  });
});

describe('the grace period', () => {
  it('an accidental lift can be undone by touching the loose end again', () => {
    const h = new Harness(square());
    h.drag([0, 1, 2, 3]);
    expect(h.closed).toBe(true);
    h.t += 200; // well within the 500 ms grace
    h.feed({ type: 'down', p: h.near(3), t: h.t });
    expect(h.closed).toBe(false);
    expect(h.pegs).toEqual([0, 1, 2, 3]); // and no peg was lost
  });

  it('but not once the grace has expired', () => {
    const h = new Harness(square());
    h.drag([0, 1, 2, 3]);
    h.t += REOPEN_GRACE_MS + 50;
    h.feed({ type: 'down', p: h.near(3), t: h.t });
    expect(h.closed).toBe(true);
  });

  it('re-opening costs no undo — the path is untouched', () => {
    const h = new Harness(square());
    h.drag([0, 1, 2, 3]);
    h.t += 100;
    h.feed({ type: 'down', p: h.near(3), t: h.t });
    expect(h.log.filter((a) => a.type === 'retract')).toHaveLength(0);
  });
});

describe('pulling back', () => {
  it('dragging onto the previous peg retracts the last segment', () => {
    const h = new Harness(square());
    h.tap(0); h.tap(1); h.tap(2);
    h.tap(1); // back one
    expect(h.pegs).toEqual([0, 1]);
  });
  it('and a retract never closes the loop by accident', () => {
    const h = new Harness(square());
    h.tap(0); h.tap(1); h.tap(2); h.tap(3);
    h.tap(2);
    expect(h.closed).toBe(false);
    expect(h.pegs).toEqual([0, 1, 2]);
  });
});

describe('illegal moves', () => {
  it('a post-blocked peg is refused and the path is unchanged', () => {
    const h = new Harness(square({ posts: [[50, 50, 12]] }));
    h.tap(0);
    h.tap(2); // straight through the post
    expect(h.pegs).toEqual([0]);
    expect(h.log.some((a) => a.type === 'reject' && a.reason === 'post-blocked')).toBe(true);
  });

  it('a thorn peg cannot be threaded', () => {
    const h = new Harness(square({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 50]],
      thorn: [4],
    }));
    h.tap(0);
    h.tap(4);
    expect(h.pegs).toEqual([0]);
  });
});

describe('keyboard play', () => {
  it('activating pegs threads and ties off exactly like tapping', () => {
    const h = new Harness(square());
    for (const peg of [0, 1, 2, 3]) { h.feed({ type: 'activate', peg, t: h.t }); h.t += 50; }
    expect(h.closed).toBe(false);
    h.feed({ type: 'activate', peg: 3, t: h.t });
    expect(h.closed).toBe(true);
  });
  it('and start-peg activation closes on non-crossing levels', () => {
    const h = new Harness(square());
    for (const peg of [0, 1, 2, 3]) { h.feed({ type: 'activate', peg, t: h.t }); h.t += 50; }
    h.feed({ type: 'activate', peg: 0, t: h.t });
    expect(h.closed).toBe(true);
  });
});

describe('rails', () => {
  it('projects a slide onto its rail and clamps to the ends', () => {
    expect(projectOnRail([50, 10], [20, 50], [80, 50])).toEqual([50, 50]);
    expect(projectOnRail([0, 10], [20, 50], [80, 50])).toEqual([20, 50]);
    expect(projectOnRail([200, 10], [20, 50], [80, 50])).toEqual([80, 50]);
  });

  it('snaps to notches anchored on the position the answer needs', () => {
    const a: Pt = [20, 50];
    const b: Pt = [80, 50];
    const home: Pt = [50, 50];
    // A thumb two units short still lands the peg exactly on the answer.
    expect(projectOnRail([48, 44], a, b, home)).toEqual([50, 50]);
    expect(projectOnRail([52, 56], a, b, home)).toEqual([50, 50]);
    // And a deliberate move lands on the next notch, six units along.
    expect(projectOnRail([56, 50], a, b, home)).toEqual([56, 50]);
    expect(projectOnRail([44, 50], a, b, home)).toEqual([44, 50]);
  });

  it('never snaps past the ends of the rail', () => {
    const out = projectOnRail([200, 50], [20, 50], [80, 50], [50, 50]);
    expect(out[0]).toBeLessThanOrEqual(80);
    expect(out[0]).toBeGreaterThanOrEqual(20);
  });

  it('leaves the peg where it was when the answer needs no move', () => {
    // home at one end: the notches still line up on it exactly.
    expect(projectOnRail([21, 50], [20, 50], [80, 50], [20, 50])).toEqual([20, 50]);
  });
  it('TAPPING a rail peg threads it — it is still a peg', () => {
    // The rail peg could only ever be slid, never threaded, so no loop could
    // include it and every Sliders level was unsolvable.
    const h = new Harness(square({
      pegs: [[20, 20], [80, 20], [80, 80], [50, 90]],
      rails: [{ peg: 3, a: [20, 90], b: [80, 90] }],
      threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3] }],
    }));
    h.tap(0); h.tap(1); h.tap(2); h.tap(3);
    expect(h.pegs).toEqual([0, 1, 2, 3]);
    h.tap(3);
    expect(h.closed).toBe(true);
  });

  it('dragging a rail peg slides it rather than threading it', () => {
    const h = new Harness(square({
      pegs: [[20, 20], [80, 20], [80, 80], [20, 80], [50, 90]],
      rails: [{ peg: 4, a: [20, 90], b: [80, 90] }],
      threads: [{ color: '#7A4FBF', sol: [0, 1, 2, 3] }],
    }));
    h.feed({ type: 'down', p: h.near(4), t: h.t });
    h.t += 30;
    h.feed({ type: 'move', p: [70, 90], t: h.t });
    expect(h.log.some((a) => a.type === 'slide')).toBe(true);
    expect(h.pegs).toEqual([]);
  });
});

describe('no double closes', () => {
  it('a drag that ends on the start peg closes once, not twice', () => {
    const h = new Harness(square());
    h.drag([0, 1, 2, 3, 0]);
    expect(h.closes()).toBe(1);
  });
  it('dragging round and back onto the start peg ties off on a CROSSING level too', () => {
    // Here start-peg-tap must not auto-close mid-loop, so the release does it,
    // and the duplicate start peg is dropped rather than left dangling.
    const h = new Harness(validateLevel({
      id: 'cross-back', mode: 'classic', chapter: 3, allowCross: true,
      pegs: ring(5), threads: [{ color: '#7A4FBF', sol: [0, 2, 4, 1, 3] }],
    }) as Level);
    h.drag([0, 2, 4, 1, 3, 0]);
    expect(h.closed).toBe(true);
    expect(h.closes()).toBe(1);
    expect(normalizeClosedPath(h.pegs)).toEqual([0, 2, 4, 1, 3]);
  });

  it('pointer events after a close are ignored', () => {
    const h = new Harness(square());
    h.drag([0, 1, 2, 3]);
    h.t += REOPEN_GRACE_MS + 100;
    h.tap(1);
    expect(h.closes()).toBe(1);
    expect(h.pegs).toEqual([0, 1, 2, 3]);
  });
});
