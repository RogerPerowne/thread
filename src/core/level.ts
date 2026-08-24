/**
 * The Level type, its runtime validator, and the derived data the game needs.
 * Targets are always DERIVED from the authored solution (never authored by
 * hand), so a level cannot be impossible by construction.
 */

import type { Pt } from './geometry.js';
import { rotateAboutCentre, mirrorPoint } from './geometry.js';
import { makeRaster, rasterizeLoop, type Raster, topology, symmetryGroup, signature } from './region.js';

export type Mode = 'classic' | 'weave' | 'daily' | 'blitz' | 'onelife' | 'zen' | 'assess';

export type ThreadSpec = {
  color: string;
  /** Peg indices, in order. The loop closes from the last back to the first. */
  sol: number[];
  /** For weave levels: crossing indices where THIS thread passes over. */
  over?: number[];
};

export type Level = {
  id: string;
  mode: Mode;
  chapter: number;
  name?: string;
  pegs: [number, number][];
  posts?: [number, number, number][];
  rails?: { peg: number; a: [number, number]; b: [number, number] }[];
  portals?: [number, number][];
  gold?: number[];
  thorn?: number[];
  allowCross?: boolean;
  apart?: boolean;
  weave?: boolean;
  fog?: boolean;
  mirror?: 'x' | 'y' | null;
  rotateTarget?: 0 | 90 | 180 | 270;
  budget?: number;
  threads: ThreadSpec[];
  /** Marks a level as an unusually beautiful shape — roughly 1 in 15. */
  gem?: boolean;
};

export const MECHANICS = [
  'loop', 'budget', 'cross', 'keyhole', 'post', 'gold', 'thorn',
  'multi', 'weave', 'blend', 'portal', 'rail', 'fog', 'mirror', 'rotate',
] as const;
export type Mechanic = (typeof MECHANICS)[number];

/** Which mechanics a level actually declares. Used by the gate and by the
 *  assessment's mechanic-family sampling. */
export function mechanicsOf(level: Level): Mechanic[] {
  const m = new Set<Mechanic>(['loop']);
  if (level.budget !== undefined) m.add('budget');
  if (level.allowCross) m.add('cross');
  if (level.posts?.length) m.add('post');
  if (level.gold?.length) m.add('gold');
  if (level.thorn?.length) m.add('thorn');
  if (level.portals?.length) m.add('portal');
  if (level.rails?.length) m.add('rail');
  if (level.fog) m.add('fog');
  if (level.mirror) m.add('mirror');
  if (level.rotateTarget) m.add('rotate');
  if (level.threads.length > 1) m.add('multi');
  if (level.weave) m.add('weave');
  if (level.threads.length > 1 && blendPossible(level)) m.add('blend');
  for (const t of level.threads) if (hasRepeatedPeg(t.sol)) m.add('keyhole');
  return [...m];
}

function hasRepeatedPeg(sol: number[]): boolean {
  return new Set(sol).size !== sol.length;
}

function blendPossible(level: Level): boolean {
  // A blend exists when two threads' regions overlap in the target.
  const t = deriveTarget(level);
  for (let i = 0; i < t.raster.length; i++) {
    const v = t.raster[i];
    if (v !== 0 && (v & (v - 1)) !== 0) return true; // more than one bit set
  }
  return false;
}

/** Board-space points of a thread's authored solution, portals applied. */
export function solutionPoints(level: Level, threadIndex: number): Pt[] {
  const t = level.threads[threadIndex];
  return t.sol.map((i) => level.pegs[i] as Pt);
}

export type DerivedTarget = {
  raster: Raster;
  /** Per-thread loops in board space, after mirror/rotation are applied. */
  loops: Pt[][];
  holes: number;
  components: number;
  symmetry: string;
  signature: Uint8Array;
};

const targetCache = new WeakMap<Level, DerivedTarget>();

/**
 * The target region, computed from the authored solution. `mirror` doubles the
 * loop across an axis; `rotateTarget` presents the same region turned, so the
 * player must recognise shape independent of orientation.
 */
export function deriveTarget(level: Level): DerivedTarget {
  const cached = targetCache.get(level);
  if (cached) return cached;

  const loops: Pt[][] = [];
  for (let i = 0; i < level.threads.length; i++) {
    loops.push(solutionPoints(level, i));
  }
  if (level.mirror) {
    const axis = level.mirror;
    const mirrored = loops.map((l) => l.map((p) => mirrorPoint(p, axis)));
    for (let i = 0; i < loops.length; i++) loops[i] = [...loops[i], ...mirrored[i].slice().reverse()];
  }

  const raster = makeRaster();
  const shown = loops.map((l) =>
    level.rotateTarget ? l.map((p) => rotateAboutCentre(p, level.rotateTarget!)) : l,
  );
  for (let t = 0; t < shown.length; t++) rasterizeLoop(shown[t], 1 << t, raster);

  const topo = topology(raster);
  const derived: DerivedTarget = {
    raster,
    loops: shown,
    holes: topo.holes,
    components: topo.components,
    symmetry: symmetryGroup(raster),
    signature: signature(raster),
  };
  targetCache.set(level, derived);
  return derived;
}

