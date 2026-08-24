import { describe, it, expect } from 'vitest';
import {
  pCorrect, estimateTheta, standardError, scoreAssessment, nextItem,
  continuousResidual, updateHiddenAbility, normalCdf,
  type ItemParams, type ItemResult,
} from '../../src/core/rating.js';
import { makeRng } from '../../src/core/rng.js';

const pool: ItemParams[] = Array.from({ length: 40 }, (_, i) => ({
  id: `i${i}`,
  b: -3 + (i / 39) * 6,
  a: 1.0 + ((i % 5) - 2) * 0.1,
  family: ['loop', 'cross', 'keyhole', 'post', 'budget', 'portal'][i % 6],
}));

/** A synthetic player of known ability, answering under the 2PL model. */
function simulate(trueTheta: number, items: ItemParams[], seed: string): ItemResult[] {
  const rng = makeRng(seed);
  return items.map((it) => {
    const firstTry = rng() < pCorrect(trueTheta, it);
    return {
      id: it.id,
      firstTry,
      optimality: firstTry ? 0.92 : 0.7,
      planningMs: firstTry ? 6000 : 2500,
      executionMs: 12000,
      searchOps: firstTry ? 2 : 6,
      novel: false,
      timedOut: false,
    };
  });
}

/** Run a full 12-item adaptive assessment against a known ability. */
function runAssessment(trueTheta: number, seed: string) {
  const played = new Set<string>();
  const families = new Set<string>();
  const items: ItemParams[] = [];
  const results: ItemResult[] = [];
  let theta = 0;
  for (let k = 0; k < 12; k++) {
    const it = nextItem(pool, played, families, theta);
    if (!it) break;
    played.add(it.id);
    families.add(it.family);
    items.push(it);
    const r = simulate(trueTheta, [it], `${seed}:${k}`)[0];
    results.push(r);
    theta = estimateTheta(items, results.map((x) => x.firstTry));
  }
  return scoreAssessment(items, results);
}

describe('2PL model', () => {
  it('P(correct) rises with ability and falls with difficulty', () => {
    const item: ItemParams = { id: 'x', b: 0, a: 1, family: 'loop' };
    expect(pCorrect(-2, item)).toBeLessThan(pCorrect(0, item));
    expect(pCorrect(0, item)).toBeLessThan(pCorrect(2, item));
    expect(pCorrect(0, item)).toBeCloseTo(0.5, 5);
  });
  it('a harder item is harder at the same ability', () => {
    expect(pCorrect(0, { id: 'a', b: 2, a: 1, family: 'loop' }))
      .toBeLessThan(pCorrect(0, { id: 'b', b: -2, a: 1, family: 'loop' }));
  });
});

