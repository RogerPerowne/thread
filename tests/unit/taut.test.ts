import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  POST_R, STRING_W, compile, type Board, type Pt,
} from '../../src/core/board.js';
import { tautPath, tautSamples, wrapSign, tangent, WRAP_R } from '../../src/core/taut.js';

describe('the shape a taut string takes', () => {
  it('wraps the outside of a turn, not the inside', () => {
    // Going right then up is a left turn in a y-down space, so the outside of
    // the corner is on the right and the string wraps clockwise.
    expect(wrapSign([0, 0], [10, 0], [10, -10])).toBe(1);
    expect(wrapSign([0, 0], [10, 0], [10, 10])).toBe(-1);
  });

  it('offsets the straight by exactly the wrap radius when both wrap alike', () => {
    const t = tangent([0, 0], [10, 0], 1, 1);
    expect(Math.abs(t.from[1])).toBeCloseTo(WRAP_R);
    expect(t.from[1]).toBeCloseTo(t.to[1]);
  });

  /*
   * The one that matters. A string pulled taut round a corner presses on the
   * OUTSIDE of it. Pressing on the inside is a position no real string can
   * hold, and it is exactly what an inverted normal or an inverted sweep flag
   * produces — while still looking, at a glance, like a string that wraps.
   */
  it('presses on the outside of the corner, never the inside', () => {
    const corners: [Pt, Pt, Pt][] = [
      [[0, 40], [40, 40], [40, 0]],
      [[0, 40], [40, 40], [40, 80]],
      [[80, 40], [40, 40], [40, 0]],
      [[20, 20], [50, 40], [20, 70]],
    ];
    for (const [prev, mid, next] of corners) {
      // The inside of the corner is where the two arms point, added together.
      const norm = (p: Pt): Pt => {
        const L = Math.hypot(p[0], p[1]);
        return [p[0] / L, p[1] / L];
      };
      const a = norm([prev[0] - mid[0], prev[1] - mid[1]]);
      const b = norm([next[0] - mid[0], next[1] - mid[1]]);
      const inside = norm([a[0] + b[0], a[1] + b[1]]);

      // The furthest the string gets from the corner post is its wrap point.
      const pts = tautSamples([prev, mid, next], [0, 1, 2], 24);
      let far: Pt = pts[0];
      let best = -Infinity;
      for (const q of pts) {
        const d = Math.hypot(q[0] - mid[0], q[1] - mid[1]);
        if (d <= WRAP_R + 1e-6 && d > best - 1e9) {
          // Only points actually on the wrap arc.
          const dot = (q[0] - mid[0]) * inside[0] + (q[1] - mid[1]) * inside[1];
          if (-dot > best) { best = -dot; far = q; }
        }
      }
      const away = (far[0] - mid[0]) * inside[0] + (far[1] - mid[1]) * inside[1];
      expect(away, `corner ${JSON.stringify(mid)} wrapped the inside`).toBeLessThan(0);
    }
  });

  it('crosses between the posts when they wrap opposite ways', () => {
    const t = tangent([0, 0], [20, 0], 1, -1);
    // One tangent point above the line, the other below.
    expect(Math.sign(t.from[1])).toBe(-Math.sign(t.to[1]));
  });

  it('touches the rim of every post it uses, and never cuts inside it', () => {
    const posts: Pt[] = [[20, 20], [50, 25], [80, 20], [80, 60], [30, 70]];
    const path = [0, 1, 2, 3, 4];
    for (const p of tautSamples(posts, path, 40)) {
      for (const q of path) {
        const d = Math.hypot(p[0] - posts[q][0], p[1] - posts[q][1]);
        // The centreline never comes closer than the wrap radius, so the
        // string's inner edge never eats into a post.
        expect(d).toBeGreaterThanOrEqual(WRAP_R - 1e-6);
      }
    }
  });

  it('draws arcs, not corners', () => {
    const posts: Pt[] = [[20, 20], [50, 20], [50, 60]];
    const d = tautPath(posts, [0, 1, 2]);
    expect(d).toContain('A');
  });

  it('shows a single post as a full wrap, so a started strand is visible', () => {
    const d = tautPath([[50, 50]], [0]);
    expect(d.match(/A/g)?.length).toBe(2);
  });
});

/**
 * The rule measures straight lines through post centres; the string is drawn
 * taut and strays from those lines. The clearances in board.ts carry that
 * stray, and this is what proves it: take every shipped board's answer, sample
 * the shape actually drawn, and check nothing touches anything.
 */
describe('the rule is never more permissive than the picture', () => {
  const MODES = ['classic', 'coloured', 'grid'] as const;
  for (const mode of MODES) {
    const file = `boards/${mode}.json`;
    it(`no drawn string on a ${mode} board touches another, or a post`, () => {
      if (!existsSync(file)) return;
      const boards = JSON.parse(readFileSync(file, 'utf8')) as Board[];
      for (const board of boards) {
        const c = compile(board);
        void c;
        const strands = board.solution.map(
          (p) => ({ path: p as number[], pts: tautSamples(board.posts, p as number[], 8) }),
        );
        const owned = new Set<number>();
        for (const s of strands) for (const q of s.path) owned.add(q);

        // No two strings touch: their bodies are STRING_W either side.
        for (let a = 0; a < strands.length; a++) {
          for (let b = a + 1; b < strands.length; b++) {
            for (const p of strands[a].pts) {
              for (const q of strands[b].pts) {
                const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
                expect(d, `${board.id}: strings ${a} and ${b} touch`).toBeGreaterThan(2 * STRING_W);
              }
            }
          }
        }

        // No string runs over a post another string owns.
        for (let s = 0; s < strands.length; s++) {
          const mine = new Set(strands[s].path);
          for (let i = 0; i < board.posts.length; i++) {
            if (mine.has(i)) continue;
            for (const p of strands[s].pts) {
              const d = Math.hypot(p[0] - board.posts[i][0], p[1] - board.posts[i][1]);
              expect(d, `${board.id}: string ${s} hits post ${i}`).toBeGreaterThan(POST_R + STRING_W);
            }
          }
        }
      }
    });
  }
});
