/**
 * Static difficulty estimator. Computable with zero players, which is what
 * lets the assessment seed its IRT item difficulties before any telemetry
 * exists. Re-fit from live data once an item has >= 200 attempts.
 */

import type { Raster } from './region.js';
import { type Level, mechanicsOf, parLength } from './level.js';
import { branchingFactor, decoyCount, greedySolves } from './solver.js';

export type DifficultyBreakdown = {
  /** IRT difficulty parameter b, roughly -3 (trivial) .. +3 (brutal). */
  b: number;
  /** IRT discrimination a. Levels with many decoys separate players better. */
  a: number;
  depth: number;
  branching: number;
  decoys: number;
  greedy: boolean;
  mechanics: number;
  /** 1..5 for display. */
  stars: number;
};

/**
 * Weights are deliberately gentle: no single signal can dominate, because a
 * static estimate is a seed for the model, not a verdict.
 */
export function estimateDifficulty(level: Level, target: Raster): DifficultyBreakdown {
  const sol = level.threads[0].sol;
  const depth = level.threads.reduce((n, t) => n + t.sol.length, 0);
  const branching = branchingFactor(level, sol);
  const decoys = decoyCount(level, sol, target);
  const greedy = greedySolves(level, target);
  const mechanics = mechanicsOf(level).length;

  let b = -2.2;
  b += 0.22 * Math.max(0, depth - 3);          // longer solutions hold more in mind
  b += 0.16 * Math.max(0, branching - 3);      // more legal moves = a wider search
  b += 0.10 * Math.min(decoys, 12);            // near-misses that look right
  b += 0.42 * Math.max(0, mechanics - 1);      // each extra rule to juggle
  if (greedy) b -= 1.15;                       // walk to the nearest peg and you win
  if (level.allowCross) b += 0.45;             // even-odd reasoning is the hard part
  if (level.fog) b += 0.7;                     // deduction rather than vision
  if (level.rotateTarget) b += 0.35;
  if (level.mirror) b += 0.3;
  if (level.weave) b += 0.5;
  if (level.threads.length > 1) b += 0.3 * (level.threads.length - 1);
  if (level.budget !== undefined) {
    // A budget only bites when it is close to par.
    const slack = level.budget / Math.max(parLength(level), 1e-6);
    b += slack < 1.05 ? 0.6 : slack < 1.2 ? 0.35 : 0.1;
  }
  b = clamp(b, -3, 3);

  // Discrimination: levels with plausible wrong answers sort players best.
  const a = clamp(0.7 + 0.06 * Math.min(decoys, 10) + (greedy ? -0.15 : 0.15), 0.5, 2.0);

  return {
    b,
    a,
    depth,
    branching,
    decoys,
    greedy,
    mechanics,
    stars: Math.max(1, Math.min(5, Math.round((b + 3) / 1.2))),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
