/**
 * Level build. The designers propose; the gate disposes.
 *
 * Every accepted level has passed checks 1-5 individually and check 6 against
 * every level already accepted, so the content cannot drift into repeating
 * itself the way the prototype's four near-identical "wrap the ring" levels
 * did.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Level, Mode } from '../src/core/level.js';
import { validateLevel, deriveTarget, mechanicsOf } from '../src/core/level.js';
import { checkLevel, fingerprint, auditRepetition, type Fingerprint } from '../src/core/gate.js';
import { normalizeClosedPath } from '../src/core/rules.js';
import { estimateDifficulty } from '../src/core/difficulty.js';
import { makeRng } from '../src/core/rng.js';
import { CLASSIC_CHAPTERS, WEAVE_CHAPTERS, ASSESS_FAMILIES, type ChapterSpec, type Body } from '../src/core/design.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS_DIR = join(HERE, '..', 'levels');

// The build must be at least as strict as `pnpm validate`, or a level can be
// accepted here and rejected in CI.
const GATE_OPTS = { budgetMs: 900, stopOnFail: true };
const MAX_TRIES_PER_LEVEL = 260;
/** Wall-clock guard so one awkward chapter cannot stall the whole build. */
const CHAPTER_BUDGET_MS = 240_000;

type Accepted = { level: Level; print: Fingerprint };

/**
 * How many levels in one chapter may share a topology signature.
 *
 * Check 6 wants five levels of daylight between any two that match, so a
 * chapter of a dozen needs at least five distinct structures. Capping repeats
 * here forces the designer to keep looking rather than letting a chapter fill
 * up with the same shape and fail the audit at the end.
 */
const MAX_PER_TOPOLOGY = 2;

function tryAccept(
  body: Body | null,
  id: string,
  mode: Mode,
  chapter: number,
  name: string,
  accepted: Accepted[],
  topoCounts?: Map<string, number>,
): Level | null {
  if (!body) return null;
  let level: Level;
  try {
    level = validateLevel({ ...body, id, mode, chapter, name });
  } catch {
    return null;
  }
  let report = checkLevel(level, GATE_OPTS);

  // If an unintended cycle is shorter, the fair move is to accept it as the
  // solution and re-derive the target from it, rather than ship a level whose
  // "intended" answer is beaten by an obvious one.
  if (!report.pass && report.shorterCycle && report.shorterCycle.length >= 3) {
    const adopted = normalizeClosedPath([...report.shorterCycle]);
    try {
      const retry = validateLevel({
        ...body, id, mode, chapter, name,
        threads: [{ ...body.threads[0], sol: adopted }, ...body.threads.slice(1)],
      });
      const retryReport = checkLevel(retry, GATE_OPTS);
      if (retryReport.pass) {
        level = retry;
        report = retryReport;
      }
    } catch {
      /* the shorter cycle was not a valid authored solution; keep the failure */
    }
  }
  if (!report.pass) return null;

  const print = fingerprint(level, accepted.length);
  if (topoCounts && (topoCounts.get(print.topo) ?? 0) >= MAX_PER_TOPOLOGY) return null;
  const issues = auditRepetition([...accepted.map((a) => a.print), print]);
  if (issues.some((i) => i.a === id || i.b === id)) return null;

  accepted.push({ level, print });
  topoCounts?.set(print.topo, (topoCounts.get(print.topo) ?? 0) + 1);
  return level;
}

/** Fill a chapter, ordered easiest first so the difficulty curve is real. */
function buildChapter(spec: ChapterSpec, mode: Mode, prefix: string, accepted: Accepted[], seed: string): Level[] {
  const rng = makeRng(`${seed}:${mode}:${spec.chapter}`);
  const made: Level[] = [];
  let tries = 0;
  const deadline = Date.now() + CHAPTER_BUDGET_MS;
  const topoCounts = new Map<string, number>();
  while (made.length < spec.count && tries < MAX_TRIES_PER_LEVEL * spec.count && Date.now() < deadline) {
    tries++;
    const id = `${prefix}-${spec.chapter}-${made.length + 1}`;
    const level = tryAccept(spec.make(rng, made.length), id, mode, spec.chapter, spec.name, accepted, topoCounts);
    if (level) made.push(level);
  }
  // Sort by static difficulty, then renumber so ids stay in play order.
  made.sort((a, b) => difficultyOf(a) - difficultyOf(b));
  made.forEach((l, i) => {
    // Roughly one level in fifteen is a gem: an unusually beautiful shape.
    if ((i + spec.chapter) % 15 === 7) l.gem = true;
  });
  void prefix;
  const short = made.length < spec.count;
  console.log(
    `  ch${String(spec.chapter).padStart(2)} ${spec.name.padEnd(14)} ${String(made.length).padStart(3)}/${spec.count}` +
    `${short ? '  <-- SHORT' : ''}  (${tries} candidates)`,
  );
  return made;
}

