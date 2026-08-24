import { validateLevel } from '../src/core/level.js';
import { checkLevel, fingerprint } from '../src/core/gate.js';
import { makeRng } from '../src/core/rng.js';
import { SHADOW_CHAPTERS, PAR_CHAPTERS, CORRAL_CHAPTERS, WIRE_CHAPTERS } from '../src/core/modes.js';

const which = process.argv[2] ?? 'shadow';
const specs = { shadow: SHADOW_CHAPTERS, par: PAR_CHAPTERS, corral: CORRAL_CHAPTERS, wire: WIRE_CHAPTERS }[which]!;
const ch = Number(process.argv[3] ?? 1);
const spec = specs.find((s) => s.chapter === ch)!;
const rng = makeRng(`diag:${which}:${ch}`);
const fails = new Map<string, number>();
const topos = new Set<string>();
let made = 0;
for (let i = 0; i < 40; i++) {
  const body = spec.make(rng, i);
  if (!body) { fails.set('maker returned null', (fails.get('maker returned null') ?? 0) + 1); continue; }
  let level;
  try {
    level = validateLevel({ ...body, id: `d-${i}`, mode: which as never, chapter: ch, name: spec.name });
  } catch (e) {
    fails.set(`invalid: ${(e as Error).message.slice(0, 70)}`, (fails.get(`invalid: ${(e as Error).message.slice(0, 70)}`) ?? 0) + 1);
    continue;
  }
  const r = checkLevel(level, { budgetMs: 900, stopOnFail: true });
  if (r.pass) { made++; topos.add(fingerprint(level, 0).topo); continue; }
  const bad = r.checks.find((c) => !c.pass)!;
  const k = `${bad.name}: ${bad.detail.slice(0, 80)}`;
  fails.set(k, (fails.get(k) ?? 0) + 1);
}
console.log(`${which} ch${ch}: ${made}/40 accepted, ${topos.size} distinct topologies`);
for (const [k, n] of [...fails.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
