/** Take a few screenshots so the UI can be eyeballed without a device. */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? 'shots';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => {
  try { localStorage.setItem('thread.seen-intro', '1'); } catch { /* private mode */ }
});

const base = 'http://127.0.0.1:4173';
const shots = [
  ['home', '/'],
  ['play-loops', '/#/play/classic/c-1-1'],
  ['play-crossings', '/#/play/classic/c-3-1'],
  ['play-keyhole', '/#/play/classic/c-4-1'],
  ['play-weave', '/#/play/weave/w-3-1'],
  ['chapters', '/#/chapters/classic'],
  ['gallery', '/#/gallery'],
  ['stats', '/#/stats'],
  ['settings', '/#/settings'],
  ['assess', '/#/assess'],
  ['workshop', '/#/workshop'],
];

for (const [name, path] of shots) {
  await page.goto(base + path);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}
await browser.close();
