/**
 * The level quality gate. Six checks; no level ships without passing all of
 * them. This is the machinery that stops the content being repetitive or
 * broken, and it runs both in CI and client-side in the Workshop, so a shared
 * level is guaranteed solvable.
 */

import type { Pt } from './geometry.js';
import { selfCrossings, mutualCrossings, segmentHitsDisc, pointSegmentDistance } from './geometry.js';
import {
  type Level, type Mechanic, deriveTarget, mechanicsOf, parLength, cycleLength,
  isPortalEdge, validateLevel, effectiveLoop,
} from './level.js';
import {
  makeRaster, rasterizeLoop, similarity, topology, symmetryGroup, signature,
  signatureDistance, coverage, isHairlineDifference, type Raster,
} from './region.js';
import {
  cycleLegal, canAdd, canClose, initialState, evaluate, THORN_RADIUS, WIN_THRESHOLD,
} from './rules.js';
import {
  findMatchingCycles, nearMisses, greedySolves, decoyCount,
} from './solver.js';
import { estimateDifficulty } from './difficulty.js';

export type CheckName =
  | 'solvable' | 'derived-target' | 'uniqueness' | 'threshold' | 'mechanics' | 'repetition';

export type CheckResult = { name: CheckName; pass: boolean; detail: string };

export type LevelReport = {
  id: string;
  chapter: number;
  mode: string;
  mechanics: Mechanic[];
  checks: CheckResult[];
  pass: boolean;
  worstNearMiss: number;
  /** A strictly shorter cycle that also matches, when one was found. */
  shorterCycle?: number[];
  par: number;
  matches: number;
  holes: number;
  symmetry: string;
  difficulty: number;
  stars: number;
};

export type GateOpts = {
  /** Wall-clock budget for the cycle search, per level. */
  budgetMs?: number;
  /** Skip the expensive uniqueness search (used by the fast Workshop check). */
  quick?: boolean;
  /** Stop at the first failing check. The build sets this; `validate` does not,
   *  because a full report of everything wrong is more useful than the first. */
  stopOnFail?: boolean;
};

/** Where a rail peg starts: the far end of its rail from the solution position. */
export function initialRailPos(level: Level, peg: number): [number, number] | null {
  const rail = level.rails?.find((r) => r.peg === peg);
  if (!rail) return null;
  const home = level.pegs[peg];
  const da = Math.hypot(rail.a[0] - home[0], rail.a[1] - home[1]);
  const db = Math.hypot(rail.b[0] - home[0], rail.b[1] - home[1]);
  return da >= db ? [...rail.a] as [number, number] : [...rail.b] as [number, number];
}

const scratch = makeRaster();

function rasterOf(level: Level, sol: readonly number[]): Raster {
  scratch.fill(0);
  rasterizeLoop(effectiveLoop(level, sol.map((i) => level.pegs[i] as Pt)), 1, scratch);
  return scratch;
}

// ---------------------------------------------------------------------------
// 1. Solvable
// ---------------------------------------------------------------------------

function checkSolvable(level: Level): CheckResult {
  for (let t = 0; t < level.threads.length; t++) {
    if (!cycleLegal(level, level.threads[t].sol, t)) {
      return { name: 'solvable', pass: false, detail: `thread ${t}'s authored solution is not legal` };
    }
  }
  // And playing it through really wins, under every rule at once.
  const state = initialState(level);
  for (let t = 0; t < level.threads.length; t++) {
    state.active = t;
    for (const p of level.threads[t].sol) {
      if (!canAdd(level, state, p).ok) {
        return { name: 'solvable', pass: false, detail: `thread ${t} cannot reach peg ${p}` };
      }
      state.threads[t].pegs.push(p);
    }
    if (!canClose(level, state).ok) {
      return { name: 'solvable', pass: false, detail: `thread ${t} cannot be tied off` };
    }
    state.threads[t].closed = true;
  }
  const target = deriveTarget(level);
  const over = new Set<number>();
  level.threads.forEach((th) => th.over?.forEach((i) => over.add(i)));
  const e = evaluate(level, state, target.raster, over);
  if (!e.win) {
    return { name: 'solvable', pass: false, detail: `playing the solution does not win (${e.fault}, ${e.similarity.toFixed(4)})` };
  }
  return { name: 'solvable', pass: true, detail: `solved at ${e.similarity.toFixed(3)}` };
}

