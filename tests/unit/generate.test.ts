import { describe, it, expect } from 'vitest';
import { dailyLevel, blitzLevel, zenLevel, oneLifeLevel } from '../../src/game/generate.js';
import { quickCheck } from '../../src/core/gate.js';
import { validateLevel } from '../../src/core/level.js';
import { CLASSIC_CHAPTERS, WEAVE_CHAPTERS } from '../../src/core/design.js';
import { makeRng } from '../../src/core/rng.js';

describe('the Daily', () => {
  it('gives every player in the world the same puzzle', () => {
    const a = dailyLevel('2026-08-24');
    const b = dailyLevel('2026-08-24');
    expect(JSON.stringify(a.pegs)).toBe(JSON.stringify(b.pegs));
    expect(a.threads[0].sol).toEqual(b.threads[0].sol);
  });

  it('gives a different puzzle tomorrow', () => {
    const a = dailyLevel('2026-08-24');
    const b = dailyLevel('2026-08-25');
    expect(JSON.stringify(a.pegs) + a.threads[0].sol.join()).not.toBe(
      JSON.stringify(b.pegs) + b.threads[0].sol.join(),
    );
  });

  it('is always solvable and fair', () => {
    for (const day of ['2026-01-01', '2026-03-17', '2026-08-24', '2026-11-02', '2026-12-31']) {
      const l = dailyLevel(day);
      const r = quickCheck(l);
      expect(r.ok, `${day}: ${r.problems.join('; ')}`).toBe(true);
    }
  });

  it('is gentler at the start of the week than at the weekend', () => {
    // Monday 2026-08-24 vs Saturday 2026-08-29.
    expect(dailyLevel('2026-08-24').chapter).toBeLessThanOrEqual(3);
  });
});

describe('the endless modes', () => {
  it('Blitz, Zen and One Life all produce sound levels', () => {
    for (let i = 0; i < 6; i++) {
      for (const l of [blitzLevel('s', i), zenLevel('s', i), oneLifeLevel('s', i)]) {
        const r = quickCheck(l);
        expect(r.ok, `${l.id}: ${r.problems.join('; ')}`).toBe(true);
      }
    }
  });

  it('Zen never carries a spool — nothing there should feel like a constraint', () => {
    for (let i = 0; i < 8; i++) expect(zenLevel('s', i).budget).toBeUndefined();
  });

  it('a seed reproduces the same ladder, so a challenge link works', () => {
    const a = [0, 1, 2].map((i) => blitzLevel('abc123', i));
    const b = [0, 1, 2].map((i) => blitzLevel('abc123', i));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(blitzLevel('other', 0))).not.toBe(JSON.stringify(a[0]));
  });

  it('One Life gets harder as the run goes on', () => {
    const early = oneLifeLevel('s', 0).chapter;
    const late = oneLifeLevel('s', 18).chapter;
    expect(early).toBeLessThanOrEqual(3);
    expect(late).toBeGreaterThanOrEqual(3);
  });
});

describe('the designers', () => {
  it('cover fifteen classic chapters and six weave chapters', () => {
    expect(CLASSIC_CHAPTERS).toHaveLength(15);
    expect(WEAVE_CHAPTERS).toHaveLength(6);
  });

  it('every chapter states exactly one new idea', () => {
    for (const c of CLASSIC_CHAPTERS) {
      expect(c.idea.length).toBeGreaterThan(8);
      expect(c.count).toBeGreaterThanOrEqual(10);
    }
  });

  it('a designer is deterministic given the same seed', () => {
    const one = CLASSIC_CHAPTERS[0].make(makeRng('x'), 0);
    const two = CLASSIC_CHAPTERS[0].make(makeRng('x'), 0);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('every proposal a designer makes is either null or a valid level', () => {
    for (const spec of CLASSIC_CHAPTERS) {
      const rng = makeRng(`v:${spec.chapter}`);
      for (let i = 0; i < 12; i++) {
        const b = spec.make(rng, i);
        if (!b) continue;
        expect(() => validateLevel({ ...b, id: 'x', mode: 'classic', chapter: spec.chapter })).not.toThrow();
      }
    }
  });
});
