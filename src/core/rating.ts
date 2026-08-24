/**
 * The Thread Score.
 *
 * Read this before touching anything below. A puzzle game cannot measure IQ.
 * IQ tests are norm-referenced instruments standardised on thousands of people
 * across many item types, and their validity rests entirely on that norming. A
 * score from one visuospatial task, on a self-selected population, with no
 * supervision, is not an IQ. So this file builds the most statistically
 * defensible ability estimate it can, reports it on a familiar 100/15 scale,
 * and the UI names it "Thread Score" with the subtitle
 * "an IQ-style scale — not a clinical IQ test".
 */

import { clamp } from './difficulty.js';

export const DISCLAIMER =
  'This is a measure of how you play Thread, on an IQ-style scale. It is not a clinical IQ test.';

export type ItemParams = {
  id: string;
  /** difficulty */
  b: number;
  /** discrimination */
  a: number;
  /** which mechanic family this item samples */
  family: string;
};

/** Everything one assessment item records. */
export type ItemResult = {
  id: string;
  /** Solved on the FIRST closed loop — the correctness signal. */
  firstTry: boolean;
  /** optimal_length / player_length, 0..1 */
  optimality: number;
  /** Seconds before the first peg was touched. */
  planningMs: number;
  /** Milliseconds from first peg to close. */
  executionMs: number;
  /** Backtracks + undos + reties. */
  searchOps: number;
  /** Was this mechanic new to the player? */
  novel: boolean;
  /** Did they run out the 120 s cap? */
  timedOut: boolean;
};

export const WEIGHTS = {
  correctness: 0.40,
  optimality: 0.20,
  planning: 0.15,
  execution: 0.10,
  search: 0.10,
  transfer: 0.05,
} as const;

/** P(first-try solve | ability) under the two-parameter logistic model. */
export function pCorrect(theta: number, item: ItemParams): number {
  return 1 / (1 + Math.exp(-item.a * (theta - item.b)));
}

/** Log-likelihood of a response pattern at ability theta. */
export function logLikelihood(theta: number, items: ItemParams[], correct: boolean[]): number {
  let ll = 0;
  for (let i = 0; i < items.length; i++) {
    const p = clamp(pCorrect(theta, items[i]), 1e-6, 1 - 1e-6);
    ll += correct[i] ? Math.log(p) : Math.log(1 - p);
  }
  // Weak N(0,1) prior keeps all-right / all-wrong patterns from running to +-inf.
  ll += -0.5 * theta * theta * 0.15;
  return ll;
}

/** Maximum likelihood ability, found by a plain golden-section scan. */
export function estimateTheta(items: ItemParams[], correct: boolean[]): number {
  let best = -4;
  let bestLL = -Infinity;
  for (let t = -4; t <= 4; t += 0.02) {
    const ll = logLikelihood(t, items, correct);
    if (ll > bestLL) {
      bestLL = ll;
      best = t;
    }
  }
  return best;
}

/** Fisher information at theta — the basis of the confidence interval. */
export function testInformation(theta: number, items: ItemParams[]): number {
  let info = 0.15; // the prior contributes a little
  for (const it of items) {
    const p = pCorrect(theta, it);
    info += it.a * it.a * p * (1 - p);
  }
  return info;
}

export function standardError(theta: number, items: ItemParams[]): number {
  return 1 / Math.sqrt(Math.max(testInformation(theta, items), 1e-6));
}

/** z-score helper with a guard against a zero-variance item. */
export function z(value: number, mean: number, sd: number): number {
  if (!Number.isFinite(sd) || sd < 1e-6) return 0;
  return clamp((value - mean) / sd, -3, 3);
}

/** Reference distributions per signal, bootstrapped from playtest data. */
export type Norms = {
  planningMs: { mean: number; sd: number };
  executionLogMs: { mean: number; sd: number };
  searchOps: { mean: number; sd: number };
  optimality: { mean: number; sd: number };
};

export const DEFAULT_NORMS: Norms = {
  planningMs: { mean: 4200, sd: 3000 },
  executionLogMs: { mean: Math.log(14000), sd: 0.75 },
  searchOps: { mean: 3.2, sd: 2.6 },
  optimality: { mean: 0.86, sd: 0.14 },
};

export type Profile = {
  planning: number;
  precision: number;
  speed: number;
  spatial: number;
  learning: number;
};