// ---------------------------------------------------------------------------
// 2. Target derived from the solution
// ---------------------------------------------------------------------------

function checkDerivedTarget(level: Level): CheckResult {
  const d = deriveTarget(level);
  const cov = coverage(d.raster);
  if (cov < 0.02) {
    return { name: 'derived-target', pass: false, detail: `target covers only ${(cov * 100).toFixed(1)}% of the board` };
  }
  if (cov > 0.72) {
    return { name: 'derived-target', pass: false, detail: `target covers ${(cov * 100).toFixed(1)}% — too close to the whole board` };
  }
  // Levels never carry an authored target; the type has no field for one.
  if ('targetRaster' in (level as unknown as Record<string, unknown>)) {
    return { name: 'derived-target', pass: false, detail: 'a target was authored by hand' };
  }
  return { name: 'derived-target', pass: true, detail: `${(cov * 100).toFixed(1)}% coverage, ${d.holes} hole(s)` };
}

// ---------------------------------------------------------------------------
// 3. Uniqueness / fairness
// ---------------------------------------------------------------------------

function checkUniqueness(
  level: Level,
  opts: GateOpts,
): { result: CheckResult; matches: number; shorter?: number[] } {
  if (opts.quick || level.threads.length > 1) {
    return {
      result: { name: 'uniqueness', pass: true, detail: 'skipped (multi-thread or quick mode)' },
      matches: 1,
    };
  }
  const target = deriveTarget(level).raster;
  const sol = level.threads[0].sol;
  const distinct = new Set(sol).size;
  const maxVisits = distinct === sol.length ? 1 : 2;
  const solLen = cycleLength(level, sol);

  // Check 1 already proved the intended solution matches, so the only question
  // left is whether something SHORTER also matches. Bounding the search to
  // strictly shorter cycles asks exactly that question and prunes everything
  // else, which is what makes the check affordable on keyhole levels where a
  // peg may be visited twice.
  const budget = (opts.budgetMs ?? 2000) * (maxVisits > 1 ? 3 : 1);
  const { matches, exhausted, examined } = findMatchingCycles(level, target, {
    budgetMs: budget,
    maxLen: sol.length + 1,
    maxLength: solLen - 0.02,
    maxVisits,
    maxRepeats: sol.length - distinct,
    limit: 8,
  });

  if (matches.length > 0) {
    const best = matches[0];
    return {
      result: {
        name: 'uniqueness',
        pass: false,
        detail: `a shorter cycle (${best.length.toFixed(1)} vs ${solLen.toFixed(1)}) also matches: ${best.sol.join('-')}`,
      },
      matches: matches.length,
      shorter: best.sol,
    };
  }
  return {
    result: {
      name: 'uniqueness',
      pass: true,
      detail: exhausted
        ? `no shorter cycle exists (${examined} cycles examined)`
        : `no shorter cycle found in ${budget} ms (${examined} examined)`,
    },
    matches: 1,
  };
}

// ---------------------------------------------------------------------------
// 4. Threshold safety
// ---------------------------------------------------------------------------

/**
 * Generate every near-miss of the solution — drop one peg, swap two adjacent,
 * substitute each peg for each unused peg, insert one extra — and ask whether
 * any of them would be ACCEPTED as a win under the level's full rules.
 *
 * In the prototype the worst near-miss scored 0.9885, which sailed past a
 * 0.975 threshold: a hexagonal hole and a pentagonal hole counted as the same
 * shape. The threshold is 0.995, and a correct solve scores exactly 1.000
 * because the player's polygon uses identical peg coordinates.
 *
 * Asking "would it win" rather than "what does it score" is what makes this
 * correct on gold levels, where skipping the gold peg leaves the shape
 * untouched and it is the gold rule, not the shape, that rejects it.
 */
