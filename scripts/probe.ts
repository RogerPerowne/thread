import { makeRng } from '../src/core/rng.js';
import { validateLevel, type Level } from '../src/core/level.js';
import { checkLevel } from '../src/core/gate.js';
import { CLASSIC_CHAPTERS } from '../src/core/design.js';

const which = Number(process.argv[2] ?? 1);
const spec = CLASSIC_CHAPTERS[which - 1];
const rng = makeRng(`probe:${which}`);
const t0 = Date.now();
let pass = 0;
let nulls = 0;
const fails = new Map<string, number>();
const N = Number(process.argv[3] ?? 60);
for (let i = 0; i < N; i++) {
  const b = spec.make(rng, i);
  if (!b) { nulls++; continue; }
  let l: Level;
  try { l = validateLevel({ ...b, id: `p${i}`, mode: 'classic', chapter: spec.chapter }); }
  catch (e) { fails.set('validate: ' + (e as Error).message.slice(0, 60), (fails.get('validate') ?? 0) + 1); continue; }
  const r = checkLevel(l, { budgetMs: 400, stopOnFail: true });
  if (r.pass) pass++;
  else {
    const f = r.checks.find((c) => !c.pass)!;
    const key = `${f.name}: ${f.detail.slice(0, 70)}`;
    fails.set(key, (fails.get(key) ?? 0) + 1);
  }
}
const ms = Date.now() - t0;
console.log(`ch${which} ${spec.name}: ${pass}/${N} pass, ${nulls} null, ${ms}ms (${(ms / N).toFixed(0)}ms per candidate)`);
for (const [k, v] of [...fails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${String(v).padStart(3)}  ${k}`);