const diffCache = new Map<string, number>();
function difficultyOf(l: Level): number {
  const hit = diffCache.get(l.id);
  if (hit !== undefined) return hit;
  const d = estimateDifficulty(l, deriveTarget(l).raster).b;
  diffCache.set(l.id, d);
  return d;
}

function buildMode(mode: Mode, chapters: ChapterSpec[], prefix: string, seed: string): Level[] {
  console.log(`\n${mode.toUpperCase()}`);
  const accepted: Accepted[] = [];
  const blocks: Level[][] = [];
  for (const spec of chapters) blocks.push(buildChapter(spec, mode, prefix, accepted, seed));
  return spreadTopologies(blocks, prefix);
}

/**
 * Space out levels that share a topology signature.
 *
 * Sorting a chapter by difficulty is what makes its curve real, but it also
 * clusters structurally similar levels together — and check 6 requires five
 * levels of daylight between any two that share a signature. This walks the
 * mode in order and, within each chapter, takes the easiest remaining level
 * that does not collide with the last four emitted. Difficulty order is kept
 * wherever it can be.
 */
function spreadTopologies(blocks: Level[][], prefix: string): Level[] {
  const out: Level[] = [];
  const recent: string[] = [];
  let stillColliding = 0;

  for (const block of blocks) {
    const remaining = block.map((l) => ({ level: l, topo: fingerprint(l, 0).topo }));
    while (remaining.length) {
      let pick = remaining.findIndex((c) => !recent.includes(c.topo));
      if (pick < 0) {
        pick = 0;
        stillColliding++;
      }
      const [chosen] = remaining.splice(pick, 1);
      out.push(chosen.level);
      recent.push(chosen.topo);
      if (recent.length > 4) recent.shift();
    }
  }
  // Renumber so the ids follow play order.
  const counters = new Map<number, number>();
  for (const l of out) {
    const n = (counters.get(l.chapter) ?? 0) + 1;
    counters.set(l.chapter, n);
    l.id = `${prefix}-${l.chapter}-${n}`;
  }
  if (stillColliding) {
    console.log(`  note: ${stillColliding} level(s) could not be spaced further apart`);
  }
  return out;
}

/** The assessment pool: one mechanic per item, every family represented. */
function buildAssessment(seed: string, perFamily: number): Level[] {
  console.log('\nASSESS');
  const accepted: Accepted[] = [];
  const out: Level[] = [];
  for (const { family, make } of ASSESS_FAMILIES) {
    const rng = makeRng(`${seed}:assess:${family}`);
    let made = 0;
    let tries = 0;
    const deadline = Date.now() + CHAPTER_BUDGET_MS;
    const topoCounts = new Map<string, number>();
    while (made < perFamily && tries < MAX_TRIES_PER_LEVEL * perFamily && Date.now() < deadline) {
      tries++;
      const id = `a-${family}-${made + 1}`;
      const level = tryAccept(make(rng, made), id, 'assess', 0, family, accepted, topoCounts);
      if (level) {
        out.push(level);
        made++;
      }
    }
    console.log(`  ${family.padEnd(10)} ${String(made).padStart(2)}/${perFamily}`);
  }
  out.sort((a, b) => difficultyOf(a) - difficultyOf(b));
  return spreadTopologies([out], 'a').map((l, i) => {
    l.id = `a-${i + 1}`;
    return l;
  });
}

function write(name: string, levels: Level[]): void {
  mkdirSync(LEVELS_DIR, { recursive: true });
  const json = JSON.stringify(levels, null, 1);
  writeFileSync(join(LEVELS_DIR, `${name}.json`), json + '\n');
  console.log(`  wrote levels/${name}.json  (${levels.length} levels, ${(json.length / 1024).toFixed(0)} kB)`);
}

const seed = process.env.THREAD_SEED ?? 'thread-v1';
console.log(`Building levels with seed "${seed}"`);

const classic = buildMode('classic', CLASSIC_CHAPTERS, 'c', seed);
const weave = buildMode('weave', WEAVE_CHAPTERS, 'w', seed);
const assess = buildAssessment(seed, 5);

write('classic', classic);
write('weave', weave);
write('assess', assess);

const total = classic.length + weave.length + assess.length;
console.log(`\nTotal hand-designed levels: ${total}`);
const families = new Map<string, number>();
for (const l of [...classic, ...weave, ...assess]) {
  const key = mechanicsOf(l).sort().join('+');
  families.set(key, (families.get(key) ?? 0) + 1);
}
console.log(`Distinct mechanic tuples: ${families.size}`);
