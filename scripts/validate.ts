/**
 * `pnpm validate` — the level quality gate, over every level that ships.
 * Prints a table and exits non-zero if anything fails, so CI can hold the line.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Level } from '../src/core/level.js';
import { validateLevel, mechanicsOf } from '../src/core/level.js';
import { checkLevel, fingerprint, auditRepetition, type LevelReport } from '../src/core/gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS = join(HERE, '..', 'levels');
const FILES = ['classic', 'weave', 'assess'];

const budgetMs = Number(process.env.GATE_BUDGET_MS ?? 900);
const only = process.argv[2];

let allLevels: Level[] = [];
const byFile = new Map<string, Level[]>();

for (const f of FILES) {
  const path = join(LEVELS, `${f}.json`);
  if (!existsSync(path)) {
    console.error(`levels/${f}.json is missing — run \`pnpm levels\` first.`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
  const levels = raw.map((l) => validateLevel(l));
  byFile.set(f, levels);
  allLevels = allLevels.concat(levels);
}

const targets = only ? allLevels.filter((l) => l.id.startsWith(only)) : allLevels;

console.log(`Thread level gate — ${targets.length} levels, ${budgetMs} ms search budget each\n`);

const reports: LevelReport[] = [];
let failed = 0;
const t0 = Date.now();

for (const level of targets) {
  const r = checkLevel(level, { budgetMs });
  reports.push(r);
  if (!r.pass) {
    failed++;
    console.log(`FAIL ${r.id}`);
    for (const c of r.checks) if (!c.pass) console.log(`       ${c.name}: ${c.detail}`);
  }
}

// Check 6 is a property of the whole set, not of one level.
let repetitionIssues = 0;
for (const [name, levels] of byFile) {
  const prints = levels.map((l, i) => fingerprint(l, i));
  const issues = auditRepetition(prints);
  repetitionIssues += issues.length;
  if (issues.length) {
    console.log(`\nREPETITION in ${name}:`);
    for (const i of issues.slice(0, 20)) console.log(`       ${i.a} vs ${i.b}: ${i.reason}`);
    if (issues.length > 20) console.log(`       ...and ${issues.length - 20} more`);
  }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const CHECKS = ['solvable', 'derived-target', 'uniqueness', 'threshold', 'mechanics'] as const;
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);

console.log('\n' + pad('', 10) + CHECKS.map((c) => padL(c, 16)).join('') + padL('repetition', 12));
console.log('-'.repeat(10 + 16 * CHECKS.length + 12));
for (const [name, levels] of byFile) {
  const subset = reports.filter((r) => levels.some((l) => l.id === r.id));
  const cells = CHECKS.map((c) => {
    const n = subset.filter((r) => r.checks.find((x) => x.name === c)?.pass).length;
    return padL(`${n}/${subset.length}`, 16);
  });
  console.log(pad(name, 10) + cells.join('') + padL(subset.length ? 'ok' : '-', 12));
}

const mechCount = new Map<string, number>();
for (const l of targets) {
  for (const m of mechanicsOf(l)) mechCount.set(m, (mechCount.get(m) ?? 0) + 1);
}
console.log('\nMechanic coverage');
for (const [m, n] of [...mechCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(m, 10)} ${padL(n, 4)} levels`);
}

const worst = reports.reduce((a, b) => (b.worstNearMiss > a.worstNearMiss ? b : a), reports[0]);
const avgDiff = reports.reduce((n, r) => n + r.difficulty, 0) / Math.max(reports.length, 1);
console.log(`\nWorst near miss anywhere: ${worst.worstNearMiss.toFixed(4)} (${worst.id}), threshold 0.995`);
console.log(`Mean static difficulty:   ${avgDiff.toFixed(2)}`);
console.log(`Elapsed:                  ${((Date.now() - t0) / 1000).toFixed(1)} s`);

if (failed || repetitionIssues) {
  console.log(`\n${failed} level(s) failed, ${repetitionIssues} repetition issue(s).`);
  process.exit(1);
}
console.log('\nAll six checks green.');