/**
 * The continuous signals, folded together. Planning time is only rewarded when
 * the solve was first-try and near-optimal: a long pause followed by a bad
 * loop is hesitation, not planning, and must not score as thought.
 */
export function continuousResidual(
  results: ItemResult[],
  norms: Norms = DEFAULT_NORMS,
): { residual: number; profile: Profile } {
  if (results.length === 0) {
    return { residual: 0, profile: { planning: 0, precision: 0, speed: 0, spatial: 0, learning: 0 } };
  }
  let optimalitySum = 0;
  let planningSum = 0;
  let executionSum = 0;
  let searchSum = 0;
  let transferSum = 0;
  let transferN = 0;
  let correctSum = 0;

  for (const r of results) {
    correctSum += r.firstTry ? 1 : 0;
    optimalitySum += z(r.optimality, norms.optimality.mean, norms.optimality.sd);

    const planZ = z(r.planningMs, norms.planningMs.mean, norms.planningMs.sd);
    const thought = r.firstTry && r.optimality >= 0.9;
    planningSum += thought ? planZ : -Math.abs(planZ) * 0.5;

    const exZ = -z(Math.log(Math.max(r.executionMs, 1)), norms.executionLogMs.mean, norms.executionLogMs.sd);
    executionSum += clamp(exZ, -1.5, 1.5); // speed is deliberately capped

    searchSum += -z(r.searchOps, norms.searchOps.mean, norms.searchOps.sd);

    if (r.novel) {
      transferSum += (r.firstTry ? 1 : -1) * 1.0;
      transferN++;
    }
  }

  const n = results.length;
  const profile: Profile = {
    planning: planningSum / n,
    precision: optimalitySum / n,
    speed: executionSum / n,
    spatial: (correctSum / n) * 2 - 1,
    learning: transferN ? transferSum / transferN : 0,
  };

  const residual =
    WEIGHTS.optimality * profile.precision +
    WEIGHTS.planning * profile.planning +
    WEIGHTS.execution * profile.speed +
    WEIGHTS.search * (searchSum / n) +
    WEIGHTS.transfer * profile.learning;

  // Bounded so the continuous signals refine correctness but never dominate it.
  return { residual: clamp(residual, -0.5, 0.5), profile };
}

export type ScoreReport = {
  theta: number;
  score: number;
  /** Half-width of the 68% interval, on the score scale. */
  margin: number;
  profile: Profile;
  percentile: number;
  itemsSeen: number;
};

/** The whole model, end to end. */
export function scoreAssessment(
  items: ItemParams[],
  results: ItemResult[],
  norms: Norms = DEFAULT_NORMS,
): ScoreReport {
  const correct = results.map((r) => r.firstTry && !r.timedOut);
  const thetaIRT = estimateTheta(items, correct);
  const { residual, profile } = continuousResidual(results, norms);
  const theta = clamp(thetaIRT + residual, -3.5, 3.5);
  const se = standardError(thetaIRT, items);
  return {
    theta,
    score: Math.round(100 + 15 * theta),
    margin: Math.max(3, Math.round(15 * se)),
    profile,
    percentile: Math.round(normalCdf(theta) * 100),
    itemsSeen: results.length,
  };
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * Adaptive item selection: after each item, take the unplayed item whose
 * difficulty sits closest to the running estimate, preferring families the
 * player has not been tested on yet so no single skill dominates the score.
 */
export function nextItem(
  pool: ItemParams[],
  playedIds: ReadonlySet<string>,
  seenFamilies: ReadonlySet<string>,
  theta: number,
): ItemParams | null {
  let best: ItemParams | null = null;
  let bestCost = Infinity;
  for (const it of pool) {
    if (playedIds.has(it.id)) continue;
    const familyBonus = seenFamilies.has(it.family) ? 0.55 : 0;
    const cost = Math.abs(it.b - theta) + familyBonus;
    if (cost < bestCost) {
      bestCost = cost;
      best = it;
    }
  }
  return best;
}

/** A hidden estimate updated silently by casual play; never shown as a score. */
export function updateHiddenAbility(prior: number, item: ItemParams, solvedFirstTry: boolean): number {
  const p = pCorrect(prior, item);
  const gain = 0.18 * item.a;
  return clamp(prior + gain * ((solvedFirstTry ? 1 : 0) - p), -3.5, 3.5);
}