describe('ability estimation', () => {
  it('recovers a known ability from synthetic players', () => {
    for (const trueTheta of [-1.5, -0.5, 0.5, 1.5]) {
      const errs: number[] = [];
      for (let run = 0; run < 40; run++) {
        errs.push(runAssessment(trueTheta, `t${trueTheta}r${run}`).theta - trueTheta);
      }
      const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
      expect(Math.abs(bias)).toBeLessThan(0.55); // shrinkage toward the prior is expected
    }
  });

  it('orders players correctly on average — the property that actually matters', () => {
    const mean = (t: number) => {
      let s = 0;
      for (let r = 0; r < 60; r++) s += runAssessment(t, `o${t}-${r}`).score;
      return s / 60;
    };
    const low = mean(-1.5);
    const mid = mean(0);
    const high = mean(1.5);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it('an all-correct pattern does not run away to infinity', () => {
    const items = pool.slice(0, 12);
    const t = estimateTheta(items, items.map(() => true));
    expect(t).toBeLessThan(4);
    expect(t).toBeGreaterThan(1);
  });

  it('the interval narrows as more items are answered', () => {
    const few = standardError(0, pool.slice(0, 4));
    const many = standardError(0, pool.slice(0, 12));
    expect(many).toBeLessThan(few);
  });
});

describe('the score scale', () => {
  it('is 100/15 and clamped', () => {
    const r = scoreAssessment(
      pool.slice(0, 12),
      pool.slice(0, 12).map((it) => ({
        id: it.id, firstTry: true, optimality: 1, planningMs: 6000,
        executionMs: 9000, searchOps: 0, novel: false, timedOut: false,
      })),
    );
    expect(r.score).toBeGreaterThan(100);
    expect(r.score).toBeLessThanOrEqual(Math.round(100 + 15 * 3.5));
    expect(r.margin).toBeGreaterThan(0);
    expect(r.percentile).toBeGreaterThanOrEqual(0);
    expect(r.percentile).toBeLessThanOrEqual(100);
  });
  it('reports a percentile consistent with the normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
  });
});

describe('the continuous signals', () => {
  const item = (over: Partial<ItemResult>): ItemResult => ({
    id: 'x', firstTry: true, optimality: 0.95, planningMs: 4200,
    executionMs: 14000, searchOps: 3, novel: false, timedOut: false, ...over,
  });

  it('rewards a long pause that ends in a clean first-try solve', () => {
    const thoughtful = continuousResidual([item({ planningMs: 12000, firstTry: true, optimality: 0.98 })]);
    const hasty = continuousResidual([item({ planningMs: 500, firstTry: true, optimality: 0.98 })]);
    expect(thoughtful.profile.planning).toBeGreaterThan(hasty.profile.planning);
  });

  it('but scores a long pause followed by a BAD loop as hesitation, not planning', () => {
    const hesitation = continuousResidual([item({ planningMs: 12000, firstTry: false, optimality: 0.6 })]);
    expect(hesitation.profile.planning).toBeLessThan(0);
  });

  it('is bounded so it can never outweigh correctness', () => {
    const best = continuousResidual(Array.from({ length: 12 }, () =>
      item({ optimality: 1, planningMs: 20000, executionMs: 500, searchOps: 0, novel: true })));
    expect(Math.abs(best.residual)).toBeLessThanOrEqual(0.5);
  });

  it('frantic tapping cannot beat careful thought', () => {
    const items = pool.slice(0, 12);
    // Fast but wrong on half the items.
    const frantic = scoreAssessment(items, items.map((it, i) => ({
      id: it.id, firstTry: i % 2 === 0, optimality: 0.7, planningMs: 200,
      executionMs: 2000, searchOps: 9, novel: false, timedOut: false,
    })));
    // Slow, deliberate, right every time.
    const careful = scoreAssessment(items, items.map((it) => ({
      id: it.id, firstTry: true, optimality: 0.97, planningMs: 9000,
      executionMs: 40000, searchOps: 1, novel: false, timedOut: false,
    })));
    expect(careful.score).toBeGreaterThan(frantic.score);
  });

  it('a timeout is never scored as correct', () => {
    const items = pool.slice(0, 12);
    const r = scoreAssessment(items, items.map((it) => ({
      id: it.id, firstTry: true, optimality: 1, planningMs: 3000,
      executionMs: 120000, searchOps: 0, novel: false, timedOut: true,
    })));
    expect(r.score).toBeLessThan(100);
  });
});

describe('adaptive selection', () => {
  it('picks the item closest to the running estimate', () => {
    const it = nextItem(pool, new Set(), new Set(pool.map((p) => p.family)), 1.0);
    expect(it).not.toBeNull();
    const others = pool.filter((p) => p.id !== it!.id);
    for (const o of others) {
      expect(Math.abs(it!.b - 1.0)).toBeLessThanOrEqual(Math.abs(o.b - 1.0) + 1e-9);
    }
  });
  it('prefers a family the player has not been tested on', () => {
    const seen = new Set(['loop']);
    const chosen = nextItem(pool, new Set(), seen, -3);
    expect(chosen!.family).not.toBe('loop');
  });
  it('never repeats an item', () => {
    const played = new Set(pool.slice(0, 39).map((p) => p.id));
    const it = nextItem(pool, played, new Set(), 0);
    expect(it!.id).toBe('i39');
    expect(nextItem(pool, new Set(pool.map((p) => p.id)), new Set(), 0)).toBeNull();
  });
});

describe('hidden ability from casual play', () => {
  it('drifts up on wins and down on losses, and stays bounded', () => {
    const item: ItemParams = { id: 'x', b: 0, a: 1, family: 'loop' };
    let t = 0;
    for (let i = 0; i < 50; i++) t = updateHiddenAbility(t, item, true);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(3.5);
    for (let i = 0; i < 200; i++) t = updateHiddenAbility(t, item, false);
    expect(t).toBeLessThan(0);
    expect(t).toBeGreaterThanOrEqual(-3.5);
  });
});

describe('determinism', () => {
  it('the same seed gives the same puzzle to every player in the world', () => {
    const a = makeRng('2026-08-24');
    const b = makeRng('2026-08-24');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    expect(makeRng('2026-08-25')()).not.toBe(makeRng('2026-08-24')());
  });
});