/**
 * Portals: entering one peg, the string emerges from its twin. The hop is a
 * real edge of the polygon — even-odd needs a closed chain to mean anything —
 * but it costs nothing against the spool and is drawn as a ghost, so routing
 * through a portal is a genuine shortcut rather than a free extra chord.
 */
export function isPortalEdge(level: Level, a: number, b: number): boolean {
  if (!level.portals?.length) return false;
  for (const [x, y] of level.portals) {
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}

/** Length of a peg cycle, with portal hops costing zero. */
export function cycleLength(level: Level, sol: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < sol.length; i++) {
    const a = sol[i];
    const b = sol[(i + 1) % sol.length];
    if (isPortalEdge(level, a, b)) continue;
    total += Math.hypot(
      level.pegs[a][0] - level.pegs[b][0],
      level.pegs[a][1] - level.pegs[b][1],
    );
  }
  return total;
}

/** Is `peg` one half of a portal pair? Returns the twin, or -1. */
export function portalTwin(level: Level, peg: number): number {
  if (!level.portals) return -1;
  for (const [a, b] of level.portals) {
    if (a === peg) return b;
    if (b === peg) return a;
  }
  return -1;
}

/** The shortest legal length of the intended solution — used for the third star. */
export function parLength(level: Level): number {
  let total = 0;
  for (const t of level.threads) total += cycleLength(level, t.sol);
  return total;
}

export class LevelError extends Error {}

/** Runtime validation. Throws loudly rather than shipping a broken level. */
export function validateLevel(level: unknown): Level {
  const l = level as Level;
  const fail = (msg: string): never => {
    throw new LevelError(`level ${(l && l.id) || '<no id>'}: ${msg}`);
  };
  if (!l || typeof l !== 'object') fail('not an object');
  if (typeof l.id !== 'string' || !l.id) fail('missing id');
  if (!Array.isArray(l.pegs) || l.pegs.length < 3) fail('needs at least 3 pegs');
  l.pegs.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) fail(`peg ${i} malformed`);
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) fail(`peg ${i} not finite`);
    if (p[0] < 0 || p[0] > 100 || p[1] < 0 || p[1] > 100) fail(`peg ${i} outside board space`);
  });
  if (!Array.isArray(l.threads) || l.threads.length === 0) fail('needs at least one thread');
  if (l.threads.length > 4) fail('at most 4 threads');
  l.threads.forEach((t, ti) => {
    if (!Array.isArray(t.sol) || t.sol.length < 3) fail(`thread ${ti} solution needs 3+ pegs`);
    t.sol.forEach((p) => {
      if (!Number.isInteger(p) || p < 0 || p >= l.pegs.length) fail(`thread ${ti} references peg ${p}`);
    });
    for (let i = 0; i < t.sol.length; i++) {
      if (t.sol[i] === t.sol[(i + 1) % t.sol.length]) fail(`thread ${ti} repeats peg ${t.sol[i]} back-to-back`);
    }
    if (typeof t.color !== 'string') fail(`thread ${ti} missing colour`);
  });
  for (const key of ['gold', 'thorn'] as const) {
    const arr = l[key];
    if (arr) {
      if (!Array.isArray(arr)) fail(`${key} must be an array`);
      arr.forEach((p) => {
        if (!Number.isInteger(p) || p < 0 || p >= l.pegs.length) fail(`${key} references peg ${p}`);
      });
    }
  }
  if (l.thorn && l.gold) {
    for (const t of l.thorn) if (l.gold.includes(t)) fail(`peg ${t} is both gold and thorn`);
  }
  if (l.portals) {
    for (const pair of l.portals) {
      if (!Array.isArray(pair) || pair.length !== 2) fail('portal pair malformed');
      if (pair[0] === pair[1]) fail('portal linked to itself');
      for (const p of pair) if (!Number.isInteger(p) || p < 0 || p >= l.pegs.length) fail(`portal references peg ${p}`);
    }
  }
  if (l.rails) {
    for (const r of l.rails) {
      if (!Number.isInteger(r.peg) || r.peg < 0 || r.peg >= l.pegs.length) fail(`rail references peg ${r.peg}`);
    }
  }
  if (l.budget !== undefined && (!Number.isFinite(l.budget) || l.budget <= 0)) fail('budget must be positive');
  if (l.budget !== undefined) {
    const par = parLength(l);
    if (par > l.budget + 1e-6) fail(`budget ${l.budget.toFixed(1)} is shorter than its own solution ${par.toFixed(1)}`);
  }
  if (l.thorn) {
    for (const t of l.threads) {
      for (const p of t.sol) if (l.thorn.includes(p)) fail(`solution uses thorn peg ${p}`);
    }
  }
  if (l.gold) {
    const used = new Set(l.threads.flatMap((t) => t.sol));
    for (const g of l.gold) if (!used.has(g)) fail(`gold peg ${g} is not on the solution`);
  }
  return l;
}

export function loadLevels(raw: unknown[]): Level[] {
  return raw.map((r) => validateLevel(r));
}
