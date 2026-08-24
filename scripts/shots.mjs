/** Screenshot a set of routes at phone size, for design review. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:4173/';
const outDir = process.argv[3] || 'shots';
mkdirSync(outDir, { recursive: true });
const shots = [
  ['home', '#/home', { full: true }],
  ['chapters', '#/chapters/classic', { full: false }],
  ['path', '#/levels/classic/1', { full: false }],
  ['path-scroll', '#/levels/classic/1', { full: false, scroll: 900 }],
];
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
// Seed some progress so solved, current and locked tiles are all on screen.
if (process.env.SEED) {
  await page.goto(base);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('thread.save') || '{}');
    raw.v = 3;
    raw.levels = raw.levels || {};
    const st = [3, 2, 3, 1, 2];
    st.forEach((n, i) => { raw.levels[`c-1-${i + 1}`] = { stars: n, best: 1, attempts: 1, bestSimilarity: 1 }; });
    raw.stats = raw.stats || {};
    raw.stats.solved = 5;
    localStorage.setItem('thread.save', JSON.stringify(raw));
  });
  // A goto that only changes the fragment does not reload, and the save is
  // read once at construction — so the seed needs a real reload to land.
  await page.reload();
}
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(String(e)));
for (const [name, hash, opt] of shots) {
  await page.goto(base + hash);
  await page.waitForSelector('.screen');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  if (opt.scroll) await page.evaluate((y) => document.querySelector('.scroll').scrollTop = y, opt.scroll);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: !!opt.full });
  console.log(`${outDir}/${name}.png`);
}
await b.close();
if (errs.length) { console.error('CONSOLE ERRORS:\n' + errs.join('\n')); process.exit(1); }