function checkThreshold(level: Level): { result: CheckResult; worst: number } {
  if (level.threads.length > 1) {
    return {
      result: { name: 'threshold', pass: true, detail: 'multi-thread: shape is checked per thread' },
      worst: 0,
    };
  }
  const target = deriveTarget(level).raster;
  const sol = level.threads[0].sol;
  let worst = 0;
  let worstSol: number[] | null = null;
  let accepted: number[] | null = null;

  const targetPrint = deriveTarget(level).raster;
  for (const c of nearMisses(level, sol)) {
    if (!cycleLegal(level, c)) continue; // a cycle the player cannot even make
    // A cycle that draws the same PICTURE is not a near miss — it is a second
    // correct answer, and check 3 is what governs those. Two cases: an exact
    // re-ordering (reversing a three-peg inner ring gives the same triangle),
    // and a keyhole cut at a different spoke, which leaves a slit one or two
    // cells wide that no player could see.
    if (isHairlineDifference(rasterOf(level, c), targetPrint)) continue;
    const state = initialState(level);
    state.threads[0].pegs = [...c];
    state.threads[0].closed = true;
    const e = evaluate(level, state, target);
    if (e.win) {
      accepted = c;
      worst = Math.max(worst, e.similarity);
      break;
    }
    // Only count it as a near miss if the SHAPE is what kept it out.
    if (e.fault === 'shape' && e.similarity > worst) {
      worst = e.similarity;
      worstSol = c;
    }
  }

  if (accepted) {
    return {
      result: {
        name: 'threshold',
        pass: false,
        detail: `near miss ${accepted.join('-')} would be accepted as a win`,
      },
      worst,
    };
  }
  return {
    result: {
      name: 'threshold',
      pass: true,
      detail: `worst near miss ${worst.toFixed(4)}${worstSol ? ` (${worstSol.join('-')})` : ''}`,
    },
    worst,
  };
}

// ---------------------------------------------------------------------------
// 5. Mechanics are load-bearing
// ---------------------------------------------------------------------------

