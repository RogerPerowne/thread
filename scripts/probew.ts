import { makeRng } from '../src/core/rng.js';
import { validateLevel, type Level } from '../src/core/level.js';
import { checkLevel } from '../src/core/gate.js';
import { WEAVE_CHAPTERS } from '../src/core/design.js';

const which = Number(process.argv[2] ?? 1);
const spec = WEAVE_CHAPTERS[which - 1];
const rng = makeRng(`probew:${which}`);
let pass = 0, nulls = 0;
const fails = new Map<string, number>();
const N = Number(process.argv[3] ?? 40);
for (let i = 0; i < N; i++) {
  const b = spec.make(rng, i);
  if (!b) { nulls++; continue; }
  let l: Level;
  try { l = validateLevel({ ...b, id: `p${i}`, mode: 'weave', chapter: spec.chapter }); }
  catch (e) { const k = 'validate: ' + (e as Error).message.slice(0, 60); fails.set(k, (fails.get(k) ?? 0) + 1); continue; }
  const r = checkLevel(l, { budgetMs: 400, stopOnFail: true });
  if (r.pass) pass++;
  else { const f = r.checks.find((c) => !c.pass)!; const k = `${f.name}: ${f.detail.slice(0, 70)}`; fails.set(k, (fails.get(k) ?? 0) + 1); }
}
console.log(`weave ch${which} ${spec.name}: ${pass}/${N} pass, ${nulls} null`);
for (const [k, v] of [...fails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   ${String(v).padStart(3)}  ${k}`);