/** Every declared mechanic must actually constrain the level. */
function checkMechanics(level: Level): CheckResult {
  const mechanics = mechanicsOf(level);
  const problems: string[] = [];
  const target = deriveTarget(level);
  const sol = level.threads[0].sol;
  const pts = (i: number) => level.pegs[i] as Pt;

  for (const m of mechanics) {
    switch (m) {
      case 'loop':
        break;

      case 'post': {
        // At least one shortcut chord between solution pegs must be blocked,
        // or the posts are decoration.
        let blocked = 0;
        const used = [...new Set(level.threads.flatMap((t) => t.sol))];
        for (let i = 0; i < used.length; i++) {
          for (let j = i + 1; j < used.length; j++) {
            for (const [px, py, r] of level.posts!) {
              if (segmentHitsDisc(pts(used[i]), pts(used[j]), [px, py], r)) blocked++;
            }
          }
        }
        if (blocked === 0) problems.push('no chord between solution pegs is blocked by a post');
        break;
      }

      case 'thorn': {
        let blocked = 0;
        const used = [...new Set(level.threads.flatMap((t) => t.sol))];
        for (let i = 0; i < used.length; i++) {
          for (let j = i + 1; j < used.length; j++) {
            for (const ti of level.thorn!) {
              const p = pts(ti);
              const a = pts(used[i]);
              const b = pts(used[j]);
              if (p === a || p === b) continue;
              if (pointSegmentDistance(p, a, b) < THORN_RADIUS) blocked++;
            }
          }
        }
        if (blocked === 0) problems.push('no chord is guarded by a thorn');
        break;
      }

      case 'gold': {
        // A gold peg only means something if the shape could be made without it.
        let skippable = false;
        for (const g of level.gold!) {
          const without = sol.filter((p) => p !== g);
          if (without.length < 3) continue;
          if (similarity(rasterOf(level, without), target.raster) >= WIN_THRESHOLD) skippable = true;
        }
        if (!skippable) problems.push('every gold peg is required by the shape anyway');
        break;
      }

      case 'budget': {
        // A same-region loop — one that looks like the answer — must exceed
        // the budget, otherwise the spool never bites. The search has to run
        // on a budget-free copy of the level, because otherwise the very rule
        // being tested prunes away the evidence for it.
        const unbudgeted: Level = { ...level };
        delete unbudgeted.budget;
        const found = findMatchingCycles(unbudgeted, target.raster, {
          budgetMs: 500,
          maxLen: sol.length + 2,
          maxLength: level.budget! * 1.9,
          tolerance: 0.9,
          limit: 24,
        });
        const tempting = found.matches.filter((c) => c.length > level.budget! + 1e-6);
        if (tempting.length === 0) {
          problems.push('no same-region loop exceeds the budget');
        }
        break;
      }

      case 'cross': {
        const n = selfCrossings(sol.map(pts), true).length;
        if (n === 0) problems.push('allowCross is set but the solution never crosses itself');
        break;
      }

      case 'keyhole':
        if (target.holes === 0) problems.push('a peg is revisited but the target has no hole');
        break;

      case 'portal': {
        let used = false;
        for (const t of level.threads) {
          for (let i = 0; i < t.sol.length; i++) {
            if (isPortalEdge(level, t.sol[i], t.sol[(i + 1) % t.sol.length])) used = true;
          }
        }
        if (!used) problems.push('portals exist but the solution never travels through one');
        break;
      }

      case 'rail': {
        // The peg must start somewhere that does NOT solve the level, or
        // sliding it is pointless.
        let mustMove = false;
        for (const rail of level.rails!) {
          const start = initialRailPos(level, rail.peg);
          if (!start) continue;
          const moved = level.pegs.map((p, i) => (i === rail.peg ? start : p));
          const shifted: Level = { ...level, pegs: moved as [number, number][] };
          if (similarity(rasterOf(shifted, sol), target.raster) < WIN_THRESHOLD) mustMove = true;
        }
        if (!mustMove) problems.push('the rail peg already sits where the answer needs it');
        break;
      }

      case 'fog':
        if (decoyCount(level, sol, target.raster) === 0) {
          problems.push('fog with no plausible alternative — nothing to deduce');
        }
        break;

      case 'mirror': {
        const axis = level.mirror!;
        const orig = sol.map(pts);
        const flipped = orig.map((p) => (axis === 'x' ? [100 - p[0], p[1]] : [p[0], 100 - p[1]]) as Pt);
        const same = orig.every((p, i) => Math.abs(p[0] - flipped[i][0]) < 0.5 && Math.abs(p[1] - flipped[i][1]) < 0.5);
        if (same) problems.push('the loop is already symmetric, so mirroring changes nothing');
        break;
      }

      case 'rotate': {
        // The rotation only asks anything of the player if the drawn target
        // really does differ from the region they must thread.
        const drawn = makeRaster();
        for (let t = 0; t < target.loops.length; t++) rasterizeLoop(target.loops[t], 1 << t, drawn);
        if (similarity(drawn, target.raster) >= 0.92) {
          problems.push('the target is near rotation-invariant, so the rotation is invisible');
        }
        break;
      }

      case 'multi':
        if (level.threads.length < 2) problems.push('multi declared with one thread');
        break;

      case 'weave': {
        const loops = level.threads.map((t) => t.sol.map(pts));
        let crossings = 0;
        for (let i = 0; i < loops.length; i++) {
          crossings += selfCrossings(loops[i], true).length;
          for (let j = i + 1; j < loops.length; j++) {
            crossings += mutualCrossings(loops[i], loops[j], true, true).length;
          }
        }
        if (crossings === 0) problems.push('weave declared but nothing crosses');
        break;
      }

      case 'blend': {
        let overlap = 0;
        for (let i = 0; i < target.raster.length; i++) {
          const v = target.raster[i];
          if (v !== 0 && (v & (v - 1)) !== 0) overlap++;
        }
        if (overlap < 40) problems.push('blend declared but the regions barely overlap');
        break;
      }
    }
  }

  if (level.allowCross && !mechanics.includes('cross')) {
    // allowCross earns its place three ways: the loop crosses itself, it
    // revisits a peg (a keyhole, where it also tells the gesture layer that
    // returning to the start is a move), or two threads cross each other.
    const revisits = level.threads.some((t) => new Set(t.sol).size !== t.sol.length);
    let mutual = 0;
    const loops = level.threads.map((t) => t.sol.map(pts));
    for (let i = 0; i < loops.length; i++) {
      for (let j = i + 1; j < loops.length; j++) mutual += mutualCrossings(loops[i], loops[j], true, true).length;
    }
    if (!revisits && mutual === 0) {
      problems.push('allowCross is set but nothing crosses and no peg is revisited');
    }
  }

  if (level.apart) {
    // "Stay apart" is only a rule if crossing was tempting in the first place.
    const loops = level.threads.map((t) => t.sol.map(pts));
    let near = false;
    for (let i = 0; i < loops.length && !near; i++) {
      for (let j = i + 1; j < loops.length && !near; j++) {
        for (const a of loops[i]) {
          for (const b of loops[j]) {
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 30) near = true;
          }
        }
      }
    }
    if (!near) problems.push('apart declared but the threads are nowhere near each other');
  }

  return {
    name: 'mechanics',
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `${mechanics.join(', ')} all load-bearing`,
  };
}

// ---------------------------------------------------------------------------
// 6. Anti-repetition
// ---------------------------------------------------------------------------

export type Fingerprint = {
  id: string;
  chapter: number;
  mode: string;
  index: number;
  mechanics: string;
  topo: string;
  sig: Uint8Array;
  raster: Raster;
};

export function fingerprint(level: Level, index: number): Fingerprint {
  const d = deriveTarget(level);
  const t = topology(d.raster);
  const crossings = selfCrossings(level.threads[0].sol.map((i) => level.pegs[i] as Pt), true).length;
  // How the loops are shaped, not just how many pegs there are: two rings of
  // four is a structurally different puzzle from one of three and one of five.
  const threadShape = level.threads.map((th) => th.sol.length).sort((x, y) => x - y).join('-');
  return {
    id: level.id,
    chapter: level.chapter,
    mode: level.mode,
    index,
    mechanics: mechanicsOf(level).sort().join('+'),
    // peg count, holes, crossings, symmetry group and loop shape
    topo: `${level.pegs.length}/${t.holes}/${crossings}/${symmetryGroup(d.raster)}/${threadShape}`,
    sig: signature(d.raster),
    raster: new Uint8Array(d.raster),
  };
}

export type RepetitionIssue = { a: string; b: string; reason: string };

/**
 * Compare every level against every other by target region similarity,
 * mechanic tuple, and peg-count/topology signature. A pair scoring above 0.90
 * on all three fails. Levels sharing a topology signature must also be at
 * least 5 apart, so a chapter cannot feel like the same level four times.
 */
export function auditRepetition(prints: Fingerprint[]): RepetitionIssue[] {
  const issues: RepetitionIssue[] = [];
  for (let i = 0; i < prints.length; i++) {
    for (let j = i + 1; j < prints.length; j++) {
      const a = prints[i];
      const b = prints[j];
      const sameMech = a.mechanics === b.mechanics;
      const sameTopo = a.topo === b.topo;
      if (sameMech && sameTopo) {
        const sim = similarity(a.raster, b.raster);
        if (sim > 0.90) {
          issues.push({ a: a.id, b: b.id, reason: `region ${sim.toFixed(3)}, same mechanics and topology` });
          continue;
        }
        // Coarse-signature backstop: near-identical silhouettes at a glance.
        if (signatureDistance(a.sig, b.sig) < 0.035) {
          issues.push({ a: a.id, b: b.id, reason: 'near-identical silhouette, same mechanics and topology' });
          continue;
        }
      }
      if (sameTopo && a.mode === b.mode && Math.abs(a.index - b.index) < 5) {
        issues.push({
          a: a.id, b: b.id,
          reason: `same topology signature ${a.topo} only ${Math.abs(a.index - b.index)} levels apart`,
        });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Running the gate
// ---------------------------------------------------------------------------

/** Checks 1-5 for a single level. Repetition is a set-level property. */
export function checkLevel(level: Level, opts: GateOpts = {}): LevelReport {
  validateLevel(level);
  const checks: CheckResult[] = [];
  const d = deriveTarget(level);
  let uniq: { result: CheckResult; matches: number; shorter?: number[] } = {
    result: { name: 'uniqueness', pass: true, detail: 'not reached' }, matches: 0,
  };
  let thr: { result: CheckResult; worst: number } = {
    result: { name: 'threshold', pass: true, detail: 'not reached' }, worst: 0,
  };

  // Ordered cheapest first and short-circuited when `stopOnFail` is set, so a
  // build that proposes thousands of candidates never pays for the expensive
  // cycle search on one that was already going to be rejected.
  const stop = opts.stopOnFail ?? false;
  const run = (c: CheckResult): boolean => {
    checks.push(c);
    return c.pass || !stop;
  };

  run(checkSolvable(level)) &&
    run(checkDerivedTarget(level)) &&
    run(checkMechanics(level)) &&
    (() => {
      thr = checkThreshold(level);
      return run(thr.result);
    })() &&
    (() => {
      uniq = checkUniqueness(level, opts);
      return run(uniq.result);
    })();

  const diff = estimateDifficulty(level, d.raster);
  return {
    id: level.id,
    chapter: level.chapter,
    mode: level.mode,
    mechanics: mechanicsOf(level),
    checks,
    pass: checks.every((c) => c.pass),
    worstNearMiss: thr.worst,
    shorterCycle: uniq.shorter,
    par: parLength(level),
    matches: uniq.matches,
    holes: d.holes,
    symmetry: d.symmetry,
    difficulty: diff.b,
    stars: diff.stars,
  };
}

export type GateReport = {
  levels: LevelReport[];
  repetition: RepetitionIssue[];
  pass: boolean;
};

export function runGate(levels: Level[], opts: GateOpts = {}): GateReport {
  const reports = levels.map((l) => checkLevel(l, opts));
  const byMode = new Map<string, Level[]>();
  for (const l of levels) {
    const arr = byMode.get(l.mode) ?? [];
    arr.push(l);
    byMode.set(l.mode, arr);
  }
  const prints: Fingerprint[] = [];
  for (const [, arr] of byMode) arr.forEach((l, i) => prints.push(fingerprint(l, i)));
  const repetition = auditRepetition(prints);
  return {
    levels: reports,
    repetition,
    pass: reports.every((r) => r.pass) && repetition.length === 0,
  };
}

/** The fast check the Workshop runs before a level can be shared. */
export function quickCheck(level: Level): { ok: boolean; problems: string[] } {
  try {
    const r = checkLevel(level, { quick: true, budgetMs: 300 });
    return { ok: r.pass, problems: r.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`) };
  } catch (e) {
    return { ok: false, problems: [(e as Error).message] };
  }
}

export function greedyEasy(level: Level): boolean {
  return greedySolves(level, deriveTarget(level).raster);
}
